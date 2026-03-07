import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, "..", "..", "sessions");
const CORRECTIONS_FILE = path.join(SESSIONS_DIR, "corrections.json");

// Ensure sessions dir exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sanitizeName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 30) || "unknown"
  );
}

export function sessionFilename(headers: Record<string, string | null | undefined>): string {
  const white = sanitizeName(headers.white_player || "unknown");
  const black = sanitizeName(headers.black_player || "unknown");
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
  return `${white}_vs_${black}_${date}_${time}.json`;
}

export function saveSession(filename: string, data: Record<string, unknown>): string {
  data.updated_at = Date.now() / 1000;
  if (!data.created_at) {
    data.created_at = data.updated_at;
  }
  const filepath = path.join(SESSIONS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  return filename.replace(/\.json$/, "");
}

export function loadSession(sessionId: string): Record<string, unknown> | null {
  if (sessionId.includes("/") || sessionId.includes("\\") || sessionId.includes("..")) {
    return null;
  }
  const filepath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

export function listAllSessions(): Record<string, unknown>[] {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json") && f !== "corrections.json");
  const sessions: Record<string, unknown>[] = [];

  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8"));
      const headers = (data.headers || {}) as Record<string, string>;
      const validation = (data.validation || {}) as Record<string, unknown>;
      sessions.push({
        session_id: f.replace(/\.json$/, ""),
        white_player: headers.white_player || "?",
        black_player: headers.black_player || "?",
        date: headers.date,
        event: headers.event,
        total_verified: validation.total_verified || 0,
        status: validation.status || "unknown",
        created_at: data.created_at || 0,
        updated_at: data.updated_at || 0,
      });
    } catch {
      continue;
    }
  }

  sessions.sort((a, b) => (b.updated_at as number) - (a.updated_at as number));
  return sessions.slice(0, 20);
}

interface Correction {
  original: string;
  corrected: string;
  position_fen: string;
  player: string;
  move_number: number;
  color: string;
  timestamp: number;
}

export function loadCorrections(): Correction[] {
  if (!fs.existsSync(CORRECTIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(CORRECTIONS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function saveCorrection(
  original: string,
  corrected: string,
  positionFen: string,
  player: string,
  moveNumber: number,
  color: string
): void {
  const corrections = loadCorrections();
  corrections.push({
    original,
    corrected,
    position_fen: positionFen,
    player,
    move_number: moveNumber,
    color,
    timestamp: Date.now() / 1000,
  });
  fs.writeFileSync(CORRECTIONS_FILE, JSON.stringify(corrections, null, 2));
  console.log(`Correction saved: ${original} -> ${corrected} (move ${moveNumber} ${color}, player ${player})`);
}

export function buildSystemPrompt(): string {
  const corrections = loadCorrections();
  let correctionsSection = "";

  if (corrections.length > 0) {
    const misreadings = new Map<string, number>();
    for (const c of corrections) {
      const key = `${c.original}|||${c.corrected}`;
      misreadings.set(key, (misreadings.get(key) || 0) + 1);
    }

    const lines: string[] = [];
    const sorted = [...misreadings.entries()].sort((a, b) => b[1] - a[1]);
    for (const [key, count] of sorted) {
      const [orig, corr] = key.split("|||");
      const times = count > 1 ? ` (${count}x)` : "";
      lines.push(`- "${orig}" was actually "${corr}"${times}`);
    }

    correctionsSection = `

IMPORTANT - Common misreadings from previous scoresheets (learn from these):
${lines.join("\n")}

Pay extra attention to distinguishing these characters in handwriting.`;
  }

  return SYSTEM_PROMPT_BASE + correctionsSection;
}

const SYSTEM_PROMPT_BASE = `You are a chess scoresheet transcription expert. You will be shown a photograph of a handwritten chess scoresheet.

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
Be conservative. When in doubt, mark as "unclear" and provide alternatives.`;
