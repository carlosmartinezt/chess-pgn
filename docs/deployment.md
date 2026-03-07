# Deployment

## Production Setup

- **Server**: Node.js + Express, runs via systemd user service
- **Port**: 8701 (proxied by Caddy for HTTPS)
- **Domain**: chess-pgn.carlosmartinezt.com
- **Dev port**: 8702 (to avoid conflicting with production)

## Commands

```bash
# Build the React frontend
npm run build

# Start production server (reads PORT from env, defaults to 8701)
npm start

# Dev: run backend with auto-reload (port via PORT env var)
npm run dev:server

# Dev: run Vite dev server with HMR (proxies API to backend)
npm run dev

# Restart production after code changes
npm run build && systemctl --user restart chess-pgn

# Check production status
systemctl --user status chess-pgn

# View production logs
journalctl --user -u chess-pgn -f
```

## systemd Service

Located at `~/.config/systemd/user/chess-pgn.service`:

```ini
[Unit]
Description=Chess PGN Transcriber
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/carlos/chess-pgn
EnvironmentFile=/home/carlos/chess-pgn/.env
ExecStart=/usr/bin/node --import tsx server/index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

After editing the service file:
```bash
systemctl --user daemon-reload
systemctl --user restart chess-pgn
```

## Environment Variables

- `PORT` — Server port (optional, defaults to 8701)

### Anthropic API Authentication

The server reads the OAuth token from `~/.claude/.credentials.json` (managed by Claude Code). This token is refreshed automatically when you run `claude login`.

The helper `server/lib/anthropic-client.ts` reads the token fresh on each request, so a `claude login` refresh takes effect without restarting the server. If the credentials file is missing, it falls back to the `ANTHROPIC_API_KEY` env var from `.env`.

**If you get 401 "invalid x-api-key" errors**, run:
```bash
claude login
```
Then retry — no restart needed.

## Vite Dev Proxy

`vite.config.ts` proxies `/api` requests to `http://localhost:8702` during development, so you can run the Vite dev server and backend separately.

## Deploy Process

1. Make code changes
2. `npm run build` — builds React frontend to `dist/client/`
3. `systemctl --user restart chess-pgn` — restarts the Node.js server which serves the built frontend
