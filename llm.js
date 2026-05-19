/**
 * llm.js — Prompt Forge LLM bridge.
 *
 * Provides pfEnhanceLLM() for content scripts and the popup.
 * The actual Ollama API call is made by the background service worker
 * to avoid CORS restrictions on content scripts.
 *
 * Falls back to the rule-based pfEnhance() from enricher.js
 * if Ollama is not reachable or returns an error.
 */

/**
 * Enhance a rough prompt using a local Ollama model.
 *
 * @param {string}      rawPrompt  — the user's rough draft
 * @param {string}      taskType   — detected or overridden task type
 * @param {string|null} language   — detected programming language, or null
 * @returns {Promise<{enhanced: string, source: "llm"|"fallback", model: string|null}>}
 */
async function pfEnhanceLLM(rawPrompt, taskType, language) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "PF_ENHANCE_LLM", rawPrompt, taskType, language },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          // Background worker unreachable or Ollama is down — use rule-based fallback
          const enhanced = pfEnhance(rawPrompt, taskType, language);
          resolve({ enhanced, source: "fallback", model: null });
          return;
        }
        resolve({
          enhanced: response.enhanced,
          source:   response.source || "llm",
          model:    response.model  || null,
        });
      }
    );
  });
}
