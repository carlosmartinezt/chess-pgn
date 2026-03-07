import type { Validation } from "../types";

interface Props {
  validation: Validation;
  onResolve: (san: string, moveNumber: number, color: string) => void;
}

export function AmbiguityPanel({ validation, onResolve }: Props) {
  const p = validation.problem_at!;
  const candidates = validation.legal_candidates || [];
  const ctx = validation.context;

  return (
    <div id="ambiguity-section">
      <h2>Ambiguous Move</h2>
      <div className="ambiguity-info">
        <strong>Move {p.move_number} ({p.color}):</strong> Read as "<code>{validation.original_text}</code>"
        <br />
        {validation.status === "illegal" && candidates.length === 0 ? (
          <>
            This reading is <strong>illegal</strong> in the current position.
            <br />
            No legal moves match the handwriting.
          </>
        ) : validation.status === "illegal" ? (
          <>This reading is <strong>illegal</strong>, but these legal moves might match:</>
        ) : (
          <>This move is <strong>ambiguous</strong>. Pick the correct one:</>
        )}
      </div>

      {candidates.map((c) => (
        <button
          key={c.uci}
          className="btn-candidate"
          onClick={() => onResolve(c.san, p.move_number, p.color)}
        >
          <span className="san">{c.san}</span>{" "}
          <span className="detail">read as "{c.original_text}" &middot; UCI: {c.uci}</span>
        </button>
      ))}

      {ctx?.legal_moves && (
        <div className="legal-moves-hint">
          <strong>All legal moves in this position:</strong>
          <br />
          {ctx.legal_moves.join(", ")}
        </div>
      )}
    </div>
  );
}
