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

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

function setConnStatus(msg, type) {
  connStatus.textContent = msg;
  connStatus.className   = type ? `status-row status-${type}` : "status-row";
}

// ── Load saved settings ───────────────────────────────────────────────────────

chrome.storage.local.get(["pfEndpoint", "pfModel"], (result) => {
  endpointInput.value = result.pfEndpoint || DEFAULT_ENDPOINT;
  modelInput.value    = result.pfModel    || DEFAULT_MODEL;
});

// ── Test connection ────────────────────────────────────────────────────────────

testBtn.addEventListener("click", () => {
  const endpoint = endpointInput.value.trim() || DEFAULT_ENDPOINT;

  if (!isValidUrl(endpoint)) {
    setConnStatus("Invalid URL — must start with http:// or https://", "err");
    return;
  }

  setConnStatus("Connecting...", null);
  modelList.innerHTML = "";

  chrome.runtime.sendMessage({ type: "PF_TEST_CONNECTION", endpoint }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      const err = (response && response.error)
        || (chrome.runtime.lastError && chrome.runtime.lastError.message)
        || "Could not reach Ollama";
      setConnStatus(`Connection failed: ${err}`, "err");
      return;
    }

    const { models } = response;
    if (!models.length) {
      setConnStatus("Connected — no models found. Run: ollama pull llama3.2", "warn");
      return;
    }

    setConnStatus(`Connected — ${models.length} model${models.length === 1 ? "" : "s"} available`, "ok");

    const currentModel = modelInput.value.trim();
    models.forEach((name) => {
      const chip = document.createElement("button");
      chip.className   = "model-chip" + (name === currentModel ? " selected" : "");
      chip.textContent = name;
      chip.addEventListener("click", () => {
        modelInput.value = name;
        syncChips(name);
      });
      modelList.appendChild(chip);
    });
  });
});

// ── Sync chip highlight to match text input ───────────────────────────────────

function syncChips(value) {
  document.querySelectorAll(".model-chip").forEach((c) => {
    c.classList.toggle("selected", c.textContent === value);
  });
}

modelInput.addEventListener("input", () => syncChips(modelInput.value.trim()));

// ── Save settings ─────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", () => {
  const endpoint = endpointInput.value.trim() || DEFAULT_ENDPOINT;
  const model    = modelInput.value.trim()    || DEFAULT_MODEL;

  if (!isValidUrl(endpoint)) {
    setConnStatus("Cannot save — invalid URL format.", "err");
    endpointInput.focus();
    return;
  }

  chrome.storage.local.set({ pfEndpoint: endpoint, pfModel: model }, () => {
    savedMsg.classList.add("visible");
    setTimeout(() => savedMsg.classList.remove("visible"), 2000);
  });
});
