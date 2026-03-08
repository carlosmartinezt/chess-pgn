# Chess PGN Transcriber

> **Try it live:** https://chess-pgn.carlosmartinezt.com/

Web app that converts photos of handwritten chess scoresheets into valid PGN files for Lichess.

## How It Works

1. Upload a photo of a handwritten scoresheet from your phone
2. Claude Vision reads the handwriting and extracts moves
3. Every move is validated for legality using python-chess
4. Ambiguous or illegal moves are flagged — you pick the correct one
5. Copy the verified PGN into Lichess

## Architecture

```
Browser (phone/desktop)
  → Caddy (HTTPS reverse proxy, port 443)
    → uvicorn (Python ASGI server, port 8701)
      → FastAPI app
        → Anthropic API (Claude Vision for OCR)
        → python-chess (move validation)
```

## Files

| File | Purpose |
|------|---------|
| `app.py` | FastAPI backend: image upload, Claude Vision API, move validation |
| `static/index.html` | Frontend HTML |
| `static/style.css` | Dark theme mobile-first styles |
| `static/app.js` | Upload, display results, resolve ambiguities |
| `.env` | Anthropic API key (not in git) |
| `requirements.txt` | Python dependencies |

## Key Design Decisions

- **Conservative validation**: stops at the first ambiguous/illegal move rather than guessing
- **Fuzzy matching**: when a handwritten move is illegal, suggests legal moves that look similar
- **Interactive resolution**: user picks the correct move from legal candidates before continuing
- **No invented moves**: never auto-corrects — always asks

## Setup

```bash
# Install dependencies
uv venv && uv pip install -r requirements.txt

# Set API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# Run locally
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8701
```

## Service Management

```bash
systemctl --user status chess-pgn      # Check status
systemctl --user restart chess-pgn     # Restart after changes
systemctl --user stop chess-pgn        # Stop
journalctl --user -u chess-pgn -f      # View logs
```

## Deployment

- **URL**: https://chess-pgn.carlosmartinezt.com
- **Server**: Hetzner CCX13 (5.161.231.48)
- **Reverse proxy**: Caddy (`/etc/caddy/Caddyfile`)
- **Service**: systemd user service (`~/.config/systemd/user/chess-pgn.service`)
- **Python**: 3.12, venv at `.venv/`
