chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SAVE')
    chrome.storage.local.set({ [msg.key]: msg.data }, () => sendResponse({ ok: true }));
  else if (msg.type === 'LOAD')
    chrome.storage.local.get(msg.key, r => sendResponse({ data: r[msg.key] || null }));
  else if (msg.type === 'CLEAR')
    chrome.storage.local.clear(() => sendResponse({ ok: true }));
  return true;
});
