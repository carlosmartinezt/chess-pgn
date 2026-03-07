import base64
import json
import logging
import os
import re
import time
from datetime import datetime
from pathlib import Path

import anthropic
import chess
import chess.pgn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("chess-pgn")

app = FastAPI()

client = anthropic.Anthropic()

SESSIONS_DIR = Path(__file__).parent / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)
CORRECTIONS_FILE = Path(__file__).parent / "corrections.json"


def _sanitize_name(name: str) -> str:
    """Sanitize a name for use in a filename."""
    s = re.sub(r'[^\w\s-]', '', name.strip())
    s = re.sub(r'\s+', '_', s)
    return s[:30] or "unknown"


def _session_filename(headers: dict) -> str:
    """Generate a descriptive session filename."""
    white = _sanitize_name(headers.get("white_player") or "unknown")
    black = _sanitize_name(headers.get("black_player") or "unknown")
    now = datetime.now().strftime("%Y-%m-%d_%H-%M")
    return f"{white}_vs_{black}_{now}.json"


def _save_session(filename: str, data: dict) -> str:
    """Save session data to a JSON file. Returns the session id (filename without .json)."""
    data["updated_at"] = time.time()
    if "created_at" not in data:
        data["created_at"] = data["updated_at"]
    filepath = SESSIONS_DIR / filename
    filepath.write_text(json.dumps(data, indent=2))
    return filename.removesuffix(".json")

def _load_corrections() -> list[dict]:
    """Load accumulated corrections."""
    if CORRECTIONS_FILE.exists():
        try:
            return json.loads(CORRECTIONS_FILE.read_text())
        except (json.JSONDecodeError, KeyError):
            return []
    return []


def _save_correction(original: str, corrected: str, position_fen: str, player: str, move_number: int, color: str):
    """Append a correction to the corrections file."""
    corrections = _load_corrections()
    corrections.append({
        "original": original,
        "corrected": corrected,
        "position_fen": position_fen,
        "player": player,
        "move_number": move_number,
        "color": color,
        "timestamp": time.time(),
    })
    CORRECTIONS_FILE.write_text(json.dumps(corrections, indent=2))
    logger.info("Correction saved: %s -> %s (move %d %s, player %s)", original, corrected, move_number, color, player)


def _build_system_prompt() -> str:
    """Build the system prompt, including learned corrections."""
    corrections = _load_corrections()
    corrections_section = ""
    if corrections:
        # Deduplicate and summarize
        misreadings = {}
        for c in corrections:
            key = (c["original"], c["corrected"])
            misreadings[key] = misreadings.get(key, 0) + 1
        lines = []
        for (orig, corr), count in sorted(misreadings.items(), key=lambda x: -x[1]):
            times = f" ({count}x)" if count > 1 else ""
            lines.append(f"- \"{orig}\" was actually \"{corr}\"{times}")
        corrections_section = f"""

IMPORTANT - Common misreadings from previous scoresheets (learn from these):
{chr(10).join(lines)}

Pay extra attention to distinguishing these characters in handwriting."""

    return SYSTEM_PROMPT_BASE + corrections_section


