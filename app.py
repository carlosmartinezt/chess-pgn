import base64
import json
import os
import re
from pathlib import Path

import anthropic
import chess
import chess.pgn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

client = anthropic.Anthropic()

SYSTEM_PROMPT = """You are a chess scoresheet transcription expert. You will be shown a photograph of a handwritten chess scoresheet.

Your job is to read the moves as accurately as possible and return them in a structured JSON format.

Rules:
- Read every move exactly as written. Do NOT fix, correct, or guess moves.
- If a move is unclear or ambiguous, provide your best readings as alternatives.
- Use standard algebraic notation (SAN).
- For each move, indicate your confidence: "clear" or "unclear".
- If a move is unclear, provide 1-3 alternative readings in an "alternatives" array.
- Include any visible metadata: player names, event, section, date, result.
- Do NOT validate legality — just read what's written.

Return JSON in this exact format:
{
  "white_player": "name or null",
  "black_player": "name or null",
  "event": "event name or null",
  "section": "section or null",
  "date": "date or null",
  "result": "1-0, 0-1, 1/2-1/2, or null",
  "moves": [
    {
      "number": 1,
      "white": {"text": "e4", "confidence": "clear"},
      "black": {"text": "e5", "confidence": "clear"}
    },
    {
      "number": 2,
      "white": {"text": "Nf3", "confidence": "clear"},
      "black": {"text": "Nc6", "confidence": "unclear", "alternatives": ["Nc6", "Ne6", "Nd6"]}
    }
  ]
}

If a side's move is missing (e.g., game ended on white's move), omit the "black" key for that move number.
Be conservative. When in doubt, mark as "unclear" and provide alternatives."""


def validate_moves(moves_data: list[dict]) -> dict:
    """Validate each move against a chess board, returning verified PGN and first ambiguity."""
    board = chess.Board()
    verified_moves = []
    pgn_headers = {}
    move_number = 0

    for move_entry in moves_data:
        move_number = move_entry["number"]

        # Process white's move
        if "white" in move_entry:
            white = move_entry["white"]
            result = _try_move(board, white, move_number, "white")
            if result["status"] == "ok":
                verified_moves.append(result["san"])
            else:
                return _build_response(verified_moves, move_number, "white", result, board)

        # Process black's move
        if "black" in move_entry:
            black = move_entry["black"]
            result = _try_move(board, black, move_number, "black")
            if result["status"] == "ok":
                verified_moves.append(result["san"])
            else:
                return _build_response(verified_moves, move_number, "black", result, board)

    # All moves verified
    return {
        "status": "complete",
        "verified_moves": verified_moves,
        "total_verified": len(verified_moves),
        "board_fen": board.fen(),
    }


def _try_move(board: chess.Board, move_data: dict, move_number: int, color: str) -> dict:
    """Try to apply a move. Returns status dict."""
    text = move_data["text"].strip()
    confidence = move_data.get("confidence", "clear")
    alternatives = move_data.get("alternatives", [])

    # Normalize common OCR/handwriting issues
    normalized = _normalize_san(text)

    # Try the primary reading
    try:
        move = board.parse_san(normalized)
        board.push(move)
        return {"status": "ok", "san": board.move_stack[-1].uci(), "san_pretty": board.san(board.move_stack[-1]) if False else _get_san(board, move)}
    except (chess.InvalidMoveError, chess.IllegalMoveError, chess.AmbiguousMoveError, ValueError):
        pass

    # Try alternatives
    legal_candidates = []

    all_attempts = [text] + (alternatives or [])
    all_attempts = list(dict.fromkeys(all_attempts))  # dedupe preserving order

    for alt in all_attempts:
        norm_alt = _normalize_san(alt)
        try:
            move = board.parse_san(norm_alt)
            # Check it's legal
            if move in board.legal_moves:
                san = board.san(move)
                legal_candidates.append({"san": san, "original_text": alt, "uci": move.uci()})
        except (chess.InvalidMoveError, chess.IllegalMoveError, chess.AmbiguousMoveError, ValueError):
            continue

    # Also try fuzzy matching against all legal moves
    fuzzy = _fuzzy_match_legal_moves(board, text)
    for fm in fuzzy:
        if not any(c["san"] == fm["san"] for c in legal_candidates):
            legal_candidates.append(fm)

    if len(legal_candidates) == 1 and confidence == "clear":
        # Single legal candidate and original was clear — auto-accept
        move = board.parse_san(legal_candidates[0]["san"])
        board.push(move)
        return {"status": "ok", "san": legal_candidates[0]["san"]}

    return {
        "status": "ambiguous" if legal_candidates else "illegal",
        "original_text": text,
        "confidence": confidence,
        "legal_candidates": legal_candidates,
        "context": _board_context(board),
    }


