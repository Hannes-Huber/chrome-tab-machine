const OPENED_AT_KEY = "tabOpenedAtById";
let updateQueue = Promise.resolve();

function updateOpenedAt(update) {
  updateQueue = updateQueue.then(async () => {
    const stored = await chrome.storage.session.get(OPENED_AT_KEY);
    const openedAt = stored[OPENED_AT_KEY] || {};
    update(openedAt);
    await chrome.storage.session.set({ [OPENED_AT_KEY]: openedAt });
  }).catch((error) => {
    console.error("Could not update tab opening timestamps:", error);
  });
  return updateQueue;
}

chrome.tabs.onCreated.addListener((tab) => {
  if (typeof tab.id !== "number") return;
  void updateOpenedAt((openedAt) => {
    openedAt[tab.id] = { at: Date.now(), confidence: 1 };
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void updateOpenedAt((openedAt) => {
    delete openedAt[tabId];
  });
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void updateOpenedAt((openedAt) => {
    openedAt[addedTabId] = openedAt[removedTabId] || { at: Date.now(), confidence: 0.5 };
    delete openedAt[removedTabId];
  });
});
