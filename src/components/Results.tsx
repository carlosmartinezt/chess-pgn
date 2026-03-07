import { useState } from "react";
import { MoveList } from "./MoveList";
import { CorrectionPanel } from "./CorrectionPanel";
import { AmbiguityPanel } from "./AmbiguityPanel";
import { resolveMove as apiResolveMove } from "../api";
import type { SessionData, SessionState } from "../types";

interface Props {
  data: SessionData;
  sessionState: SessionState;
  onUpdate: (data: SessionData) => void;
  onLoading: (loading: boolean) => void;
}

export function Results({ data, sessionState, onUpdate, onLoading }: Props) {
  const [selectedMoveIndex, setSelectedMoveIndex] = useState<number | null>(null);
  const v = data.validation;
  const isComplete = v.status === "complete";

  // Board orientation: show from the user's perspective (default white)
  const orientation: "white" | "black" =
    sessionState.headers.user_color === "black" ? "black" : "white";

  function handleCopyPgn() {
    const moves = v.verified_moves || [];
    if (moves.length === 0) {
      showToast("No moves to copy");
      return;
    }

    const h = sessionState.headers;
    let pgn = `[Event "${h.event || "?"}"]\n`;
    pgn += `[White "${h.white_player || "?"}"]\n`;
    pgn += `[Black "${h.black_player || "?"}"]\n`;
    if (h.date) pgn += `[Date "${h.date}"]\n`;
    pgn += "\n";

    const moveStrs: string[] = [];
    moves.forEach((m, i) => {
      if (i % 2 === 0) moveStrs.push(`${Math.floor(i / 2) + 1}. ${m}`);
      else moveStrs[moveStrs.length - 1] += ` ${m}`;
    });
    pgn += moveStrs.join(" ");
    pgn += ` ${sessionState.transcription.result || "*"}`;

    navigator.clipboard.writeText(pgn).then(
      () => showToast("PGN copied!"),
      () => {
        // Fallback
        const ta = document.createElement("textarea");
        ta.value = pgn;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showToast("PGN copied!");
      }
    );
  }

  async function handleResolve(san: string, moveNumber: number, color: string) {
    const allMoves = sessionState.transcription.moves || [];
    const remaining = buildRemainingMoves(allMoves, moveNumber, color);

    onLoading(true);
    try {
      const result = await apiResolveMove({
        confirmed_moves: sessionState.confirmed_moves,
        chosen_san: san,
        remaining_moves: remaining,
        headers: { ...sessionState.headers, result: sessionState.transcription.result },
        session_id: sessionState.session_id,
      });
      if (result.error) {
        alert("Error: " + result.error);
        return;
      }
      onUpdate({ ...data, ...result, transcription: sessionState.transcription });
    } catch (err) {
      alert("Network error: " + (err as Error).message);
    } finally {
      onLoading(false);
    }
  }

  function handleCorrectionDone(updatedData: SessionData) {
    setSelectedMoveIndex(null);
    onUpdate(updatedData);
  }

  const statusText = `${v.total_verified} move${v.total_verified !== 1 ? "s" : ""} verified${isComplete ? " - Complete!" : ""}`;

  return (
    <div id="results">
      <div id="pgn-section">
        <h2>Verified PGN</h2>
        <div className="pgn-box">
          <MoveList
            moves={v.verified_moves || []}
            selectedIndex={selectedMoveIndex}
            onMoveClick={(i) => setSelectedMoveIndex(i === selectedMoveIndex ? null : i)}
          />
          <button className="btn btn-small" onClick={handleCopyPgn}>Copy PGN</button>
        </div>
        <p id="verified-count">{statusText}</p>
      </div>

      {selectedMoveIndex !== null && (
        <CorrectionPanel
          moveIndex={selectedMoveIndex}
          sessionState={sessionState}
          orientation={orientation}
          onDone={handleCorrectionDone}
          onCancel={() => setSelectedMoveIndex(null)}
          onLoading={onLoading}
        />
      )}

      {(v.status === "ambiguous" || v.status === "illegal") && selectedMoveIndex === null && (
        <AmbiguityPanel
          validation={v}
          orientation={orientation}
          verifiedMoves={sessionState.confirmed_moves}
          onResolve={handleResolve}
        />
      )}

      <div id="transcription-section">
        <details>
          <summary>Raw Transcription</summary>
          <pre id="transcription-output">{JSON.stringify(data.transcription, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}

function buildRemainingMoves(
  allMoves: SessionData["transcription"]["moves"],
  problemMoveNum: number,
  problemColor: string
) {
  const remaining: typeof allMoves = [];
  let pastProblem = false;

  for (const entry of allMoves) {
    if (entry.number === problemMoveNum) {
      if (problemColor === "white" && entry.black) {
        remaining.push({ number: entry.number, black: entry.black });
      }
      pastProblem = true;
      continue;
    }
    if (pastProblem) remaining.push(entry);
  }
  return remaining;
}

function showToast(msg: string) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}
