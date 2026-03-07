# CLAUDE.md

## Why This Exists

Rapha and Rory play competitive chess tournaments where players record moves by hand on paper scoresheets. After a tournament weekend with multiple games, getting those games into Lichess for analysis and study is painful — the kids' handwriting is hard to read, there are many games to process, and manually transcribing each one is slow and error-prone.

This app lets you snap a photo of a scoresheet and get validated PGN out. The key design principle: produce the longest fully verified legal move sequence, then stop at the first ambiguous move and ask the user — never guess.

## Commands

```bash
# Build frontend + restart production
npm run build && systemctl --user restart chess-pgn

# Dev: backend with auto-reload (set PORT=8702 to avoid prod conflict)
PORT=8702 npm run dev:server

# Dev: Vite frontend with HMR (proxies /api to localhost:8702)
npm run dev

# Production service management
systemctl --user status chess-pgn
journalctl --user -u chess-pgn -f

# Install dependencies
npm install
```

No tests or linting configured.

## Architecture

Node.js Express backend + React frontend, built with Vite. No database — sessions stored as JSON files.

- **Vision OCR**: Anthropic Claude API (claude-sonnet-4-6) transcribes photos into structured JSON
- **Move validation**: chess.js replays moves sequentially, checking legality
- **Interactive board**: chessground (Lichess board library) for move correction
- **Deployment**: systemd user service on port 8701, behind Caddy reverse proxy

## Docs Index

Detailed documentation in `docs/`:

| Doc | Contents |
|-----|----------|
| [architecture.md](docs/architecture.md) | Stack, directory structure, key design decisions |
| [validation-pipeline.md](docs/validation-pipeline.md) | How moves are validated, key functions, bug history |
| [api.md](docs/api.md) | All API endpoints with request/response formats |
| [user-flows.md](docs/user-flows.md) | Upload, resolve, correct, review, cross-device, AI learning |
| [deployment.md](docs/deployment.md) | systemd service, env vars, Vite proxy, deploy process |
| [known-issues.md](docs/known-issues.md) | Bugs fixed, known limitations |

## Core Flow

1. **Upload** (`POST /api/upload`): Image → Claude Vision → JSON transcription → sequential move validation → PGN
2. **Resolve** (`POST /api/resolve`): User picks the correct move from board/suggestions → server continues validation
3. **Correct** (`POST /api/correct`): User corrects a verified move → re-validates remaining → updates transcription

## Important Rules

- Never auto-correct moves — always ask the user when ambiguous
- Stop at first ambiguous/illegal move (don't skip ahead)
- Corrections must update the transcription (so re-validation from scratch works)
- The `.env` file contains the Anthropic API key (gitignored)
