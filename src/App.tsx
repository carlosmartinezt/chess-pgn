import { useState, useEffect, useCallback } from "react";
import { SessionsList } from "./components/SessionsList";
import { UploadForm } from "./components/UploadForm";
import { Results } from "./components/Results";
import { fetchSession, fetchSessions } from "./api";
import type { SessionData, SessionState, SessionSummary } from "./types";

type View = "sessions" | "upload" | "results";

export function App() {
  const [view, setView] = useState<View>("sessions");
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [resultData, setResultData] = useState<SessionData | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchSessions();
      setSessions(data);
      if (data.length === 0) {
        setView("upload");
      } else {
        setView("sessions");
      }
    } catch {
      setView("upload");
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("s");
    if (sid) {
      loadSession(sid);
    } else {
      loadSessions();
    }
  }, [loadSessions]);

  useEffect(() => {
    const handler = () => {
      const params = new URLSearchParams(window.location.search);
      const sid = params.get("s");
      if (sid) {
        loadSession(sid);
      } else {
        loadSessions();
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [loadSessions]);

  async function loadSession(sessionId: string) {
    setLoading(true);
    try {
      const data = await fetchSession(sessionId);
      handleResults(data);
    } catch {
      alert("Session not found");
      loadSessions();
    } finally {
      setLoading(false);
    }
  }

  function handleResults(data: SessionData) {
    const v = data.validation;
    const state: SessionState = {
      confirmed_moves: v.verified_moves || [],
      headers: data.headers || {},
      transcription: data.transcription,
      session_id: data.session_id || sessionState?.session_id || "",
    };
    setSessionState(state);
    setResultData(data);
    setView("results");
  }

  function handleSessionClick(sessionId: string) {
    window.history.pushState({}, "", `/?s=${sessionId}`);
    loadSession(sessionId);
  }

  function handleUploadComplete(data: SessionData) {
    if (data.session_id) {
      window.history.pushState({}, "", `/?s=${data.session_id}`);
    }
    handleResults(data);
  }

  function handleUpdateResults(data: SessionData) {
    handleResults(data);
  }

  return (
    <div className="container">
      <h1>&#9823; Chess Scoresheet &rarr; PGN</h1>
      <p className="subtitle">Upload a photo of a handwritten scoresheet. Every move is validated for legality.</p>

      {loading && (
        <div id="loading">
          <div className="spinner" />
          <p>Loading...</p>
        </div>
      )}

      {!loading && view === "sessions" && (
        <SessionsList
          sessions={sessions}
          onSessionClick={handleSessionClick}
          onNewSession={() => setView("upload")}
        />
      )}

      {!loading && view === "upload" && (
        <UploadForm
          onComplete={handleUploadComplete}
          onLoading={setLoading}
        />
      )}

      {!loading && view === "results" && resultData && sessionState && (
        <Results
          data={resultData}
          sessionState={sessionState}
          onUpdate={handleUpdateResults}
          onLoading={setLoading}
        />
      )}
    </div>
  );
}
