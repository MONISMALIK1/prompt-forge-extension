/**
 * content.js — Prompt Forge content script.
 *
 * Injects an "Enhance" button near the textarea on supported AI chat sites.
 * Clicking it:
 *   1. Reads the current draft prompt
 *   2. Detects task type + language
 *   3. Calls pfEnhanceLLM() — sends to Ollama via the background worker
 *      (falls back to rule-based pfEnhance() if Ollama is not running)
 *   4. Opens a slide-in panel showing the enhanced prompt
 *   5. User can Insert (replaces textarea) or Copy
 */

// ── Site configs ──────────────────────────────────────────────────────────────

const PF_SITES = [
  {
    host:     /chatgpt\.com|chat\.openai\.com/,
    textarea: () => document.querySelector("#prompt-textarea") || document.querySelector("textarea[data-id]"),
    setVal:   (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); },
  },
  {
    host:     /claude\.ai/,
    textarea: () => document.querySelector(".ProseMirror") || document.querySelector('[contenteditable="true"]'),
    setVal:   (el, v) => { el.innerHTML = ""; const p = document.createElement("p"); p.textContent = v; el.appendChild(p); el.dispatchEvent(new InputEvent("input", { bubbles: true })); },
  },
  {
    host:     /gemini\.google\.com/,
    textarea: () => document.querySelector(".ql-editor") || document.querySelector('[contenteditable="true"]'),
    setVal:   (el, v) => { el.innerHTML = ""; const p = document.createElement("p"); p.textContent = v; el.appendChild(p); el.dispatchEvent(new InputEvent("input", { bubbles: true })); },
  },
  {
    host:     /perplexity\.ai/,
    textarea: () => document.querySelector("textarea"),
    setVal:   (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); },
  },
  {
    host:     /poe\.com/,
    textarea: () => document.querySelector("textarea"),
    setVal:   (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); },
  },
  {
    host:     /chat\.mistral\.ai/,
    textarea: () => document.querySelector("textarea"),
    setVal:   (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); },
  },
  {
    host:     /huggingface\.co\/chat/,
    textarea: () => document.querySelector("textarea"),
    setVal:   (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); },
  },
  {
    host:     /grok\.com|x\.com/,
    textarea: () => document.querySelector("textarea") || document.querySelector('[contenteditable="true"]'),
    setVal:   (el, v) => {
      if (el.tagName === "TEXTAREA") {
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        el.innerHTML = "";
        const p = document.createElement("p");
        p.textContent = v;
        el.appendChild(p);
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    },
  },
];

// ── State ─────────────────────────────────────────────────────────────────────

let pfSite       = null;
let pfBtn        = null;
let pfPanel      = null;
let pfLastResult = null;
let pfLoading    = false;

// ── Get prompt text ───────────────────────────────────────────────────────────

function pfGetText(el) {
  if (!el) return "";
  return el.tagName === "TEXTAREA" ? el.value : (el.innerText || el.textContent || "");
}

// ── Build the enhance button ──────────────────────────────────────────────────

function pfCreateButton() {
  if (pfBtn) return pfBtn;
  pfBtn = document.createElement("button");
  pfBtn.id = "pf-enhance-btn";
  pfBtn.textContent = "Enhance";
  pfBtn.title = "Rewrite as a senior engineer would write it (Prompt Forge)";
  pfBtn.addEventListener("click", pfOnEnhanceClick);
  document.body.appendChild(pfBtn);
  return pfBtn;
}

// ── Position button near the bottom of the textarea ──────────────────────────

function pfPositionButton(el) {
  if (!pfBtn || !el) return;
  const r = el.getBoundingClientRect();
  pfBtn.style.top  = `${window.scrollY + r.bottom - 44}px`;
  pfBtn.style.left = `${window.scrollX + r.right  - 110}px`;
  pfBtn.classList.remove("pf-hidden");
}

// ── Build the slide-in panel ──────────────────────────────────────────────────

