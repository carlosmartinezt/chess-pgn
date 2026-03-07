# User Flows

## 1. Upload & Transcribe

```
User opens app
  → Sees recent sessions list (or empty state)
  → Taps "New Session"
  → Enters player name + selects color (optional)
  → Takes/selects photo of scoresheet
  → Taps "Transcribe Scoresheet"
  → Server sends image to Claude Vision API
  → Server validates moves sequentially
  → Returns PGN with verified moves

If all moves valid → shows complete PGN, user can copy
If a move is ambiguous/illegal → shows AmbiguityPanel (see flow 2)
```

## 2. Resolve Ambiguous Move

```
Validation stops at a problem move
  → AmbiguityPanel shows:
    - What the AI read (e.g., "Bb7")
    - Interactive chessboard at the problem position
    - AI suggestion buttons (if any legal candidates found)
  → User can:
    a. Drag the correct piece on the board
    b. Tap an AI suggestion button
  → Server receives the chosen move
  → Replays confirmed moves + chosen move on a chess board
  → Continues validating remaining transcription moves
  → Returns updated PGN (may stop at next problem or complete)
```

## 3. Correct a Verified Move

```
User spots an error in the PGN move list
  → Taps the incorrect move
  → CorrectionPanel shows:
    - Chessboard at the position before that move
    - Prev/Next buttons to navigate through moves
    - Text input for typing a move
    - All legal moves as tappable buttons
  → User can:
    a. Drag the correct piece on the board
    b. Tap a legal move button
    c. Type a move and hit Apply
  → Server receives the correction
  → Replays all moves up to the correction point
  → Applies the corrected move
  → Updates the transcription with the corrected text
  → Re-validates all remaining transcription moves from the new position
  → Saves correction to corrections.json for AI learning
  → Returns updated PGN
```

## 4. Review Moves (Navigate Without Correcting)

```
User taps a move in the PGN
  → CorrectionPanel shows the board at that position
  → User taps "Next →" to advance to the next move
  → User taps "← Prev" to go back
  → User taps "Close" to dismiss
  → No API call is made unless the user actually corrects a move
```

## 5. Cross-Device Continuity

```
User uploads a scoresheet from phone
  → Session is saved as a JSON file on the server
  → User opens the app on laptop
  → Sees the session in the recent sessions list
  → Taps it to load the full session
  → Can continue correcting or copy PGN
```

## 6. AI Learning from Corrections

```
User corrects a move (e.g., "Qb3" → "Qd3")
  → Correction is appended to corrections.json:
    { original: "Qb3", corrected: "Qd3", position_fen, player, move_number, color }
  → On next upload, buildSystemPrompt() reads corrections.json
  → Adds "Common misreadings" section to the Claude Vision prompt:
    - "Qb3" was actually "Qd3" (2x)
  → Claude pays extra attention to distinguishing similar characters
```
