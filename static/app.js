const fileInput = document.getElementById("file-input");
const uploadArea = document.getElementById("upload-area");
const uploadSection = document.getElementById("upload-section");
const previewContainer = document.getElementById("preview-container");
const previewImg = document.getElementById("preview-img");
const clearBtn = document.getElementById("clear-btn");
const transcribeBtn = document.getElementById("transcribe-btn");
const loading = document.getElementById("loading");
const results = document.getElementById("results");
const pgnOutput = document.getElementById("pgn-output");
const copyBtn = document.getElementById("copy-btn");
const verifiedCount = document.getElementById("verified-count");
const correctionSection = document.getElementById("correction-section");
const correctionDetails = document.getElementById("correction-details");
const ambiguitySection = document.getElementById("ambiguity-section");
const ambiguityDetails = document.getElementById("ambiguity-details");
const transcriptionOutput = document.getElementById("transcription-output");
const sessionsSection = document.getElementById("sessions-section");
const sessionsList = document.getElementById("sessions-list");
const newSessionBtn = document.getElementById("new-session-btn");
const playerNameInput = document.getElementById("player-name");

let currentFile = null;
let sessionState = null;

// On page load, check for session in URL or show sessions list
(async function init() {
  const params = new URLSearchParams(window.location.search);
  const sid = params.get("s");
  if (sid) {
    await loadSession(sid);
  } else {
    await showSessionsList();
  }
})();

async function showSessionsList() {
  try {
    const resp = await fetch("/api/sessions");
    const sessions = await resp.json();
    if (sessions.length === 0) {
      showUploadForm();
      return;
    }
    sessionsList.innerHTML = "";
    for (const s of sessions) {
      const div = document.createElement("div");
      div.className = "session-item";
      div.dataset.sessionId = s.session_id;

      const isComplete = s.status === "complete";
      const statusClass = isComplete ? "complete" : "in-progress";
      const statusText = isComplete ? "Complete" : `${s.total_verified} moves`;

      const date = s.date || "";
      const event = s.event || "";
      const meta = [event, date].filter(Boolean).join(" \u2014 ");

      const infoDiv = document.createElement("div");
      const playersDiv = document.createElement("div");
      playersDiv.className = "session-players";
      playersDiv.textContent = `${s.white_player} vs ${s.black_player}`;
      infoDiv.appendChild(playersDiv);

      if (meta) {
        const metaDiv = document.createElement("div");
        metaDiv.className = "session-meta";
        metaDiv.textContent = meta;
        infoDiv.appendChild(metaDiv);
      }

      const statusSpan = document.createElement("span");
      statusSpan.className = `session-status ${statusClass}`;
      statusSpan.textContent = statusText;

      div.appendChild(infoDiv);
      div.appendChild(statusSpan);
      div.addEventListener("click", () => {
        window.history.pushState({}, "", `/?s=${s.session_id}`);
        loadSession(s.session_id);
      });
      sessionsList.appendChild(div);
    }
    sessionsSection.classList.remove("hidden");
    uploadSection.classList.add("hidden");
    results.classList.add("hidden");
  } catch (err) {
    showUploadForm();
  }
}

function showUploadForm() {
  sessionsSection.classList.add("hidden");
  uploadSection.classList.remove("hidden");
  results.classList.add("hidden");
}

newSessionBtn.addEventListener("click", () => showUploadForm());

async function loadSession(sessionId) {
  sessionsSection.classList.add("hidden");
  uploadSection.classList.add("hidden");
  loading.classList.remove("hidden");

  try {
    const resp = await fetch(`/api/session/${sessionId}`);
    if (!resp.ok) {
      alert("Session not found");
      await showSessionsList();
      return;
    }
    const data = await resp.json();
    sessionState = {
      confirmed_moves: (data.validation || {}).verified_moves || [],
      headers: data.headers || {},
      transcription: data.transcription,
      session_id: data.session_id,
    };
    displayResults(data);
  } catch (err) {
    alert("Error loading session: " + err.message);
    await showSessionsList();
  } finally {
    loading.classList.add("hidden");
  }
}

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  currentFile = file;
  const url = URL.createObjectURL(file);
  previewImg.src = url;
  previewContainer.classList.remove("hidden");
  uploadArea.classList.add("hidden");
  transcribeBtn.classList.remove("hidden");
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  fileInput.value = "";
  previewContainer.classList.add("hidden");
  uploadArea.classList.remove("hidden");
  transcribeBtn.classList.add("hidden");
  results.classList.add("hidden");
  ambiguitySection.classList.add("hidden");
  correctionSection.classList.add("hidden");
  sessionState = null;
});

transcribeBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  transcribeBtn.disabled = true;
  loading.classList.remove("hidden");
  results.classList.add("hidden");

  const formData = new FormData();
  formData.append("file", currentFile);

  const playerName = playerNameInput.value.trim();
  const colorRadio = document.querySelector('input[name="player-color"]:checked');
  if (playerName) {
    formData.append("player_name", playerName);
    formData.append("player_color", colorRadio ? colorRadio.value : "");
  }

  try {
    const resp = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await resp.json();

    if (data.error) {
      alert("Error: " + data.error);
      return;
    }

    if (data.session_id) {
      window.history.pushState({}, "", `/?s=${data.session_id}`);
    }

    displayResults(data);
  } catch (err) {
    alert("Network error: " + err.message);
  } finally {
    loading.classList.add("hidden");
    transcribeBtn.disabled = false;
  }
});

function displayResults(data) {
  results.classList.remove("hidden");
  uploadSection.classList.add("hidden");
  sessionsSection.classList.add("hidden");
  correctionSection.classList.add("hidden");

  const v = data.validation;
  verifiedCount.textContent = `${v.total_verified} move${v.total_verified !== 1 ? "s" : ""} verified`;

  sessionState = {
    confirmed_moves: v.verified_moves || [],
    headers: data.headers || {},
    transcription: data.transcription,
    session_id: data.session_id || (sessionState && sessionState.session_id) || "",
  };

  // Render interactive move list
  renderMoveList(v.verified_moves || []);

  // Show transcription
  transcriptionOutput.textContent = JSON.stringify(data.transcription, null, 2);

  // Handle ambiguity
  if (v.status === "ambiguous" || v.status === "illegal") {
    showAmbiguity(v, data.transcription);
  } else {
    ambiguitySection.classList.add("hidden");
    if (v.status === "complete") {
      verifiedCount.textContent += " - Complete!";
    }
  }
}

function renderMoveList(moves) {
  // Parse PGN headers from the pgn string for the copy button,
  // but render moves as interactive buttons
  pgnOutput.textContent = "";

  if (moves.length === 0) {
    pgnOutput.textContent = "(no verified moves yet)";
    return;
  }

  // We need SAN moves. The verified_moves may be UCI or SAN.
  // Replay on a board to get proper SAN for display.
  const board = new ChessBoard();
  const sanMoves = [];
  for (const m of moves) {
    const san = board.toSan(m);
    sanMoves.push(san || m);
    if (san) board.pushSan(san);
  }

  const container = document.createElement("div");
  container.className = "moves-list";

  for (let i = 0; i < sanMoves.length; i++) {
    const isWhite = i % 2 === 0;
    if (isWhite) {
      const numSpan = document.createElement("span");
      numSpan.className = "move-number";
      numSpan.textContent = `${Math.floor(i / 2) + 1}.`;
      container.appendChild(numSpan);
    }

    const btn = document.createElement("button");
    btn.className = "move-btn";
    btn.textContent = sanMoves[i];
    btn.dataset.index = i;
    btn.addEventListener("click", () => onMoveClick(i, btn));
    container.appendChild(btn);
  }

  pgnOutput.appendChild(container);
}

async function onMoveClick(moveIndex, btnElement) {
  if (!sessionState) return;

  // Deselect any previously selected
  pgnOutput.querySelectorAll(".move-btn.selected").forEach(b => b.classList.remove("selected"));
  btnElement.classList.add("selected");

  // Fetch legal moves at this position
  const formData = new FormData();
  formData.append("data", JSON.stringify({
    verified_moves: sessionState.confirmed_moves,
    move_index: moveIndex,
  }));

  try {
    const resp = await fetch("/api/legal-moves", { method: "POST", body: formData });
    const data = await resp.json();
    if (data.error) return;

    showCorrectionPanel(moveIndex, data.current_move, data.legal_moves, btnElement.textContent);
  } catch (err) {
    // silently fail
  }
}

