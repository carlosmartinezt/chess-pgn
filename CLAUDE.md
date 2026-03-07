# CLAUDE.md

## Purpose

Chess PGN Transcriber — web app to convert photos of handwritten chess scoresheets into validated PGN for Lichess. Built for Carlos's kids (Rapha and Rory) who play competitive chess tournaments.

## Architecture

- **Backend**: Python FastAPI (`app.py`) on port 8701
- **Frontend**: Static HTML/CSS/JS in `static/`
- **Vision OCR**: Anthropic Claude API (claude-sonnet-4-6)
- **Move validation**: python-chess library
- **Reverse proxy**: Caddy (HTTPS, auto-certs)
- **Service**: systemd user service `chess-pgn`

## Key Files

- `app.py` — all backend logic (upload, vision API call, move validation, PGN generation)
- `static/index.html` — single-page frontend
- `static/app.js` — upload flow, ambiguity resolution UI
- `static/style.css` — dark theme, mobile-first
- `.env` — API key (gitignored)
- `requirements.txt` — Python deps

## Commands

```bash
# Service
systemctl --user restart chess-pgn
systemctl --user status chess-pgn
journalctl --user -u chess-pgn -f

# Dev (run on different port)
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8702

# Dependencies
uv pip install -r requirements.txt
```

## Validation Logic

The core flow in `app.py`:
1. `upload_scoresheet()` — receives image, sends to Claude Vision, gets JSON transcription
2. `validate_moves()` — replays each move on a board, checking legality
3. `_try_move()` — attempts primary reading, then alternatives, then fuzzy matching
4. `_fuzzy_match_legal_moves()` — character-similarity matching against all legal moves
5. `resolve_move()` — user picks a candidate, validation continues from there

## Important Rules

- Never auto-correct moves — always ask the user
- Stop at first ambiguous/illegal move
- The `.env` file contains the API key and must never be committed
