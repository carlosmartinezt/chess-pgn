import type { Validation } from "../types";
import { Chessboard } from "./Chessboard";
import type { Key } from "chessground/types";

interface Props {
  validation: Validation;
  orientation: "white" | "black";
  onResolve: (san: string, moveNumber: number, color: string) => void;
}

export function AmbiguityPanel({ validation, orientation, onResolve }: Props) {
  const p = validation.problem_at!;
  const candidates = validation.legal_candidates || [];
  const ctx = validation.context;
  const fen = ctx?.fen || "";
  const turnColor = ctx?.side_to_move as "white" | "black" || "white";
  const legalMovesVerbose = ctx?.legal_moves_verbose || [];

  // Highlight the AI's best guess on the board
  let highlightSquares: [Key, Key] | null = null;
  if (candidates.length > 0) {
    const bestGuess = candidates[0];
    const from = bestGuess.uci.slice(0, 2) as Key;
    const to = bestGuess.uci.slice(2, 4) as Key;
    highlightSquares = [from, to];
  }

  function handleBoardMove(san: string) {
    onResolve(san, p.move_number, p.color);
  }

  return (
    <div id="ambiguity-section">
      <h2>
        {validation.status === "illegal" ? "Illegal Move" : "Ambiguous Move"}
      </h2>
      <div className="ambiguity-info">
        <strong>Move {p.move_number} ({p.color}):</strong> AI read "<code>{validation.original_text}</code>"
        <br />
        {validation.status === "illegal" && candidates.length === 0 ? (
          <>This is <strong>illegal</strong> here. Make the correct move on the board.</>
        ) : validation.status === "illegal" ? (
          <>This is <strong>illegal</strong>. Make the correct move on the board, or pick a suggestion below.</>
        ) : (
          <>This is <strong>ambiguous</strong>. Make the correct move on the board, or pick one below.</>
        )}
      </div>

      {fen && legalMovesVerbose.length > 0 && (
        <div className="board-container">
          <Chessboard
            fen={fen}
            orientation={orientation}
            turnColor={turnColor}
            legalMoves={legalMovesVerbose}
            highlightSquares={highlightSquares}
            onMove={handleBoardMove}
          />
        </div>
      )}

      {candidates.length > 0 && (
        <>
          <div className="candidates-label">AI suggestions:</div>
          <div className="correction-candidates">
            {candidates.map((c) => (
              <button
                key={c.uci}
                className="correction-candidate"
                onClick={() => onResolve(c.san, p.move_number, p.color)}
              >
                {c.san}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
