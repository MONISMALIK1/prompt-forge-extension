/**
 * settings.js — Prompt Forge options page logic.
 */

const endpointInput = document.getElementById("endpoint-input");
const modelInput    = document.getElementById("model-input");
const testBtn       = document.getElementById("test-btn");
const saveBtn       = document.getElementById("save-btn");
const connStatus    = document.getElementById("conn-status");
const modelList     = document.getElementById("model-list");
const savedMsg      = document.getElementById("saved-msg");

const DEFAULT_ENDPOINT = "http://localhost:11434";
const DEFAULT_MODEL    = "llama3.2";

// ── Load saved settings ───────────────────────────────────────────────────────

chrome.storage.local.get(["pfEndpoint", "pfModel"], (result) => {
  endpointInput.value = result.pfEndpoint || DEFAULT_ENDPOINT;
  modelInput.value    = result.pfModel    || DEFAULT_MODEL;
});

// ── Test connection ────────────────────────────────────────────────────────────

testBtn.addEventListener("click", () => {
  const endpoint = endpointInput.value.trim() || DEFAULT_ENDPOINT;
  connStatus.textContent = "Connecting...";
  connStatus.className   = "status-row";
  modelList.innerHTML    = "";

  chrome.runtime.sendMessage({ type: "PF_TEST_CONNECTION", endpoint }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      const err = (response && response.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "Could not reach Ollama";
      connStatus.textContent = `Connection failed: ${err}`;
      connStatus.className   = "status-row status-err";
      return;
    }

    const { models } = response;
    if (!models.length) {
      connStatus.textContent = "Connected — no models found. Run: ollama pull llama3.2";
      connStatus.className   = "status-row status-warn";
      return;
    }

    connStatus.textContent = `Connected — ${models.length} model${models.length === 1 ? "" : "s"} available`;
    connStatus.className   = "status-row status-ok";

    const currentModel = modelInput.value.trim();
    models.forEach((name) => {
      const chip = document.createElement("button");
      chip.className   = "model-chip" + (name === currentModel ? " selected" : "");
      chip.textContent = name;
      chip.addEventListener("click", () => {
        modelInput.value = name;
        document.querySelectorAll(".model-chip").forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
      });
      modelList.appendChild(chip);
    });
  });
});

// ── Save settings ─────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", () => {
  const endpoint = endpointInput.value.trim() || DEFAULT_ENDPOINT;
  const model    = modelInput.value.trim()    || DEFAULT_MODEL;

  chrome.storage.local.set({ pfEndpoint: endpoint, pfModel: model }, () => {
    savedMsg.classList.add("visible");
    setTimeout(() => savedMsg.classList.remove("visible"), 2000);
  });
});
