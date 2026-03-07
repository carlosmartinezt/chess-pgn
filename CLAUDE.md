# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Why This Exists

Rapha and Rory play competitive chess tournaments where players record moves by hand on paper scoresheets. After a tournament weekend with multiple games, getting those games into Lichess for analysis and study is painful — the kids' handwriting is hard to read, there are many games to process, and manually transcribing each one is slow and error-prone.

This app lets you snap a photo of a scoresheet and get validated PGN out. The key design principle: produce the longest fully verified legal move sequence, then stop at the first ambiguous move and ask the user — never guess. This avoids the frustrating cycle of importing bad PGN into Lichess and having to debug it.

## Commands

```bash
# Run dev server (use port 8702 to avoid conflicting with production on 8701)
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8702

# Production service management
systemctl --user restart chess-pgn
systemctl --user status chess-pgn
journalctl --user -u chess-pgn -f

# Install dependencies
uv pip install -r requirements.txt
```

There are no tests or linting configured.

## Architecture

Single-file FastAPI backend (`app.py`) + static frontend (`static/`). No database — all state lives in the browser session.

- **Vision OCR**: Anthropic Claude API (claude-sonnet-4-6) transcribes scoresheet photos into structured JSON with move-by-move confidence ratings
- **Move validation**: python-chess replays moves on a board, checking legality sequentially
- **Deployment**: systemd user service `chess-pgn` on port 8701, behind Caddy reverse proxy (HTTPS)

## Core Flow

1. **Upload** (`POST /api/upload`): Image → Claude Vision → JSON transcription → sequential move validation → PGN
2. **Resolve** (`POST /api/resolve`): When validation hits an ambiguous/illegal move, the frontend shows candidates. User picks one, frontend sends confirmed moves + chosen move + remaining raw moves back to the server, which replays from scratch and continues validation.

The frontend (`static/app.js`) maintains `sessionState` tracking `confirmed_moves`, `headers`, and the original `transcription`. Each resolve round-trip updates this state and either shows the next ambiguity or completes.

## Validation Pipeline (app.py)

`validate_moves()` → `_try_move()` per half-move:
- Try primary reading (after `_normalize_san()` fixes castling notation, trailing punctuation)
- Try each alternative reading from the transcription
- Try `_fuzzy_match_legal_moves()` (character-similarity >= 0.7 against all legal moves)
- If exactly one legal candidate and confidence is "clear" → auto-accept
- Otherwise → stop and return "ambiguous" or "illegal" with candidates for user resolution

## Important Rules

- Never auto-correct moves — always ask the user when ambiguous
- Stop at first ambiguous/illegal move (don't skip ahead)
- The `.env` file contains the Anthropic API key (gitignored)