def _get_san(board: chess.Board, move: chess.Move) -> str:
    """Get SAN for a move that was already pushed."""
    board.pop()
    san = board.san(move)
    board.push(move)
    return san


def _normalize_san(text: str) -> str:
    """Normalize common handwriting/OCR issues in SAN notation."""
    s = text.strip()
    # Common substitutions
    s = s.replace("0-0-0", "O-O-O").replace("0-0", "O-O")
    # Remove trailing periods or commas
    s = s.rstrip(".,;")
    # Fix lowercase 'o' for castling
    if re.match(r'^o-o-o$', s, re.IGNORECASE):
        s = "O-O-O"
    elif re.match(r'^o-o$', s, re.IGNORECASE):
        s = "O-O"
    return s


def _fuzzy_match_legal_moves(board: chess.Board, text: str) -> list[dict]:
    """Try to fuzzy-match the text against all legal moves."""
    candidates = []
    normalized = _normalize_san(text).lower().replace("x", "").replace("+", "").replace("#", "")

    for move in board.legal_moves:
        san = board.san(move)
        san_lower = san.lower().replace("x", "").replace("+", "").replace("#", "")

        # Check if the core squares/pieces match
        if _similarity(normalized, san_lower) >= 0.7:
            candidates.append({"san": san, "original_text": text, "uci": move.uci()})

    return candidates


def _similarity(a: str, b: str) -> float:
    """Simple character-level similarity."""
    if not a or not b:
        return 0.0
    matches = sum(1 for ca, cb in zip(a, b) if ca == cb)
    return matches / max(len(a), len(b))


def _board_context(board: chess.Board) -> dict:
    """Generate human-readable context about the current position."""
    legal = [board.san(m) for m in board.legal_moves]
    return {
        "fen": board.fen(),
        "side_to_move": "white" if board.turn == chess.WHITE else "black",
        "legal_moves_count": len(legal),
        "legal_moves": legal,
        "in_check": board.is_check(),
        "move_number": board.fullmove_number,
    }


def _build_response(verified_moves: list, move_number: int, color: str, result: dict, board: chess.Board) -> dict:
    return {
        "status": result["status"],
        "verified_moves": verified_moves,
        "total_verified": len(verified_moves),
        "problem_at": {"move_number": move_number, "color": color},
        "original_text": result.get("original_text", ""),
        "legal_candidates": result.get("legal_candidates", []),
        "context": result.get("context", _board_context(board)),
        "board_fen": board.fen(),
    }


def build_pgn(moves: list[str], headers: dict, result: str = "*") -> str:
    """Build a PGN string from a list of SAN moves."""
    game = chess.pgn.Game()
    game.headers["Event"] = headers.get("event") or "?"
    game.headers["Site"] = "?"
    game.headers["Date"] = headers.get("date") or "????.??.??"
    game.headers["Round"] = "?"
    game.headers["White"] = headers.get("white_player") or "?"
    game.headers["Black"] = headers.get("black_player") or "?"
    game.headers["Result"] = result

    if headers.get("section"):
        game.headers["Section"] = headers["section"]

    node = game
    board = chess.Board()
    for san in moves:
        move = board.parse_san(san)
        node = node.add_variation(move)
        board.push(move)

    game.headers["Result"] = result
    return str(game)


