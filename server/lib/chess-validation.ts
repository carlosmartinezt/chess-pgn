import { Chess } from "chess.js";

interface MoveData {
  text: string;
  confidence?: string;
  alternatives?: string[];
}

interface MoveEntry {
  number: number;
  white?: MoveData;
  black?: MoveData;
}

interface TryMoveResult {
  status: "ok" | "ambiguous" | "illegal";
  san?: string;
  original_text?: string;
  confidence?: string;
  legal_candidates?: LegalCandidate[];
  context?: BoardContext;
}

interface LegalCandidate {
  san: string;
  original_text: string;
  uci: string;
}

interface LegalMoveInfo {
  san: string;
  uci: string;
}

interface BoardContext {
  fen: string;
  side_to_move: string;
  legal_moves_count: number;
  legal_moves: string[];
  legal_moves_verbose: LegalMoveInfo[];
  in_check: boolean;
  move_number: number;
}

export interface ValidationResult {
  status: string;
  verified_moves: string[];
  total_verified: number;
  board_fen?: string;
  problem_at?: { move_number: number; color: string };
  original_text?: string;
  legal_candidates?: LegalCandidate[];
  context?: BoardContext;
}

export function validateMoves(movesData: MoveEntry[]): ValidationResult {
  const chess = new Chess();
  const verifiedMoves: string[] = [];

  for (const moveEntry of movesData) {
    if (moveEntry.white) {
      const result = tryMove(chess, moveEntry.white);
      if (result.status === "ok") {
        verifiedMoves.push(result.san!);
      } else {
        return buildResponse(verifiedMoves, moveEntry.number, "white", result, chess);
      }
    }

    if (moveEntry.black) {
      const result = tryMove(chess, moveEntry.black);
      if (result.status === "ok") {
        verifiedMoves.push(result.san!);
      } else {
        return buildResponse(verifiedMoves, moveEntry.number, "black", result, chess);
      }
    }
  }

  return {
    status: "complete",
    verified_moves: verifiedMoves,
    total_verified: verifiedMoves.length,
    board_fen: chess.fen(),
  };
}

function tryMove(chess: Chess, moveData: MoveData): TryMoveResult {
  const text = moveData.text.trim();
  const confidence = moveData.confidence || "clear";
  const alternatives = moveData.alternatives || [];

  const normalized = normalizeSan(text);

  // Try the primary reading
  try {
    const move = chess.move(normalized);
    if (move) {
      return { status: "ok", san: move.san };
    }
  } catch {
    // not valid
  }

  // Try alternatives
  const legalCandidates: LegalCandidate[] = [];
  const allAttempts = [...new Set([text, ...alternatives])];

  for (const alt of allAttempts) {
    const normAlt = normalizeSan(alt);
    try {
      const move = chess.move(normAlt);
      if (move) {
        legalCandidates.push({ san: move.san, original_text: alt, uci: moveToUci(move) });
        chess.undo();
      }
    } catch {
      continue;
    }
  }

  // Fuzzy match against all legal moves
  const fuzzy = fuzzyMatchLegalMoves(chess, text);
  for (const fm of fuzzy) {
    if (!legalCandidates.some((c) => c.san === fm.san)) {
      legalCandidates.push(fm);
    }
  }

  if (legalCandidates.length === 1 && confidence === "clear") {
    const move = chess.move(legalCandidates[0].san);
    if (move) {
      return { status: "ok", san: move.san };
    }
  }

  return {
    status: legalCandidates.length > 0 ? "ambiguous" : "illegal",
    original_text: text,
    confidence,
    legal_candidates: legalCandidates,
    context: boardContext(chess),
  };
}

function moveToUci(move: { from: string; to: string; promotion?: string }): string {
  return move.from + move.to + (move.promotion || "");
}

export function normalizeSan(text: string): string {
  let s = text.trim();
  s = s.replace("0-0-0", "O-O-O").replace("0-0", "O-O");
  s = s.replace(/[.,;]+$/, "");
  if (/^o-o-o$/i.test(s)) s = "O-O-O";
  else if (/^o-o$/i.test(s)) s = "O-O";
  return s;
}

function fuzzyMatchLegalMoves(chess: Chess, text: string): LegalCandidate[] {
  const candidates: LegalCandidate[] = [];
  const normalized = normalizeSan(text).toLowerCase().replace(/[x+#]/g, "");

  const moves = chess.moves({ verbose: true });
  for (const move of moves) {
    const sanLower = move.san.toLowerCase().replace(/[x+#]/g, "");
    if (similarity(normalized, sanLower) >= 0.7) {
      candidates.push({ san: move.san, original_text: text, uci: moveToUci(move) });
    }
  }

  return candidates;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  let matches = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / Math.max(a.length, b.length);
}

function boardContext(chess: Chess): BoardContext {
  const verbose = chess.moves({ verbose: true });
  return {
    fen: chess.fen(),
    side_to_move: chess.turn() === "w" ? "white" : "black",
    legal_moves_count: verbose.length,
    legal_moves: verbose.map((m) => m.san),
    legal_moves_verbose: verbose.map((m) => ({ san: m.san, uci: moveToUci(m) })),
    in_check: chess.inCheck(),
    move_number: Math.ceil(chess.moveNumber()),
  };
}

function buildResponse(
  verifiedMoves: string[],
  moveNumber: number,
  color: string,
  result: TryMoveResult,
  chess: Chess
): ValidationResult {
  return {
    status: result.status,
    verified_moves: verifiedMoves,
    total_verified: verifiedMoves.length,
    problem_at: { move_number: moveNumber, color },
    original_text: result.original_text || "",
    legal_candidates: result.legal_candidates || [],
    context: result.context || boardContext(chess),
    board_fen: chess.fen(),
  };
}

export function buildPgn(moves: string[], headers: Record<string, string | null | undefined>, result = "*"): string {
  const chess = new Chess();
  for (const san of moves) {
    chess.move(san);
  }

  const pgn = chess.pgn();
  const headerLines = [
    `[Event "${headers.event || "?"}"]`,
    `[Site "?"]`,
    `[Date "${headers.date || "????.??.??"}"]`,
    `[Round "?"]`,
    `[White "${headers.white_player || "?"}"]`,
    `[Black "${headers.black_player || "?"}"]`,
    `[Result "${result}"]`,
  ];

  if (headers.section) {
    headerLines.push(`[Section "${headers.section}"]`);
  }

  return headerLines.join("\n") + "\n\n" + pgn + " " + result;
}

export function replayMoves(moves: string[]): Chess {
  const chess = new Chess();
  for (const san of moves) {
    const result = chess.move(san);
    if (!result) throw new Error(`Failed to replay move: ${san}`);
  }
  return chess;
}
