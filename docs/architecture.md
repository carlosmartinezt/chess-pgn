# Architecture

## Stack

- **Backend**: Node.js + Express 5 + TypeScript (was Python FastAPI, rewritten March 2026)
- **Frontend**: React 19 + TypeScript + Vite
- **Chess engine**: chess.js (JS port of python-chess)
- **Vision OCR**: Anthropic Claude API (claude-sonnet-4-6)
- **Interactive board**: chessground (Lichess's board library)
- **Deployment**: systemd user service on port 8701, behind Caddy reverse proxy (HTTPS)
- **No database**: sessions stored as JSON files in `sessions/`, corrections in `corrections.json`

## Directory Structure

```
chess-pgn/
  server/                   # Express backend (TypeScript)
    index.ts                # Entry point, route setup, static file serving
    lib/
      chess-validation.ts   # Core validation engine (validateMoves, tryMove, fuzzyMatch, buildPgn)
      sessions.ts           # Session file I/O, corrections, system prompt builder
    routes/
      upload.ts             # POST /api/upload — image → Claude Vision → validation → PGN
      resolve.ts            # POST /api/resolve — resolve ambiguous/illegal move + continue
      correct.ts            # POST /api/correct — correct a verified move + re-validate remaining
      legal-moves.ts        # POST /api/legal-moves — get legal moves at a position
      sessions.ts           # GET /api/sessions, GET /api/session/:id

  src/                      # React frontend (TypeScript)
    main.tsx                # React root render
    App.tsx                 # Main app, view state (sessions/upload/results)
    api.ts                  # All API fetch functions
    types.ts                # TypeScript interfaces
    styles.css              # All styles
    components/
      SessionsList.tsx      # Recent sessions list
      UploadForm.tsx        # Photo upload with player name/color
      Results.tsx           # PGN display, orchestrates correction/ambiguity flows
      MoveList.tsx           # Interactive tappable move buttons
      CorrectionPanel.tsx   # Correct a verified move (board + legal moves + nav)
      AmbiguityPanel.tsx    # Resolve ambiguous/illegal move (board + suggestions)
      Chessboard.tsx        # chessground wrapper component

  dist/client/              # Vite build output (gitignored)
  sessions/                 # Persisted session JSON files (gitignored)
  sessions/corrections.json # Accumulated user corrections (inside sessions/)
```

## Key Design Decisions

1. **Stop at first problem**: Validation always stops at the first ambiguous/illegal move. Never skips ahead, never guesses. This guarantees every move before the stop point is verified legal.

2. **Corrections update transcription**: When a user corrects a move, the transcription JSON is updated with the corrected text (marked `confidence: "corrected"`). This ensures re-validating a session from scratch produces the same result.

3. **AI learns from corrections**: All corrections are saved to `corrections.json` and fed into the Claude Vision system prompt as "common misreadings". This improves future transcriptions.

4. **Cross-device sessions**: Sessions are saved as server-side JSON files with descriptive names (e.g., `Rory_vs_Reed_Shlisky_2026-03-07_19-17.json`). Any device can load any session.

5. **Board orientation**: Determined by `user_color` header (set during upload). Defaults to white.
