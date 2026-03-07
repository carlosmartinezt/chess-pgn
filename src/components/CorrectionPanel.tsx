import { useState, useEffect } from "react";
import { fetchLegalMoves, correctMove } from "../api";
import type { SessionState, SessionData } from "../types";

interface LegalMove {
  san: string;
  uci: string;
}

interface Props {
  moveIndex: number;
  sessionState: SessionState;
  onDone: (data: SessionData) => void;
  onCancel: () => void;
  onLoading: (loading: boolean) => void;
}

export function CorrectionPanel({ moveIndex, sessionState, onDone, onCancel, onLoading }: Props) {
  const [legalMoves, setLegalMoves] = useState<LegalMove[]>([]);
  const [inputValue, setInputValue] = useState("");

  const moveNum = Math.floor(moveIndex / 2) + 1;
  const color = moveIndex % 2 === 0 ? "white" : "black";
  const currentMove = sessionState.confirmed_moves[moveIndex];

  useEffect(() => {
    fetchLegalMoves(sessionState.confirmed_moves, moveIndex).then((data) => {
      if (!data.error) setLegalMoves(data.legal_moves || []);
    });
  }, [moveIndex, sessionState.confirmed_moves]);

  async function submit(san: string) {
    onLoading(true);
    try {
      const data = await correctMove({
        verified_moves: sessionState.confirmed_moves,
        move_index: moveIndex,
        new_san: san,
        session_id: sessionState.session_id,
        headers: sessionState.headers,
        transcription: sessionState.transcription,
      });
      if (data.error) {
        alert("Error: " + data.error);
        return;
      }
      onDone(data);
    } catch (err) {
      alert("Network error: " + (err as Error).message);
    } finally {
      onLoading(false);
    }
  }

  return (
    <div id="correction-section">
      <h2>Correct Move</h2>
      <div className="ambiguity-info">
        Move {moveNum} ({color}): <strong>{currentMove}</strong> — tap a legal move below to correct it
      </div>

      <div className="correction-input-row">
        <input
          type="text"
          className="text-input"
          placeholder="Type move (e.g. Qb4)"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && inputValue.trim()) submit(inputValue.trim());
          }}
        />
        <button
          className="btn btn-primary"
          style={{ width: "auto", margin: 0, padding: "0.5rem 1rem" }}
          onClick={() => inputValue.trim() && submit(inputValue.trim())}
        >
          Apply
        </button>
      </div>

      <div className="correction-candidates">
        {legalMoves.map((m) => (
          <button key={m.uci} className="correction-candidate" onClick={() => submit(m.san)}>
            {m.san}
          </button>
        ))}
      </div>

      <button className="correction-dismiss" onClick={onCancel}>Cancel</button>
    </div>
  );
}
