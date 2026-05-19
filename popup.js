/**
 * popup.js — Prompt Forge popup logic.
 * Uses Ollama (via background worker) for genuine LLM-powered enhancement.
 * Falls back to rule-based enricher if Ollama is not running.
 */

const rawInput    = document.getElementById("raw-input");
const taskSelect  = document.getElementById("task-select");
const enhanceBtn  = document.getElementById("enhance-btn");
const outputTa    = document.getElementById("output-ta");
const copyBtn     = document.getElementById("copy-btn");
const clearBtn    = document.getElementById("clear-btn");
const metaText    = document.getElementById("meta-text");
const taskChip    = document.getElementById("task-chip");
const sourceBadge = document.getElementById("source-badge");
const statusEl    = document.getElementById("status");
const settingsBtn = document.getElementById("settings-btn");

let lastEnhanced = "";
let isLoading    = false;

// Copy starts disabled — enabled only when there is actual output
copyBtn.disabled = true;

// ── Utilities ─────────────────────────────────────────────────────────────────

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className   = `status status-${type}`;
  setTimeout(() => { statusEl.textContent = ""; statusEl.className = "status"; }, 2400);
}

function setLoading(on) {
  isLoading = on;
  enhanceBtn.disabled    = on;
  enhanceBtn.textContent = on ? "Enhancing..." : "Enhance";
  copyBtn.disabled       = on || !lastEnhanced;
  outputTa.placeholder   = on
    ? "Calling Ollama — this may take a few seconds..."
    : "Enhanced prompt will appear here...";
}

function renderSourceBadge(source, model) {
  if (!sourceBadge) return;
  sourceBadge.className = "";
  if (source === "llm") {
    sourceBadge.textContent = model ? `Ollama: ${model}` : "Ollama";
    sourceBadge.className   = "pf-source-llm";
  } else if (source === "fallback") {
    sourceBadge.textContent = "rule-based";
    sourceBadge.className   = "pf-source-fallback";
  } else {
    sourceBadge.textContent = "";
  }
}

// ── Core enhance flow ─────────────────────────────────────────────────────────

async function runEnhance() {
  if (isLoading) return;

  const raw = rawInput.value.trim();
  if (!raw || raw.length < 3) {
    showStatus("Enter at least a few words.", "warn");
    return;
  }

  const override  = taskSelect.value === "auto" ? null : taskSelect.value;
  const taskType  = override || pfDetectTask(raw);
  const language  = pfDetectLanguage(raw);

  setLoading(true);
  outputTa.value = "";

  try {
    const { enhanced, source, model } = await pfEnhanceLLM(raw, taskType, language);

    lastEnhanced = enhanced;
    outputTa.value = enhanced;
    copyBtn.disabled = false;

    taskChip.textContent = taskType.toUpperCase();
    renderSourceBadge(source, model);
    metaText.textContent =
      (language ? `lang: ${language}  |  ` : "") +
      `${enhanced.split(/\s+/).filter(Boolean).length} words`;

    if (!override) taskSelect.value = "auto";

  } catch (err) {
    showStatus("Error: " + err.message, "warn");
  } finally {
    setLoading(false);
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

enhanceBtn.addEventListener("click", runEnhance);

rawInput.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") runEnhance();
});

copyBtn.addEventListener("click", () => {
  if (!lastEnhanced) { showStatus("Nothing to copy yet.", "warn"); return; }
  navigator.clipboard.writeText(lastEnhanced)
    .then(() => showStatus("Copied to clipboard.", "ok"))
    .catch(() => {
      const ta = document.createElement("textarea");
      ta.value = lastEnhanced;
      ta.style.position = "fixed";
      ta.style.opacity  = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showStatus("Copied to clipboard.", "ok");
    });
});

clearBtn.addEventListener("click", () => {
  rawInput.value  = "";
  outputTa.value  = "";
  lastEnhanced    = "";
  taskChip.textContent = "";
  metaText.textContent = "";
  taskSelect.value = "auto";
  renderSourceBadge(null, null);
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// ── Auto-load if the user was already typing on a supported AI site ───────────

chrome.runtime.sendMessage({ type: "PF_GET_STATE" }, (response) => {
  if (chrome.runtime.lastError || !response || !response.state) return;
  const { rawPrompt, enhanced, taskType, language } = response.state;
  if (rawPrompt) rawInput.value = rawPrompt;
  if (enhanced)  { outputTa.value = enhanced; lastEnhanced = enhanced; copyBtn.disabled = false; }
  if (taskType)  taskChip.textContent = taskType.toUpperCase();
  if (language)  metaText.textContent = `lang: ${language}`;
});