function pfCreatePanel() {
  if (pfPanel) return;
  pfPanel = document.createElement("div");
  pfPanel.id = "pf-panel";
  pfPanel.className = "pf-panel-closed";
  pfPanel.innerHTML = `
    <div class="pf-panel-header">
      <div class="pf-panel-title">
        <span class="pf-panel-logo">Prompt Forge</span>
        <span class="pf-task-badge" id="pf-task-badge">—</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="pf-source-badge" id="pf-source-badge"></span>
        <button class="pf-close-btn" id="pf-close-btn" title="Close">&#x2715;</button>
      </div>
    </div>

    <div class="pf-meta" id="pf-meta"></div>

    <div class="pf-section-label">Enhanced prompt</div>
    <div class="pf-output-wrap">
      <textarea class="pf-output" id="pf-output" readonly spellcheck="false"
        placeholder="Enhancing with Ollama..."></textarea>
    </div>

    <div class="pf-task-row">
      <label class="pf-label">Task type</label>
      <select class="pf-select" id="pf-task-select">
        <option value="implement">implement</option>
        <option value="debug">debug</option>
        <option value="refactor">refactor</option>
        <option value="review">review</option>
        <option value="design">design</option>
        <option value="test">test</option>
        <option value="optimize">optimize</option>
        <option value="explain">explain</option>
        <option value="security">security</option>
      </select>
      <button class="pf-regen-btn" id="pf-regen-btn">Re-enhance</button>
    </div>

    <div class="pf-actions">
      <button class="pf-btn pf-btn-primary"   id="pf-insert-btn">Insert into chat</button>
      <button class="pf-btn pf-btn-secondary" id="pf-copy-btn">Copy</button>
    </div>

    <div class="pf-status" id="pf-status"></div>
  `;
  document.body.appendChild(pfPanel);

  document.getElementById("pf-close-btn").addEventListener("click", pfClosePanel);
  document.getElementById("pf-insert-btn").addEventListener("click", pfInsert);
  document.getElementById("pf-copy-btn").addEventListener("click", pfCopy);
  document.getElementById("pf-regen-btn").addEventListener("click", pfRegenerate);
}

// ── Loading state helpers ─────────────────────────────────────────────────────

function pfSetLoading(on) {
  pfLoading = on;
  const output    = document.getElementById("pf-output");
  const insertBtn = document.getElementById("pf-insert-btn");
  const copyBtn   = document.getElementById("pf-copy-btn");
  const regenBtn  = document.getElementById("pf-regen-btn");
  const sel       = document.getElementById("pf-task-select");

  if (on) {
    if (output)    { output.value = ""; output.placeholder = "Enhancing with Ollama — this may take a few seconds..."; }
    if (insertBtn) insertBtn.disabled = true;
    if (copyBtn)   copyBtn.disabled   = true;
    if (regenBtn)  regenBtn.disabled  = true;
    if (sel)       sel.disabled       = true;
    if (pfBtn)     pfBtn.textContent  = "Enhancing...";
  } else {
    if (output)    output.placeholder = "";
    if (insertBtn) insertBtn.disabled = false;
    if (copyBtn)   copyBtn.disabled   = false;
    if (regenBtn)  regenBtn.disabled  = false;
    if (sel)       sel.disabled       = false;
    if (pfBtn)     pfBtn.textContent  = "Enhance";
  }
}

// ── Core: run enhancement ─────────────────────────────────────────────────────

async function pfRunEnhance(rawPrompt, overrideType) {
  const taskType = overrideType || pfDetectTask(rawPrompt);
  const language = pfDetectLanguage(rawPrompt);

  pfSetLoading(true);
  pfOpenPanel();

  try {
    const { enhanced, source, model } = await pfEnhanceLLM(rawPrompt, taskType, language);

    pfLastResult = { rawPrompt, taskType, language, enhanced };

    const output     = document.getElementById("pf-output");
    const badge      = document.getElementById("pf-task-badge");
    const sourceBadge = document.getElementById("pf-source-badge");
    const meta       = document.getElementById("pf-meta");
    const sel        = document.getElementById("pf-task-select");

    if (output)     output.value = enhanced;
    if (badge)      badge.textContent = taskType.toUpperCase();
    if (sourceBadge) {
      if (source === "llm") {
        sourceBadge.textContent = model ? `Ollama: ${model}` : "Ollama";
        sourceBadge.style.cssText = "font-size:9.5px;color:#34d399;background:#052e16;border:1px solid #166534;padding:2px 8px;border-radius:4px;font-weight:700;";
      } else {
        sourceBadge.textContent = "rule-based fallback";
        sourceBadge.style.cssText = "font-size:9.5px;color:#f59e0b;background:#1c1400;border:1px solid #92400e;padding:2px 8px;border-radius:4px;font-weight:700;";
      }
    }
    if (meta) {
      meta.textContent = `task: ${taskType}${language ? "  |  lang: " + language : ""}  |  ${enhanced.split(/\s+/).length} words`;
    }
    if (sel) sel.value = taskType;

    // Cache state for popup
    chrome.runtime.sendMessage({ type: "PF_RESULT", data: { rawPrompt, taskType, language, enhanced } });

  } catch (err) {
    pfShowStatus("Enhancement failed: " + err.message, "err");
  } finally {
    pfSetLoading(false);
  }
}

