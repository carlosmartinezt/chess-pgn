import { useState, useRef } from "react";
import { uploadScoresheet } from "../api";
import type { SessionData } from "../types";

interface Props {
  onComplete: (data: SessionData) => void;
  onLoading: (loading: boolean) => void;
}

export function UploadForm({ onComplete, onLoading }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [playerColor, setPlayerColor] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function clearFile() {
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit() {
    if (!file) return;
    onLoading(true);
    try {
      const data = await uploadScoresheet(file, playerName || undefined, playerColor || undefined);
      if (data.error) {
        alert("Error: " + data.error);
        return;
      }
      onComplete(data);
    } catch (err) {
      alert("Network error: " + (err as Error).message);
    } finally {
      onLoading(false);
    }
  }

  return (
    <div>
      <div id="player-info">
        <input
          type="text"
          className="text-input"
          placeholder="Player name (optional)"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
        />
        <div id="color-picker">
          <label className="color-option">
            <input
              type="radio"
              name="player-color"
              value="white"
              checked={playerColor === "white"}
              onChange={() => setPlayerColor("white")}
            />{" "}
            White
          </label>
          <label className="color-option">
            <input
              type="radio"
              name="player-color"
              value="black"
              checked={playerColor === "black"}
              onChange={() => setPlayerColor("black")}
            />{" "}
            Black
          </label>
        </div>
      </div>

      {!preview && (
        <label htmlFor="file-input" className="upload-area">
          <div className="upload-icon">📷</div>
          <div className="upload-text">Tap to take a photo or choose an image</div>
          <div className="upload-hint">JPG, PNG, WebP — max 10MB</div>
          <input
            type="file"
            id="file-input"
            accept="image/*"
            ref={fileRef}
            onChange={handleFile}
          />
        </label>
      )}

      {preview && (
        <div id="preview-container">
          <img id="preview-img" src={preview} alt="Scoresheet preview" />
          <button className="btn btn-secondary" onClick={clearFile}>
            Choose Different Image
          </button>
        </div>
      )}

      {file && (
        <button className="btn btn-primary" onClick={handleSubmit}>
          Transcribe Scoresheet
        </button>
      )}
    </div>
  );
}
