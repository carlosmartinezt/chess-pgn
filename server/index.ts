import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { uploadScoresheet } from "./routes/upload.js";
import { resolveMove } from "./routes/resolve.js";
import { correctMove } from "./routes/correct.js";
import { getLegalMoves } from "./routes/legal-moves.js";
import { listSessions, getSession } from "./routes/sessions.js";
import { suggestMove } from "./routes/suggest.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.post("/api/upload", upload.single("file"), uploadScoresheet);
app.post("/api/resolve", resolveMove);
app.post("/api/correct", correctMove);
app.post("/api/legal-moves", getLegalMoves);
app.post("/api/suggest", suggestMove);
app.get("/api/sessions", listSessions);
app.get("/api/session/:sessionId", getSession);

// Serve built frontend
const clientDir = path.join(__dirname, "..", "dist", "client");
app.use(express.static(clientDir));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

const port = parseInt(process.env.PORT || "8701");
app.listen(port, "127.0.0.1", () => {
  console.log(`Chess PGN server listening on http://127.0.0.1:${port}`);
});
