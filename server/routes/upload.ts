import { Request, Response } from "express";
import { validateMoves, buildPgn } from "../lib/chess-validation.js";
import { sessionFilename, saveSession, buildSystemPrompt } from "../lib/sessions.js";
import { getAnthropicClient } from "../lib/anthropic-client.js";

const client = getAnthropicClient();

export async function uploadScoresheet(req: Request, res: Response) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  if (file.size > 10 * 1024 * 1024) {
    return res.status(400).json({ error: "File too large (max 10MB)" });
  }

  const b64 = file.buffer.toString("base64");
  let contentType = file.mimetype || "image/jpeg";
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(contentType)) {
    contentType = "image/jpeg";
  }

  const playerName = (req.body.player_name || "").trim();
  const playerColor = (req.body.player_color || "").trim();

  console.log(`Sending image to Claude API (size=${file.size}, type=${contentType})`);

  let transcription: Record<string, unknown>;
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: b64,
              },
            },
            {
              type: "text",
              text: "Please transcribe this chess scoresheet. Return ONLY the JSON, no markdown fencing.",
            },
          ],
        },
      ],
    });

    console.log("Claude API response received, usage:", response.usage);

    let rawText = (response.content[0] as { text: string }).text.trim();
    if (rawText.startsWith("```")) {
      rawText = rawText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    transcription = JSON.parse(rawText);
  } catch (err) {
    console.error("Claude API error:", err);
    return res.status(500).json({ error: `Vision API error: ${err}` });
  }

  // Override player names if provided
  if (playerName) {
    if (playerColor === "white") transcription.white_player = playerName;
    else if (playerColor === "black") transcription.black_player = playerName;
  }

  const validation = validateMoves((transcription.moves as []) || []);

  const headers: Record<string, string | null | undefined> = {
    event: transcription.event as string,
    white_player: transcription.white_player as string,
    black_player: transcription.black_player as string,
    date: transcription.date as string,
    section: transcription.section as string,
    user_color: playerColor || undefined,
  };

  let resultStr = (transcription.result as string) || "*";
  if (validation.status !== "complete") resultStr = "*";

  const pgn = validation.verified_moves.length > 0 ? buildPgn(validation.verified_moves, headers, resultStr) : "";

  const filename = sessionFilename(headers);
  const sessionData = { transcription, validation, pgn, headers };
  const sessionId = saveSession(filename, sessionData);
  console.log(`Session saved: ${sessionId} (status=${validation.status}, verified=${validation.verified_moves.length})`);

  res.json({ ...sessionData, session_id: sessionId });
}