function showCorrectionPanel(moveIndex, currentMove, legalMoves, displaySan) {
  correctionSection.classList.remove("hidden");
  correctionDetails.textContent = "";

  const moveNum = Math.floor(moveIndex / 2) + 1;
  const color = moveIndex % 2 === 0 ? "white" : "black";

  // Info line
  const info = document.createElement("div");
  info.className = "ambiguity-info";
  info.appendChild(document.createTextNode(`Move ${moveNum} (${color}): `));
  const currentSpan = document.createElement("strong");
  currentSpan.textContent = displaySan;
  info.appendChild(currentSpan);
  info.appendChild(document.createTextNode(" \u2014 tap a legal move below to correct it"));
  correctionDetails.appendChild(info);

  // Text input for typing a move
  const inputRow = document.createElement("div");
  inputRow.className = "correction-input-row";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-input";
  input.placeholder = "Type move (e.g. Qb4)";
  const applyBtn = document.createElement("button");
  applyBtn.className = "btn btn-primary";
  applyBtn.style.cssText = "width:auto;margin:0;padding:0.5rem 1rem;";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", () => {
    const val = input.value.trim();
    if (val) submitCorrection(moveIndex, val);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = input.value.trim();
      if (val) submitCorrection(moveIndex, val);
    }
  });
  inputRow.appendChild(input);
  inputRow.appendChild(applyBtn);
  correctionDetails.appendChild(inputRow);

  // Legal moves as tappable buttons
  const candidatesDiv = document.createElement("div");
  candidatesDiv.className = "correction-candidates";
  for (const m of legalMoves) {
    const btn = document.createElement("button");
    btn.className = "correction-candidate";
    btn.textContent = m.san;
    btn.addEventListener("click", () => submitCorrection(moveIndex, m.san));
    candidatesDiv.appendChild(btn);
  }
  correctionDetails.appendChild(candidatesDiv);

  // Dismiss button
  const dismiss = document.createElement("button");
  dismiss.className = "correction-dismiss";
  dismiss.textContent = "Cancel";
  dismiss.addEventListener("click", () => {
    correctionSection.classList.add("hidden");
    pgnOutput.querySelectorAll(".move-btn.selected").forEach(b => b.classList.remove("selected"));
  });
  correctionDetails.appendChild(dismiss);

  // Scroll to correction panel
  correctionSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function submitCorrection(moveIndex, newSan) {
  if (!sessionState) return;

  loading.classList.remove("hidden");
  correctionSection.classList.add("hidden");

  const formData = new FormData();
  formData.append("data", JSON.stringify({
    verified_moves: sessionState.confirmed_moves,
    move_index: moveIndex,
    new_san: newSan,
    session_id: sessionState.session_id || "",
    headers: sessionState.headers,
    transcription: sessionState.transcription,
  }));

  try {
    const resp = await fetch("/api/correct", { method: "POST", body: formData });
    const data = await resp.json();

    if (data.error) {
      alert("Error: " + data.error);
      return;
    }

    // Update with corrected data
    if (data.transcription) {
      sessionState.transcription = data.transcription;
    }
    displayResults(data);
    showToast("Move corrected!");
  } catch (err) {
    alert("Network error: " + err.message);
  } finally {
    loading.classList.add("hidden");
  }
}

// Minimal chess board for UCI-to-SAN conversion
// Uses the server for heavy lifting, but we need basic display
class ChessBoard {
  constructor() {
    this.moves = [];
  }
  // For display we just pass through - the server gives us SAN or UCI
  toSan(move) {
    return move; // moves from server are already in a parseable format
  }
  pushSan(san) {
    this.moves.push(san);
  }
}

function showAmbiguity(validation, transcription) {
  ambiguitySection.classList.remove("hidden");
  const p = validation.problem_at;
  const moveNum = p.move_number;
  const color = p.color;
  const originalText = validation.original_text;
  const candidates = validation.legal_candidates || [];
  const ctx = validation.context || {};

  const infoDiv = document.createElement("div");
  infoDiv.className = "ambiguity-info";

  const strong = document.createElement("strong");
  strong.textContent = `Move ${moveNum} (${color}): `;
  infoDiv.appendChild(strong);

  infoDiv.appendChild(document.createTextNode('Read as "'));
  const code = document.createElement("code");
  code.textContent = originalText;
  infoDiv.appendChild(code);
  infoDiv.appendChild(document.createTextNode('"'));
  infoDiv.appendChild(document.createElement("br"));

  if (validation.status === "illegal" && candidates.length === 0) {
    const illegalStrong = document.createElement("strong");
    illegalStrong.textContent = "illegal";
    infoDiv.appendChild(document.createTextNode("This reading is "));
    infoDiv.appendChild(illegalStrong);
    infoDiv.appendChild(document.createTextNode(" in the current position."));
    infoDiv.appendChild(document.createElement("br"));
    infoDiv.appendChild(document.createTextNode("No legal moves match the handwriting."));
  } else if (validation.status === "illegal") {
    const illegalStrong = document.createElement("strong");
    illegalStrong.textContent = "illegal";
    infoDiv.appendChild(document.createTextNode("This reading is "));
    infoDiv.appendChild(illegalStrong);
    infoDiv.appendChild(document.createTextNode(", but these legal moves might match:"));
  } else {
    const ambigStrong = document.createElement("strong");
    ambigStrong.textContent = "ambiguous";
    infoDiv.appendChild(document.createTextNode("This move is "));
    infoDiv.appendChild(ambigStrong);
    infoDiv.appendChild(document.createTextNode(". Pick the correct one:"));
  }

  ambiguityDetails.textContent = "";
  ambiguityDetails.appendChild(infoDiv);

  if (candidates.length > 0) {
    for (const c of candidates) {
      const btn = document.createElement("button");
      btn.className = "btn-candidate";

      const sanSpan = document.createElement("span");
      sanSpan.className = "san";
      sanSpan.textContent = c.san;

      const detailSpan = document.createElement("span");
      detailSpan.className = "detail";
      detailSpan.textContent = `read as "${c.original_text}" \u00b7 UCI: ${c.uci}`;

      btn.appendChild(sanSpan);
      btn.appendChild(document.createTextNode(" "));
      btn.appendChild(detailSpan);
      btn.addEventListener("click", () => resolveMove(c.san, moveNum, color));
      ambiguityDetails.appendChild(btn);
    }
  }

  if (ctx.legal_moves) {
    const hintDiv = document.createElement("div");
    hintDiv.className = "legal-moves-hint";
    const hintStrong = document.createElement("strong");
    hintStrong.textContent = "All legal moves in this position:";
    hintDiv.appendChild(hintStrong);
    hintDiv.appendChild(document.createElement("br"));
    hintDiv.appendChild(document.createTextNode(ctx.legal_moves.join(", ")));
    ambiguityDetails.appendChild(hintDiv);
  }
}

