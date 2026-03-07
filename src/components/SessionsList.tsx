import type { SessionSummary } from "../types";

interface Props {
  sessions: SessionSummary[];
  onSessionClick: (id: string) => void;
  onNewSession: () => void;
}

export function SessionsList({ sessions, onSessionClick, onNewSession }: Props) {
  return (
    <div>
      <h2>Recent Sessions</h2>
      <div id="sessions-list">
        {sessions.map((s) => {
          const isComplete = s.status === "complete";
          const statusClass = isComplete ? "complete" : "in-progress";
          const statusText = isComplete ? "Complete" : `${s.total_verified} moves`;
          const meta = [s.event, s.date].filter(Boolean).join(" \u2014 ");

          return (
            <div key={s.session_id} className="session-item" onClick={() => onSessionClick(s.session_id)}>
              <div>
                <div className="session-players">{s.white_player} vs {s.black_player}</div>
                {meta && <div className="session-meta">{meta}</div>}
              </div>
              <span className={`session-status ${statusClass}`}>{statusText}</span>
            </div>
          );
        })}
      </div>
      <button className="btn btn-primary" style={{ marginBottom: "1rem" }} onClick={onNewSession}>
        New Scoresheet
      </button>
    </div>
  );
}
