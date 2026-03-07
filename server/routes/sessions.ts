import { Request, Response } from "express";
import { listAllSessions, loadSession as loadSessionData } from "../lib/sessions.js";

export async function listSessions(_req: Request, res: Response) {
  res.json(listAllSessions());
}

export async function getSession(req: Request, res: Response) {
  const sessionId = req.params.sessionId as string;
  const data = loadSessionData(sessionId);
  if (!data) {
    return res.status(404).json({ error: "Session not found" });
  }
  data.session_id = sessionId;
  res.json(data);
}