async function resolveMove(san, moveNumber, color) {
  if (!sessionState) return;

  const allMoves = sessionState.transcription.moves || [];
  const remaining = buildRemainingMoves(allMoves, moveNumber, color);

  loading.classList.remove("hidden");

  const payload = {
    confirmed_moves: sessionState.confirmed_moves,
    chosen_san: san,
    remaining_moves: remaining,
    headers: {
      ...sessionState.headers,
      result: sessionState.transcription.result,
    },
    session_id: sessionState.session_id || "",
  };

  try {
    const formData = new FormData();
    formData.append("data", JSON.stringify(payload));
    const resp = await fetch("/api/resolve", { method: "POST", body: formData });
    const data = await resp.json();

    if (data.error) {
      alert("Error: " + data.error);
      return;
    }

    sessionState.confirmed_moves = data.validation.verified_moves || [];

    // Re-render
    renderMoveList(data.validation.verified_moves || []);
    const v = data.validation;
    verifiedCount.textContent = `${v.total_verified} move${v.total_verified !== 1 ? "s" : ""} verified`;

    if (v.status === "ambiguous" || v.status === "illegal") {
      showAmbiguity(v, sessionState.transcription);
    } else {
      ambiguitySection.classList.add("hidden");
      if (v.status === "complete") {
        verifiedCount.textContent += " - Complete!";
      }
    }
  } catch (err) {
    alert("Network error: " + err.message);
  } finally {
    loading.classList.remove("hidden");
    loading.classList.add("hidden");
  }
}

function buildRemainingMoves(allMoves, problemMoveNum, problemColor) {
  const remaining = [];
  let pastProblem = false;

  for (const entry of allMoves) {
    if (entry.number === problemMoveNum) {
      if (problemColor === "white" && entry.black) {
        remaining.push({ number: entry.number, black: entry.black });
      }
      pastProblem = true;
      continue;
    }
    if (pastProblem) {
      remaining.push(entry);
    }
  }

  return remaining;
}

// Copy PGN - reconstruct from session state for clean output
copyBtn.addEventListener("click", () => {
  // Get the full PGN text - use the raw PGN from session if available
  // The pgnOutput now contains interactive elements, so we need to
  // reconstruct the text from the move buttons
  const moveBtns = pgnOutput.querySelectorAll(".move-btn");
  if (moveBtns.length === 0) {
    showToast("No moves to copy");
    return;
  }

  // Build a simple PGN string from visible moves
  let pgn = "";
  const headers = sessionState ? sessionState.headers : {};
  pgn += `[Event "${headers.event || "?"}"]\n`;
  pgn += `[White "${headers.white_player || "?"}"]\n`;
  pgn += `[Black "${headers.black_player || "?"}"]\n`;
  if (headers.date) pgn += `[Date "${headers.date}"]\n`;
  pgn += "\n";

  const moves = [];
  moveBtns.forEach((btn, i) => {
    if (i % 2 === 0) {
      moves.push(`${Math.floor(i / 2) + 1}. ${btn.textContent}`);
    } else {
      moves[moves.length - 1] += ` ${btn.textContent}`;
    }
  });
  pgn += moves.join(" ");

  const result = sessionState && sessionState.transcription ? sessionState.transcription.result : "*";
  pgn += ` ${result || "*"}`;

  navigator.clipboard.writeText(pgn).then(() => {
    showToast("PGN copied!");
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = pgn;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("PGN copied!");
  });
});

function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

window.addEventListener("popstate", async () => {
  const params = new URLSearchParams(window.location.search);
  const sid = params.get("s");
  if (sid) {
    await loadSession(sid);
  } else {
    await showSessionsList();
  }
});
