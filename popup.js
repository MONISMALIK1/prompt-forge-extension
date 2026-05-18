/**
 * popup.js — Prompt Forge popup logic.
 */

const rawInput   = document.getElementById("raw-input");
const taskSelect = document.getElementById("task-select");
const enhanceBtn = document.getElementById("enhance-btn");
const outputTa   = document.getElementById("output-ta");
const copyBtn    = document.getElementById("copy-btn");
const clearBtn   = document.getElementById("clear-btn");
const metaText   = document.getElementById("meta-text");
const taskChip   = document.getElementById("task-chip");
const statusEl   = document.getElementById("status");

let lastEnhanced = "";

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className   = `status status-${type}`;
  setTimeout(() => { statusEl.textContent = ""; statusEl.className = "status"; }, 2200);
}

function runEnhance() {
  const raw = rawInput.value.trim();
  if (!raw || raw.length < 3) {
    showStatus("Enter at least a few words.", "warn");
    return;
  }

  const override  = taskSelect.value === "auto" ? null : taskSelect.value;
  const taskType  = override || pfDetectTask(raw);
  const language  = pfDetectLanguage(raw);
  const enhanced  = pfEnhance(raw, taskType, language);

  lastEnhanced = enhanced;

  outputTa.value    = enhanced;
  taskChip.textContent = taskType.toUpperCase();
  metaText.textContent = (language ? `lang: ${language}  |  ` : "") +
                         `${enhanced.split(/\s+/).length} words`;

  // Sync select to detected type
  if (!override) taskSelect.value = "auto";
}

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
});

// Auto-load if the user was already typing on a supported AI site
chrome.runtime.sendMessage({ type: "PF_GET_STATE" }, (response) => {
  if (chrome.runtime.lastError || !response || !response.state) return;
  const { rawPrompt, enhanced, taskType, language } = response.state;
  if (rawPrompt) rawInput.value = rawPrompt;
  if (enhanced)  { outputTa.value = enhanced; lastEnhanced = enhanced; }
  if (taskType)  taskChip.textContent = taskType.toUpperCase();
  if (language)  metaText.textContent = `lang: ${language}`;
});