SYSTEM_PROMPT_BASE = """You are a chess scoresheet transcription expert. You will be shown a photograph of a handwritten chess scoresheet.

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
        return {"status": "ok", "san": _get_san(board, move)}
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
async def upload_scoresheet(
    file: UploadFile = File(...),
    player_name: str = Form(""),
    player_color: str = Form(""),
):
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
    logger.info("Sending image to Claude API (size=%d, type=%s)", len(contents), content_type)
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
            system=_build_system_prompt(),
        )
        logger.info("Claude API response received, usage: %s", response.usage)
    except Exception as e:
        logger.error("Claude API error: %s", e, exc_info=True)
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

    # Override player names if provided by the user
    if player_name:
        if player_color == "white":
            transcription["white_player"] = player_name
        elif player_color == "black":
            transcription["black_player"] = player_name

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

    # Save session
    session_filename = _session_filename(headers)
    session_data = {
        "transcription": transcription,
        "validation": validation,
        "pgn": pgn,
        "headers": headers,
    }
    session_id = _save_session(session_filename, session_data)
    logger.info("Session saved: %s (status=%s, verified=%d)", session_id, validation["status"], len(validation["verified_moves"]))

    return JSONResponse({
        **session_data,
        "session_id": session_id,
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
    session_id = payload.get("session_id", "")

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

        response_data = {
            "validation": {
                **continuation,
                "verified_moves": all_verified,
                "total_verified": len(all_verified),
            },
            "pgn": pgn,
            "headers": headers,
        }
    else:
        result_str = headers.get("result") or "*"
        pgn = build_pgn(verified, headers, result_str) if verified else ""

        response_data = {
            "validation": {
                "status": "complete",
                "verified_moves": verified,
                "total_verified": len(verified),
                "board_fen": board.fen(),
            },
            "pgn": pgn,
            "headers": headers,
        }

    # Update session file if we have a session_id
    if session_id:
        session_file = SESSIONS_DIR / f"{session_id}.json"
        if session_file.exists():
            existing = json.loads(session_file.read_text())
            existing.update(response_data)
            _save_session(f"{session_id}.json", existing)
            response_data["session_id"] = session_id

    return JSONResponse(response_data)


@app.get("/api/sessions")
async def list_sessions():
    """List recent sessions, sorted by most recent first."""
    sessions = []
    for f in SESSIONS_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            sessions.append({
                "session_id": f.stem,
                "white_player": (data.get("headers") or {}).get("white_player") or "?",
                "black_player": (data.get("headers") or {}).get("black_player") or "?",
                "date": (data.get("headers") or {}).get("date"),
                "event": (data.get("headers") or {}).get("event"),
                "total_verified": (data.get("validation") or {}).get("total_verified", 0),
                "status": (data.get("validation") or {}).get("status", "unknown"),
                "created_at": data.get("created_at", 0),
                "updated_at": data.get("updated_at", 0),
            })
        except (json.JSONDecodeError, KeyError):
            continue
    sessions.sort(key=lambda s: s["updated_at"], reverse=True)
    return JSONResponse(sessions[:20])


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Load a specific session."""
    # Sanitize to prevent path traversal
    if "/" in session_id or "\\" in session_id or ".." in session_id:
        return JSONResponse({"error": "Invalid session ID"}, status_code=400)
    session_file = SESSIONS_DIR / f"{session_id}.json"
    if not session_file.exists():
        return JSONResponse({"error": "Session not found"}, status_code=404)
    data = json.loads(session_file.read_text())
    data["session_id"] = session_id
    return JSONResponse(data)


