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
      // No sessions yet, go straight to upload
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
      const meta = [event, date].filter(Boolean).join(" — ");

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
    // If fetching sessions fails, just show upload
    showUploadForm();
  }
}

function showUploadForm() {
  sessionsSection.classList.add("hidden");
  uploadSection.classList.remove("hidden");
  results.classList.add("hidden");
}

newSessionBtn.addEventListener("click", () => {
  showUploadForm();
});

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

    // Update URL with session ID
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

  // Show PGN
  pgnOutput.textContent = data.pgn || "(no verified moves yet)";
  const v = data.validation;
  verifiedCount.textContent = `${v.total_verified} move${v.total_verified !== 1 ? "s" : ""} verified`;

  // Store session state for resolve flow
  sessionState = {
    confirmed_moves: v.verified_moves || [],
    headers: data.headers || {},
    transcription: data.transcription,
    session_id: data.session_id || (sessionState && sessionState.session_id) || "",
  };

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

function showAmbiguity(validation, transcription) {
  ambiguitySection.classList.remove("hidden");
  const p = validation.problem_at;
  const moveNum = p.move_number;
  const color = p.color;
  const originalText = validation.original_text;
  const candidates = validation.legal_candidates || [];
  const ctx = validation.context || {};

  // Build ambiguity info
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

  const br = document.createElement("br");
  infoDiv.appendChild(br);

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

  // Clear and build
  ambiguityDetails.textContent = "";
  ambiguityDetails.appendChild(infoDiv);

  // Candidate buttons
  if (candidates.length > 0) {
    for (const c of candidates) {
      const btn = document.createElement("button");
      btn.className = "btn-candidate";
      btn.dataset.san = c.san;
      btn.dataset.moveNumber = moveNum;
      btn.dataset.color = color;

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

  // Show legal moves for context
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

  // Figure out remaining moves from transcription
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

    // Update session state
    sessionState.confirmed_moves = data.validation.verified_moves || [];

    // Display updated results
    pgnOutput.textContent = data.pgn || "(no verified moves yet)";
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
  // Return move entries that come AFTER the resolved move
  const remaining = [];
  let pastProblem = false;

  for (const entry of allMoves) {
    if (entry.number === problemMoveNum) {
      if (problemColor === "white" && entry.black) {
        // The resolved move was white's; black's move in same entry is next
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

copyBtn.addEventListener("click", () => {
  const text = pgnOutput.textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast("PGN copied!");
  }).catch(() => {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
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

// Handle browser back/forward
window.addEventListener("popstate", async () => {
  const params = new URLSearchParams(window.location.search);
  const sid = params.get("s");
  if (sid) {
    await loadSession(sid);
  } else {
    await showSessionsList();
  }
});
