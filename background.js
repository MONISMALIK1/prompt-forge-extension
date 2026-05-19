/**
 * background.js — Service Worker for Prompt Forge.
 *
 * Responsibilities:
 *  1. Cache the last enhanced result per tab (for popup auto-load)
 *  2. Make Ollama API calls on behalf of content scripts (avoids CORS)
 *  3. Handle settings test-connection requests
 */

const PF_DEFAULT_ENDPOINT = "http://localhost:11434";
const PF_DEFAULT_MODEL    = "llama3.2";

const tabState = new Map();

// ── Meta-prompt ────────────────────────────────────────────────────────────────
// Carefully designed so the LLM actually READS the specific prompt and generates
// requirements specific to that exact request — not a generic template.

function pfBuildSystemPrompt() {
  return `You are a senior software engineer with 15+ years of production experience across backend systems, APIs, databases, distributed systems, and frontend engineering.

Your job: rewrite a developer's rough prompt into a precise engineering specification that will get a correct, complete answer from an AI coding assistant.

CRITICAL RULES:
1. Read the specific intent carefully. What is this developer actually trying to build or fix?
2. Generate requirements SPECIFIC to this exact request. Do NOT paste generic best-practice checklists.
3. Identify edge cases specific to THIS implementation — not every edge case that exists in the world.
4. Infer the technology stack from every context clue in the prompt (framework names, function patterns, file extensions, jargon).
5. Output ONLY the rewritten prompt. No preamble. No "Here is the enhanced prompt:" prefix. No meta-commentary.
6. If the original prompt is ambiguous in a way that would lead to meaningfully different implementations, state your interpretation explicitly inside the specification.

The rewritten prompt must:
- Open with one clear, specific task statement
- List technical requirements derived from reading THIS prompt — not copied from a template
- Cover the failure modes THIS specific implementation would actually encounter
- End with these precision constraints (always include this section verbatim at the end):

--- Precision constraints ---
Before writing any code: list every assumption about environment, framework version, and existing interfaces.
Use [UNCERTAIN: reason] instead of inventing API methods or config keys you are not certain exist.
Implement only what is explicitly specified — no unrequested features or abstractions.
State your interpretation of any ambiguous requirement before proceeding.
----------------------------

DO NOT use a rigid section structure if the prompt is simple. Match output length and complexity to the complexity of the actual task.
DO NOT add requirements that are not implied by the original prompt.
DO NOT repeat the same generic phrases ("validate all inputs", "use a connection pool", "add error handling") unless they directly and specifically apply to this exact request.`;
}

// ── Ollama API call ────────────────────────────────────────────────────────────

async function pfCallOllama(rawPrompt, taskType, language) {
  const settings = await chrome.storage.local.get(["pfEndpoint", "pfModel"]);
  const endpoint = settings.pfEndpoint || PF_DEFAULT_ENDPOINT;
  const model    = settings.pfModel    || PF_DEFAULT_MODEL;

  const langHint = language ? ` The language or framework appears to be: ${language}.` : "";
  const typeHint = taskType ? ` Task category: ${taskType}.` : "";

  const userMessage =
    `Rough prompt: "${rawPrompt}"${langHint}${typeHint}\n\n` +
    `Rewrite this as a precise engineering specification.`;

  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: pfBuildSystemPrompt() },
        { role: "user",   content: userMessage },
      ],
      stream:      false,
      temperature: 0.3,    // low = consistent and precise, not creative
      max_tokens:  1400,
    }),
    signal: AbortSignal.timeout(90000), // 90 s — local models can be slow on first call
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ollama returned HTTP ${response.status}${body ? ": " + body.slice(0, 120) : ""}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Ollama returned an empty response");

  return { enhanced: text, model };
}

// ── Message router ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Tab state: cache last result so the popup can pre-fill on open
  if (msg.type === "PF_RESULT" && sender.tab) {
    tabState.set(sender.tab.id, msg.data);
    sendResponse({ ok: true });
  }

  if (msg.type === "PF_GET_STATE") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ state: tabs[0] ? (tabState.get(tabs[0].id) || null) : null });
    });
    return true; // async response
  }

  // LLM enhancement via Ollama
  if (msg.type === "PF_ENHANCE_LLM") {
    const { rawPrompt, taskType, language } = msg;
    pfCallOllama(rawPrompt, taskType, language)
      .then(({ enhanced, model }) =>
        sendResponse({ ok: true, enhanced, model, source: "llm" })
      )
      .catch((err) =>
        sendResponse({ ok: false, error: err.message, source: "fallback" })
      );
    return true; // keep message channel open for async response
  }

  // Settings: test Ollama connection and list available models
  if (msg.type === "PF_TEST_CONNECTION") {
    const endpoint = msg.endpoint || PF_DEFAULT_ENDPOINT;
    fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(6000) })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const models = (data.models || []).map((m) => m.name);
        sendResponse({ ok: true, models });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// Clean up tab state when tabs are closed or navigated away
chrome.tabs.onRemoved.addListener((id) => tabState.delete(id));
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status === "loading") tabState.delete(id);
});
