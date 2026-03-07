# Known Issues & Bugs Fixed

## Fixed

### Validation against wrong position (critical)
**Problem**: `validateMoves()` always started from the initial chess position. When called from resolve/correct endpoints with remaining moves after a correction, those moves were validated against the starting position instead of the position after replayed moves.
**Fix**: Added optional `startingChess` parameter to `validateMoves()`. The resolve and correct endpoints now pass the chess instance after replaying confirmed moves.
**Files**: `server/lib/chess-validation.ts`, `server/routes/correct.ts`, `server/routes/resolve.ts`

### Corrections not persisted in transcription
**Problem**: When a user corrected a move, `verified_moves` was updated but the transcription JSON kept the original (wrong) text. On session reload, re-validating from the transcription produced different results — corrections were lost.
**Fix**: The correct endpoint now updates the transcription's move text with the corrected SAN (marked `confidence: "corrected"`).
**File**: `server/routes/correct.ts`

### FormData not parsed by Express
**Problem**: Frontend sent `FormData` for resolve/correct/legal-moves endpoints, but Express routes didn't have multer middleware, so `req.body` was empty → "Invalid JSON" error.
**Fix**: Changed frontend to send JSON with `Content-Type: application/json` instead of FormData. Simplified server route handlers to use `req.body` directly.
**Files**: `src/api.ts`, `server/routes/correct.ts`, `server/routes/resolve.ts`, `server/routes/legal-moves.ts`

### Express 5 wildcard route syntax
**Problem**: Express 5 changed catch-all route syntax. `app.get("*", ...)` throws `PathError: Missing parameter name`.
**Fix**: Changed to `app.get("/{*splat}", ...)`.
**File**: `server/index.ts`

### PGN showing UCI instead of SAN
**Problem**: `_try_move` in the Python backend returned `board.move_stack[-1].uci()` instead of SAN notation. Moves showed as `e2e4` instead of `e4`.
**Fix**: Changed to use `_get_san(board, move)`.
**File**: `app.py` (legacy, now ported correctly to Node.js)

## Known Limitations

- No tests or linting configured
- OAuth tokens (Anthropic API) expire and need manual refresh from `~/.claude/.credentials.json`
- Session files grow unbounded — no cleanup/archival mechanism
- Fuzzy matching threshold (0.7) is hardcoded
- No promotion UI in chessboard — defaults to queen promotion
