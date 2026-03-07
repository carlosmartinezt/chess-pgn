import { Request, Response } from "express";
import { Chess } from "chess.js";
import { getAnthropicClient } from "../lib/anthropic-client.js";

export async function suggestMove(req: Request, res: Response) {
  const client = getAnthropicClient();
  const payload = req.body as Record<string, unknown>;

  const verifiedMoves = (payload.verified_moves as string[]) || [];
  const moveIndex = payload.move_index as number;
  const originalText = (payload.original_text as string) || "";

  const chess = new Chess();
  for (const san of verifiedMoves.slice(0, moveIndex)) {
    try {
      const move = chess.move(san);
      if (!move) return res.status(400).json({ error: `Failed to replay move: ${san}` });
    } catch {
      return res.status(400).json({ error: `Failed to replay move: ${san}` });
    }
  }

  const legalMoves = chess.moves();
  const moveNumber = Math.floor(moveIndex / 2) + 1;
  const color = moveIndex % 2 === 0 ? "white" : "black";

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `You are helping transcribe a handwritten chess scoresheet. The handwriting for move ${moveNumber} (${color}) was read as "${originalText}" but that is illegal in this position.

FEN: ${chess.fen()}
Legal moves: ${legalMoves.join(", ")}
Previous moves: ${verifiedMoves.slice(0, moveIndex).join(" ")}

Which legal move is most likely what was written? Consider:
1. Visual similarity of handwritten characters (e.g., "a" vs "g", "3" vs "5", "Q" vs "O")
2. Common chess patterns in this position
3. The original reading "${originalText}"

Reply with ONLY a JSON object: {"suggestion": "SAN_MOVE", "reason": "brief explanation"}`,
        },
      ],
    });

    let rawText = (response.content[0] as { text: string }).text.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const result = JSON.parse(rawText);
    res.json(result);
  } catch (err) {
    console.error("Suggest move error:", err);
    res.status(500).json({ error: `AI suggestion failed: ${err}` });
  }
}
