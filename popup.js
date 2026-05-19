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

// ── Utilities ─────────────────────────────────────────────────────────────────

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className   = `status status-${type}`;
  setTimeout(() => { statusEl.textContent = ""; statusEl.className = "status"; }, 2400);
}

function setLoading(on) {
  isLoading = on;
  enhanceBtn.disabled  = on;
  enhanceBtn.textContent = on ? "Enhancing..." : "Enhance";
  outputTa.placeholder = on
    ? "Calling Ollama — this may take a few seconds..."
    : "Enhanced prompt will appear here...";
}

function renderSourceBadge(source, model) {
  if (!sourceBadge) return;
  if (source === "llm") {
    sourceBadge.textContent = model ? `Ollama: ${model}` : "Ollama";
    sourceBadge.style.cssText =
      "font-size:9.5px;font-weight:700;color:#34d399;background:#052e16;" +
      "border:1px solid #166534;padding:2px 7px;border-radius:4px;";
  } else if (source === "fallback") {
    sourceBadge.textContent = "rule-based";
    sourceBadge.style.cssText =
      "font-size:9.5px;font-weight:700;color:#f59e0b;background:#1c1400;" +
      "border:1px solid #92400e;padding:2px 7px;border-radius:4px;";
  } else {
    sourceBadge.textContent = "";
    sourceBadge.style.cssText = "";
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

    taskChip.textContent = taskType.toUpperCase();
    renderSourceBadge(source, model);
    metaText.textContent =
      (language ? `lang: ${language}  |  ` : "") +
      `${enhanced.split(/\s+/).length} words`;

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
  if (enhanced)  { outputTa.value = enhanced; lastEnhanced = enhanced; }
  if (taskType)  taskChip.textContent = taskType.toUpperCase();
  if (language)  metaText.textContent = `lang: ${language}`;
});
