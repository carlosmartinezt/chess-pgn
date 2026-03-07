const fileInput = document.getElementById("file-input");
const uploadArea = document.getElementById("upload-area");
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

let currentFile = null;
let sessionState = null; // tracks confirmed moves, remaining, headers

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

  try {
    const resp = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await resp.json();

    if (data.error) {
      alert("Error: " + data.error);
      return;
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

  // Show PGN
  pgnOutput.textContent = data.pgn || "(no verified moves yet)";
  const v = data.validation;
  verifiedCount.textContent = `${v.total_verified} move${v.total_verified !== 1 ? "s" : ""} verified`;

  // Store session state for resolve flow
  sessionState = {
    confirmed_moves: v.verified_moves || [],
    headers: data.headers || {},
    transcription: data.transcription,
  };

  // Show transcription
  transcriptionOutput.textContent = JSON.stringify(data.transcription, null, 2);

  // Handle ambiguity
  if (v.status === "ambiguous" || v.status === "illegal") {
    showAmbiguity(v, data.transcription);
  } else {
    ambiguitySection.classList.add("hidden");
    if (v.status === "complete") {
      verifiedCount.textContent += " ✓ Complete!";
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

  let html = `<div class="ambiguity-info">`;
  html += `<strong>Move ${moveNum} (${color}):</strong> Read as "<code>${escapeHtml(originalText)}</code>"`;

  if (validation.status === "illegal" && candidates.length === 0) {
    html += `<br>This reading is <strong>illegal</strong> in the current position.`;
    html += `<br>No legal moves match the handwriting.`;
  } else if (validation.status === "illegal") {
    html += `<br>This reading is <strong>illegal</strong>, but these legal moves might match:`;
  } else {
    html += `<br>This move is <strong>ambiguous</strong>. Pick the correct one:`;
  }
  html += `</div>`;

  // Candidate buttons
  if (candidates.length > 0) {
    for (const c of candidates) {
      html += `<button class="btn-candidate" data-san="${escapeHtml(c.san)}" data-move-number="${moveNum}" data-color="${color}">
        <span class="san">${escapeHtml(c.san)}</span>
        <span class="detail">read as "${escapeHtml(c.original_text)}" · UCI: ${escapeHtml(c.uci)}</span>
      </button>`;
    }
  }

  // Show legal moves for context
  if (ctx.legal_moves) {
    html += `<div class="legal-moves-hint"><strong>All legal moves in this position:</strong><br>${ctx.legal_moves.join(", ")}</div>`;
  }

  ambiguityDetails.innerHTML = html;

  // Wire up candidate buttons
  ambiguityDetails.querySelectorAll(".btn-candidate").forEach((btn) => {
    btn.addEventListener("click", () => resolveMove(btn.dataset.san, parseInt(btn.dataset.moveNumber), btn.dataset.color));
  });
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
        verifiedCount.textContent += " ✓ Complete!";
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