@app.post("/api/upload")
async def upload_scoresheet(file: UploadFile = File(...)):
    """Process an uploaded scoresheet image."""
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        return JSONResponse({"error": "File too large (max 10MB)"}, status_code=400)

    b64 = base64.standard_b64encode(contents).decode("utf-8")

    # Determine media type
    content_type = file.content_type or "image/jpeg"
    if content_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
        content_type = "image/jpeg"

    # Send to Claude for transcription
    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": content_type,
                                "data": b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": "Please transcribe this chess scoresheet. Return ONLY the JSON, no markdown fencing.",
                        },
                    ],
                }
            ],
            system=SYSTEM_PROMPT,
        )
    except Exception as e:
        return JSONResponse({"error": f"Vision API error: {str(e)}"}, status_code=500)

    # Parse the response
    raw_text = response.content[0].text.strip()
    # Strip markdown code fences if present
    if raw_text.startswith("```"):
        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)

    try:
        transcription = json.loads(raw_text)
    except json.JSONDecodeError:
        return JSONResponse(
            {"error": "Failed to parse vision response", "raw": raw_text},
            status_code=500,
        )

    # Validate moves
    validation = validate_moves(transcription.get("moves", []))

    # Build PGN for verified moves
    headers = {
        "event": transcription.get("event"),
        "white_player": transcription.get("white_player"),
        "black_player": transcription.get("black_player"),
        "date": transcription.get("date"),
        "section": transcription.get("section"),
    }

    result_str = transcription.get("result") or "*"
    if validation["status"] != "complete":
        result_str = "*"

    pgn = ""
    if validation["verified_moves"]:
        pgn = build_pgn(validation["verified_moves"], headers, result_str)

    return JSONResponse({
        "transcription": transcription,
        "validation": validation,
        "pgn": pgn,
        "headers": headers,
    })


@app.post("/api/resolve")
async def resolve_move(data: str = Form(...)):
    """Resolve an ambiguous move and continue validation."""
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    confirmed_moves = payload.get("confirmed_moves", [])  # list of SAN strings
    chosen_san = payload.get("chosen_san", "")
    remaining_raw = payload.get("remaining_moves", [])  # raw move entries from transcription
    headers = payload.get("headers", {})

    # Replay confirmed moves
    board = chess.Board()
    verified = []
    for san in confirmed_moves:
        try:
            move = board.parse_san(san)
            board.push(move)
            verified.append(san)
        except Exception:
            return JSONResponse({"error": f"Failed to replay move: {san}"}, status_code=400)

    # Apply the chosen move
    if chosen_san:
        try:
            move = board.parse_san(chosen_san)
            board.push(move)
            verified.append(chosen_san)
        except Exception:
            return JSONResponse({"error": f"Chosen move is illegal: {chosen_san}"}, status_code=400)

    # Continue validation with remaining moves
    if remaining_raw:
        continuation = validate_moves(remaining_raw)

        # Merge verified moves
        all_verified = verified + continuation.get("verified_moves", [])

        result_str = "*"
        if continuation["status"] == "complete":
            result_str = headers.get("result") or "*"

        pgn = build_pgn(all_verified, headers, result_str) if all_verified else ""

        return JSONResponse({
            "validation": {
                **continuation,
                "verified_moves": all_verified,
                "total_verified": len(all_verified),
            },
            "pgn": pgn,
            "headers": headers,
        })
    else:
        result_str = headers.get("result") or "*"
        pgn = build_pgn(verified, headers, result_str) if verified else ""

        return JSONResponse({
            "validation": {
                "status": "complete",
                "verified_moves": verified,
                "total_verified": len(verified),
                "board_fen": board.fen(),
            },
            "pgn": pgn,
            "headers": headers,
        })


@app.get("/")
async def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
