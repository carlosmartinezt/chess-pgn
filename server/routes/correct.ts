import { Request, Response } from "express";
import { Chess } from "chess.js";
import { validateMoves, buildPgn } from "../lib/chess-validation.js";
import { saveSession, loadSession, saveCorrection } from "../lib/sessions.js";

export async function correctMove(req: Request, res: Response) {
  const payload = req.body as Record<string, unknown>;

  const verifiedMoves = (payload.verified_moves as string[]) || [];
  const moveIndex = payload.move_index as number;
  const newSan = (payload.new_san as string) || "";
  const sessionId = (payload.session_id as string) || "";
  const headers = (payload.headers as Record<string, string>) || {};
  const transcription = (payload.transcription as Record<string, unknown>) || {};

  if (!newSan || moveIndex < 0 || moveIndex >= verifiedMoves.length) {
    return res.status(400).json({ error: "Invalid correction" });
  }

  const oldMove = verifiedMoves[moveIndex];

  // Replay up to correction point
  const chess = new Chess();
  const replayed: string[] = [];
  for (let i = 0; i < moveIndex; i++) {
    try {
      const move = chess.move(verifiedMoves[i]);
      if (!move) return res.status(400).json({ error: `Failed to replay move ${i}: ${verifiedMoves[i]}` });
      replayed.push(move.san);
    } catch {
      return res.status(400).json({ error: `Failed to replay move ${i}: ${verifiedMoves[i]}` });
    }
  }

  // Get SAN of old move for logging
  const positionFen = chess.fen();
  let oldSanPretty = oldMove;
  try {
    const oldParsed = chess.move(oldMove);
    if (oldParsed) {
      oldSanPretty = oldParsed.san;
      chess.undo();
    }
  } catch {
    // keep original
  }

  // Apply corrected move
  let correctedSan: string;
  try {
    const move = chess.move(newSan);
    if (!move) return res.status(400).json({ error: `Corrected move is illegal: ${newSan}` });
    correctedSan = move.san;
    replayed.push(correctedSan);
  } catch {
    return res.status(400).json({ error: `Corrected move is illegal: ${newSan}` });
  }

  // Save correction for learning
  const moveNumber = Math.floor(moveIndex / 2) + 1;
  const color = moveIndex % 2 === 0 ? "white" : "black";
  const player = color === "white" ? headers.white_player : headers.black_player;
  saveCorrection(oldSanPretty, correctedSan, positionFen, player || "unknown", moveNumber, color);

  // Re-validate remaining
  const allRawMoves = (transcription.moves as []) || [];
  const remaining = buildRemainingFromIndex(allRawMoves, moveIndex + 1);

  let responseData: Record<string, unknown>;

  if (remaining.length > 0) {
    const continuation = validateMoves(remaining as Parameters<typeof validateMoves>[0], chess);
    const allVerified = [...replayed, ...continuation.verified_moves];
    let resultStr = "*";
    if (continuation.status === "complete") {
      resultStr = headers.result || (transcription.result as string) || "*";
    }
    const pgn = allVerified.length > 0 ? buildPgn(allVerified, headers, resultStr) : "";

    responseData = {
      validation: { ...continuation, verified_moves: allVerified, total_verified: allVerified.length },
      pgn,
      headers,
      transcription,
    };
  } else {
    const resultStr = headers.result || (transcription.result as string) || "*";
    const pgn = replayed.length > 0 ? buildPgn(replayed, headers, resultStr) : "";

    responseData = {
      validation: { status: "complete", verified_moves: replayed, total_verified: replayed.length, board_fen: chess.fen() },
      pgn,
      headers,
      transcription,
    };
  }

  if (sessionId) {
    const existing = loadSession(sessionId);
    if (existing) {
      Object.assign(existing, responseData);
      saveSession(`${sessionId}.json`, existing);
      responseData.session_id = sessionId;
    }
  }

  res.json(responseData);
}

interface MoveEntry {
  number: number;
  white?: unknown;
  black?: unknown;
}

function buildRemainingFromIndex(allRawMoves: MoveEntry[], halfMoveIndex: number): MoveEntry[] {
  const remaining: MoveEntry[] = [];
  let currentHalf = 0;

  for (const entry of allRawMoves) {
    const hasWhite = "white" in entry;
    const hasBlack = "black" in entry;

    if (hasWhite) {
      if (currentHalf >= halfMoveIndex) {
        if (currentHalf === halfMoveIndex) {
          remaining.push(entry);
        } else {
          remaining.push(entry);
        }
        currentHalf++;
        if (hasBlack) currentHalf++;
        continue;
      }
      currentHalf++;
    }

    if (hasBlack) {
      if (currentHalf >= halfMoveIndex) {
        if (currentHalf === halfMoveIndex) {
          remaining.push({ number: entry.number, black: entry.black });
        } else {
          remaining.push(entry);
        }
        currentHalf++;
        continue;
      }
      currentHalf++;
    }
  }

  return remaining;
}