@app.post("/api/correct")
async def correct_move(data: str = Form(...)):
    """Correct a move at a specific position and re-validate from there."""
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    verified_moves = payload.get("verified_moves", [])  # all current verified moves (SAN or UCI)
    move_index = payload.get("move_index", 0)  # 0-based index into verified_moves
    new_san = payload.get("new_san", "")
    session_id = payload.get("session_id", "")
    headers = payload.get("headers", {})
    transcription = payload.get("transcription", {})

    if not new_san or move_index < 0 or move_index >= len(verified_moves):
        return JSONResponse({"error": "Invalid correction"}, status_code=400)

    # Record what the AI originally had
    old_move = verified_moves[move_index]

    # Replay moves up to the correction point
    board = chess.Board()
    replayed = []
    for i, san in enumerate(verified_moves[:move_index]):
        try:
            move = board.parse_san(san)
            board.push(move)
            replayed.append(san)
        except Exception:
            return JSONResponse({"error": f"Failed to replay move {i}: {san}"}, status_code=400)

    # Record the correction (get SAN of old move for the log)
    position_fen = board.fen()
    try:
        old_parsed = board.parse_san(old_move)
        old_san_pretty = board.san(old_parsed)
    except Exception:
        old_san_pretty = old_move

    # Apply the corrected move
    try:
        move = board.parse_san(new_san)
        board.push(move)
        corrected_san = _get_san(board, move)
        replayed.append(corrected_san)
    except Exception:
        return JSONResponse({"error": f"Corrected move is illegal: {new_san}"}, status_code=400)

    # Save the correction for learning
    move_number = (move_index // 2) + 1
    color = "white" if move_index % 2 == 0 else "black"
    player = headers.get("white_player") if color == "white" else headers.get("black_player")
    _save_correction(old_san_pretty, corrected_san, position_fen, player or "unknown", move_number, color)

    # Re-validate remaining moves from transcription after the corrected move
    all_raw_moves = transcription.get("moves", [])
    remaining = buildRemainingFromIndex(all_raw_moves, move_index + 1)

    if remaining:
        continuation = validate_moves(remaining)
        all_verified = replayed + continuation.get("verified_moves", [])

        result_str = "*"
        if continuation["status"] == "complete":
            result_str = headers.get("result") or transcription.get("result") or "*"

        pgn = build_pgn(all_verified, headers, result_str) if all_verified else ""

        response_data = {
            "validation": {
                **continuation,
                "verified_moves": all_verified,
                "total_verified": len(all_verified),
            },
            "pgn": pgn,
            "headers": headers,
            "transcription": transcription,
        }
    else:
        result_str = headers.get("result") or transcription.get("result") or "*"
        pgn = build_pgn(replayed, headers, result_str) if replayed else ""

        response_data = {
            "validation": {
                "status": "complete",
                "verified_moves": replayed,
                "total_verified": len(replayed),
                "board_fen": board.fen(),
            },
            "pgn": pgn,
            "headers": headers,
            "transcription": transcription,
        }

    # Update session
    if session_id:
        session_file = SESSIONS_DIR / f"{session_id}.json"
        if session_file.exists():
            existing = json.loads(session_file.read_text())
            existing.update(response_data)
            _save_session(f"{session_id}.json", existing)
            response_data["session_id"] = session_id

    return JSONResponse(response_data)


def buildRemainingFromIndex(all_raw_moves: list[dict], half_move_index: int) -> list[dict]:
    """Build remaining raw moves starting from a half-move index."""
    remaining = []
    current_half = 0
    for entry in all_raw_moves:
        entry_has_white = "white" in entry
        entry_has_black = "black" in entry

        if entry_has_white:
            if current_half == half_move_index:
                # Start from white's move in this entry
                remaining.append(entry)
                current_half += 1
                if entry_has_black:
                    current_half += 1
                continue
            elif current_half > half_move_index:
                remaining.append(entry)
                current_half += 1
                if entry_has_black:
                    current_half += 1
                continue
            current_half += 1

        if entry_has_black:
            if current_half == half_move_index:
                # Start from black's move in this entry
                remaining.append({"number": entry["number"], "black": entry["black"]})
                current_half += 1
                continue
            elif current_half > half_move_index:
                remaining.append(entry)
                current_half += 1
                continue
            current_half += 1

    return remaining


@app.post("/api/legal-moves")
async def get_legal_moves(data: str = Form(...)):
    """Get legal moves at a specific position after replaying moves up to an index."""
    try:
        payload = json.loads(data)
    except json.JSONDecodeError:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    verified_moves = payload.get("verified_moves", [])
    move_index = payload.get("move_index", 0)  # position BEFORE this move

    board = chess.Board()
    for san in verified_moves[:move_index]:
        try:
            move = board.parse_san(san)
            board.push(move)
        except Exception:
            return JSONResponse({"error": f"Failed to replay move: {san}"}, status_code=400)

    legal = []
    for move in board.legal_moves:
        legal.append({"san": board.san(move), "uci": move.uci()})

    return JSONResponse({
        "legal_moves": legal,
        "fen": board.fen(),
        "current_move": verified_moves[move_index] if move_index < len(verified_moves) else None,
    })


@app.get("/")
async def index():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
