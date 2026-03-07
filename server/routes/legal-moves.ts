import { Request, Response } from "express";
import { Chess } from "chess.js";

export async function getLegalMoves(req: Request, res: Response) {
  let payload: Record<string, unknown>;
  try {
    payload = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const verifiedMoves = (payload.verified_moves as string[]) || [];
  const moveIndex = (payload.move_index as number) || 0;

  const chess = new Chess();
  for (const san of verifiedMoves.slice(0, moveIndex)) {
    try {
      const move = chess.move(san);
      if (!move) return res.status(400).json({ error: `Failed to replay move: ${san}` });
    } catch {
      return res.status(400).json({ error: `Failed to replay move: ${san}` });
    }
  }

  const legal = chess.moves({ verbose: true }).map((m) => ({
    san: m.san,
    uci: m.from + m.to + (m.promotion || ""),
  }));

  res.json({
    legal_moves: legal,
    fen: chess.fen(),
    current_move: moveIndex < verifiedMoves.length ? verifiedMoves[moveIndex] : null,
  });
}
