import { useState, useEffect } from "react";
import { fetchLegalMoves, suggestMove } from "../api";
import type { Validation } from "../types";
import { Chessboard } from "./Chessboard";

interface LegalMove {
  san: string;
  uci: string;
}

interface Props {
  validation: Validation;
  orientation: "white" | "black";
  verifiedMoves: string[];
  onResolve: (san: string, moveNumber: number, color: string) => void;
}

export function AmbiguityPanel({ validation, orientation, verifiedMoves, onResolve }: Props) {
  const p = validation.problem_at!;
  const candidates = validation.legal_candidates || [];
  const [legalMoves, setLegalMoves] = useState<LegalMove[]>([]);
  const [fen, setFen] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{ suggestion: string; reason: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    fetchLegalMoves(verifiedMoves, verifiedMoves.length).then((data) => {
      if (!data.error) {
        setLegalMoves(data.legal_moves || []);
        setFen(data.fen || null);
      }
    });
  }, [verifiedMoves]);

  const turnColor = p.color as "white" | "black";

  function handleBoardMove(san: string) {
    onResolve(san, p.move_number, p.color);
  }

  async function handleAskAI() {
    setAiLoading(true);
    try {
      const result = await suggestMove(verifiedMoves, verifiedMoves.length, validation.original_text || "");
      if (result.error) {
        alert("AI error: " + result.error);
      } else {
        setAiSuggestion(result);
      }
    } catch (err) {
      alert("Network error: " + (err as Error).message);
    } finally {
      setAiLoading(false);
    }
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

      <button
        className="btn btn-secondary"
        style={{ width: "100%", marginBottom: "0.5rem" }}
        onClick={handleAskAI}
        disabled={aiLoading}
      >
        {aiLoading ? "Thinking..." : "Ask AI"}
      </button>

      {aiSuggestion && (
        <div className="ai-suggestion">
          <span className="ai-suggestion-label">AI thinks:</span>
          <button
            className="correction-candidate ai-suggestion-move"
            onClick={() => onResolve(aiSuggestion.suggestion, p.move_number, p.color)}
          >
            {aiSuggestion.suggestion}
          </button>
          <span className="ai-suggestion-reason">{aiSuggestion.reason}</span>
        </div>
      )}

      {fen && legalMoves.length > 0 && (
        <div className="board-container">
          <Chessboard
            fen={fen}
            orientation={orientation}
            turnColor={turnColor}
            legalMoves={legalMoves}
            highlightSquares={
              aiSuggestion
                ? (() => {
                    const m = legalMoves.find((lm) => lm.san === aiSuggestion.suggestion);
                    return m ? [m.uci.slice(0, 2) as `${string}`, m.uci.slice(2, 4) as `${string}`] : null;
                  })()
                : candidates.length > 0
                  ? [candidates[0].uci.slice(0, 2) as `${string}`, candidates[0].uci.slice(2, 4) as `${string}`]
                  : null
            }
            onMove={handleBoardMove}
          />
        </div>
      )}

      {candidates.length > 0 && (
        <>
          <div className="candidates-label">Fuzzy matches:</div>
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