// ── Click handler for the Enhance button ─────────────────────────────────────

async function pfOnEnhanceClick() {
  if (pfLoading) return;
  const el  = pfSite && pfSite.textarea();
  const raw = pfGetText(el).trim();

  if (!raw || raw.length < 3) {
    pfShowStatus("Type something in the chat box first.", "warn");
    return;
  }

  pfCreatePanel();
  await pfRunEnhance(raw, null);
}

// ── Re-enhance with manually chosen task type ─────────────────────────────────

async function pfRegenerate() {
  if (pfLoading || !pfLastResult) return;
  const sel = document.getElementById("pf-task-select");
  await pfRunEnhance(pfLastResult.rawPrompt, sel ? sel.value : null);
  pfShowStatus("Re-enhanced.", "ok");
}

// ── Insert into chat textarea ─────────────────────────────────────────────────

function pfInsert() {
  const el = pfSite && pfSite.textarea();
  if (!el || !pfLastResult) return;
  pfSite.setVal(el, pfLastResult.enhanced);
  pfShowStatus("Inserted into the chat box.", "ok");
  setTimeout(pfClosePanel, 1200);
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────

function pfCopy() {
  if (!pfLastResult) return;
  navigator.clipboard.writeText(pfLastResult.enhanced)
    .then(() => pfShowStatus("Copied to clipboard.", "ok"))
    .catch(() => {
      const ta = document.createElement("textarea");
      ta.value = pfLastResult.enhanced;
      ta.style.position = "fixed";
      ta.style.opacity  = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      pfShowStatus("Copied to clipboard.", "ok");
    });
}

// ── Panel open/close ──────────────────────────────────────────────────────────

function pfOpenPanel() {
  if (!pfPanel) return;
  pfPanel.classList.remove("pf-panel-closed");
  pfPanel.classList.add("pf-panel-open");
}

function pfClosePanel() {
  if (!pfPanel) return;
  pfPanel.classList.remove("pf-panel-open");
  pfPanel.classList.add("pf-panel-closed");
}

// ── Status message ────────────────────────────────────────────────────────────

function pfShowStatus(msg, type) {
  const el = document.getElementById("pf-status");
  if (!el) return;
  el.textContent = msg;
  el.className = `pf-status pf-status-${type}`;
  setTimeout(() => { if (el) el.textContent = ""; }, 2800);
}

// ── Keyboard shortcut: Ctrl+Shift+E / Cmd+Shift+E ────────────────────────────

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "e") {
    e.preventDefault();
    pfOnEnhanceClick();
  }
});

// ── MutationObserver: wait for textarea ──────────────────────────────────────

function pfBoot() {
  pfSite = PF_SITES.find(s => s.host.test(location.hostname));
  if (!pfSite) return;

  pfCreateButton();
  pfCreatePanel();

  const tryAttach = () => {
    const el = pfSite.textarea();
    if (!el || el._pfAttached) return;
    el._pfAttached = true;

    const reposition = () => {
      const text = pfGetText(el).trim();
      if (text.length > 0) {
        pfPositionButton(el);
      } else {
        if (pfBtn) pfBtn.classList.add("pf-hidden");
      }
    };

    el.addEventListener("input",  reposition);
    el.addEventListener("keyup",  reposition);
    el.addEventListener("paste",  () => setTimeout(reposition, 50));
    window.addEventListener("scroll", () => pfPositionButton(el), { passive: true });
    window.addEventListener("resize",  () => pfPositionButton(el), { passive: true });
  };

  tryAttach();
  const obs = new MutationObserver(tryAttach);
  obs.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", pfBoot);
} else {
  pfBoot();
}
