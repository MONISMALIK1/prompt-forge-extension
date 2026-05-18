/**
 * background.js — Service Worker for Prompt Forge extension.
 * Caches the last enhanced result per tab so the popup can display it.
 */

const tabState = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PF_RESULT" && sender.tab) {
    tabState.set(sender.tab.id, msg.data);
    sendResponse({ ok: true });
  }

  if (msg.type === "PF_GET_STATE") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ state: tabs[0] ? (tabState.get(tabs[0].id) || null) : null });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener(id => tabState.delete(id));
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status === "loading") tabState.delete(id);
});
