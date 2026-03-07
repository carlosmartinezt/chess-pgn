# API Reference

All endpoints are served from the Express backend (`server/index.ts`).

## POST /api/upload

Upload a scoresheet photo for transcription.

**Content-Type**: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | Image file (JPG, PNG, WebP, GIF, max 10MB) |
| `player_name` | string | No | Name of the player (user) |
| `player_color` | string | No | `"white"` or `"black"` |

**Response**: `SessionData` — includes `transcription`, `validation`, `pgn`, `headers`, `session_id`

**Flow**: Image → base64 → Claude Vision API → JSON transcription → `validateMoves()` → save session → return result

## POST /api/resolve

Resolve an ambiguous or illegal move by providing the correct SAN.

**Content-Type**: `application/json`

| Field | Type | Description |
|-------|------|-------------|
| `confirmed_moves` | string[] | All verified moves so far |
| `chosen_san` | string | The chosen SAN for the problem move |
| `remaining_moves` | MoveEntry[] | Remaining raw transcription entries to validate |
| `headers` | object | PGN headers |
| `session_id` | string | Session ID to update |

**Response**: Updated `SessionData` with validation continued past the resolved move

## POST /api/correct

Correct an already-verified move and re-validate the rest.

**Content-Type**: `application/json`

| Field | Type | Description |
|-------|------|-------------|
| `verified_moves` | string[] | All currently verified moves |
| `move_index` | number | Half-move index to correct (0-based) |
| `new_san` | string | The corrected SAN |
| `session_id` | string | Session ID to update |
| `headers` | object | PGN headers |
| `transcription` | object | Full transcription (gets updated with correction) |

**Response**: Updated `SessionData` with the correction applied and remaining moves re-validated

**Side effects**:
- Saves correction to `corrections.json` for AI learning
- Updates the transcription's move text to the corrected value
- Saves updated session to disk

## POST /api/suggest

Ask AI to suggest the most likely intended move when handwriting is ambiguous or illegal.

**Content-Type**: `application/json`

| Field | Type | Description |
|-------|------|-------------|
| `verified_moves` | string[] | All verified moves so far |
| `move_index` | number | Position of the problem move (half-move index) |
| `original_text` | string | The OCR text that was read from the scoresheet |

**Response**: `{ suggestion: string, reason: string }`

**Flow**: Replays verified moves to get the FEN, then asks Claude which legal move most likely matches the handwritten text, considering visual similarity of characters and common chess patterns.

## POST /api/legal-moves

Get all legal moves at a given position.

**Content-Type**: `application/json`

| Field | Type | Description |
|-------|------|-------------|
| `verified_moves` | string[] | Moves to replay |
| `move_index` | number | Replay up to this index, then return legal moves |

**Response**: `{ legal_moves: [{san, uci}], fen, current_move }`

Used by the frontend to populate the chessboard and correction candidates.

## GET /api/sessions

List recent sessions (max 20, sorted by last update).

**Response**: Array of `SessionSummary` objects with `session_id`, player names, status, move count.

## GET /api/session/:sessionId

Load a specific session by ID.

**Response**: Full `SessionData` with transcription, validation, PGN, headers.
