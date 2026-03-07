# Validation Pipeline

## Overview

The validation pipeline takes raw transcription data (from Claude Vision) and produces a sequence of verified legal chess moves. It stops at the first move it cannot verify.

Located in `server/lib/chess-validation.ts`.

## Flow

```
Raw transcription moves
  → validateMoves(movesData, optionalChessInstance)
    → for each half-move:
        → tryMove(chess, moveData)
          1. Normalize SAN (fix castling notation, strip punctuation)
          2. Try primary reading on the board
          3. Try each alternative reading
          4. Fuzzy match against all legal moves (similarity >= 0.7)
          5. If exactly 1 candidate + confidence "clear" → auto-accept
          6. Otherwise → return "ambiguous" or "illegal" with candidates
```

## Key Functions

### `validateMoves(movesData, startingChess?)`
- Accepts an optional `Chess` instance to continue from a mid-game position
- This is critical for the resolve/correct endpoints, which replay confirmed moves first then continue validation from that position
- Returns: `{ status, verified_moves, total_verified, problem_at?, legal_candidates?, context? }`

### `tryMove(chess, moveData)`
- Attempts to play a single move on the board
- Returns `{ status: "ok", san }` on success
- Returns `{ status: "ambiguous"|"illegal", legal_candidates, context }` on failure

### `normalizeSan(text)`
- `0-0-0` → `O-O-O`, `0-0` → `O-O`
- Strips trailing punctuation (`.`, `,`, `;`)
- Case-insensitive castling fix

### `fuzzyMatchLegalMoves(chess, text)`
- Compares input text against all legal moves in the position
- Uses character-by-character similarity (threshold 0.7)
- Strips `x`, `+`, `#` before comparing

### `buildPgn(moves, headers, result)`
- Replays moves on a fresh board to get properly formatted PGN
- Adds headers (Event, White, Black, Date, etc.)

## Bug History

**Critical bug (fixed)**: `validateMoves()` always created `new Chess()` (starting position). When called from resolve/correct endpoints with remaining moves, those moves were validated against the wrong position. Fixed by adding optional `startingChess` parameter — the caller passes the chess instance after replaying confirmed moves.

**Transcription drift bug (fixed)**: Corrections updated `verified_moves` but not the transcription. When a session was reloaded and re-validated from the transcription, corrections were lost. Fixed by updating the transcription's move text when corrections are applied (marked `confidence: "corrected"`).
