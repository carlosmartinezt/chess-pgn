export async function fetchSessions() {
  const resp = await fetch("/api/sessions");
  return resp.json();
}

export async function fetchSession(sessionId: string) {
  const resp = await fetch(`/api/session/${sessionId}`);
  if (!resp.ok) throw new Error("Session not found");
  return resp.json();
}

export async function uploadScoresheet(file: File, playerName?: string, playerColor?: string) {
  const formData = new FormData();
  formData.append("file", file);
  if (playerName) {
    formData.append("player_name", playerName);
    formData.append("player_color", playerColor || "");
  }
  const resp = await fetch("/api/upload", { method: "POST", body: formData });
  return resp.json();
}

export async function resolveMove(payload: Record<string, unknown>) {
  const resp = await fetch("/api/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function correctMove(payload: Record<string, unknown>) {
  const resp = await fetch("/api/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function fetchLegalMoves(verifiedMoves: string[], moveIndex: number) {
  const resp = await fetch("/api/legal-moves", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verified_moves: verifiedMoves, move_index: moveIndex }),
  });
  return resp.json();
}
