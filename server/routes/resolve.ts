import { Request, Response } from "express";
import { Chess } from "chess.js";
import { validateMoves, buildPgn } from "../lib/chess-validation.js";
import { saveSession, loadSession } from "../lib/sessions.js";

export async function resolveMove(req: Request, res: Response) {
  const payload = req.body as Record<string, unknown>;

  const confirmedMoves = (payload.confirmed_moves as string[]) || [];
  const chosenSan = (payload.chosen_san as string) || "";
  const remainingRaw = (payload.remaining_moves as []) || [];
  const headers = (payload.headers as Record<string, string>) || {};
  const sessionId = (payload.session_id as string) || "";

  const chess = new Chess();
  const verified: string[] = [];

  for (const san of confirmedMoves) {
    try {
      const move = chess.move(san);
      if (!move) return res.status(400).json({ error: `Failed to replay move: ${san}` });
      verified.push(move.san);
    } catch {
      return res.status(400).json({ error: `Failed to replay move: ${san}` });
    }
  }

  if (chosenSan) {
    try {
      const move = chess.move(chosenSan);
      if (!move) return res.status(400).json({ error: `Chosen move is illegal: ${chosenSan}` });
      verified.push(move.san);
    } catch {
      return res.status(400).json({ error: `Chosen move is illegal: ${chosenSan}` });
    }
  }

  let responseData: Record<string, unknown>;

  if (remainingRaw.length > 0) {
    const continuation = validateMoves(remainingRaw);
    const allVerified = [...verified, ...continuation.verified_moves];
    let resultStr = "*";
    if (continuation.status === "complete") resultStr = headers.result || "*";
    const pgn = allVerified.length > 0 ? buildPgn(allVerified, headers, resultStr) : "";

    responseData = {
      validation: { ...continuation, verified_moves: allVerified, total_verified: allVerified.length },
      pgn,
      headers,
    };
  } else {
    const resultStr = headers.result || "*";
    const pgn = verified.length > 0 ? buildPgn(verified, headers, resultStr) : "";

    responseData = {
      validation: { status: "complete", verified_moves: verified, total_verified: verified.length, board_fen: chess.fen() },
      pgn,
      headers,
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
