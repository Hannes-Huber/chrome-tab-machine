const searchStatus = document.querySelector("#searchStatus");
const searchResults = document.querySelector("#searchResults");
const closeSearchButton = document.querySelector("#closeSearch");
const storageStatus = document.querySelector("#storageStatus");
const storageResults = document.querySelector("#storageResults");
const closeStorageButton = document.querySelector("#closeStorage");
const domainForm = document.querySelector("#domainForm");
const domainInput = document.querySelector("#domainInput");
const customDomainsContainer = document.querySelector("#customDomains");
const duplicateStatus = document.querySelector("#duplicateStatus");
const duplicateResults = document.querySelector("#duplicateResults");
const closeDuplicatesButton = document.querySelector("#closeDuplicates");
const rescanButton = document.querySelector("#rescan");

const STORAGE_DOMAIN_KEY = "customStorageDomains";
const STORAGE_HOSTS = [
  "drive.google.com", "docs.google.com", "onedrive.live.com", "1drv.ms", "sharepoint.com",
  "dropbox.com", "box.com", "mega.nz", "drive.proton.me", "protondrive.com",
  "pcloud.com", "sync.com", "tresorit.com", "icedrive.net", "mediafire.com",
  "workdrive.zoho.com", "disk.yandex.com", "disk.yandex.ru", "disk.yandex.kz", "filen.io", "internxt.com"
];

function customStorageDomains() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_DOMAIN_KEY) || "[]");
    return Array.isArray(value) ? value.filter((domain) => typeof domain === "string") : [];
  } catch {
    return [];
  }
}

function saveCustomStorageDomains(domains) {
  localStorage.setItem(STORAGE_DOMAIN_KEY, JSON.stringify([...new Set(domains)]));
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function isStorageTab(rawUrl, customDomains) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    const known = STORAGE_HOSTS.some((domain) => hostMatches(host, domain));
    const providerPath = (hostMatches(host, "icloud.com") && /\/(?:iclouddrive|drivews)(?:\/|$)/i.test(url.pathname))
      || (hostMatches(host, "proton.me") && /^\/drive(?:\/|$)/i.test(url.pathname))
      || (/^disk\.yandex\.(?:com|ru|kz|by)$/.test(host));
    const custom = customDomains.some((domain) => hostMatches(host, domain));
    const selfHostedCloud = /\/(?:index\.php\/)?apps\/files(?:\/|$)/i.test(url.pathname)
      || /\/(?:index\.php\/)?login(?:\/|$)/i.test(url.pathname) && /nextcloud|owncloud/i.test(url.pathname);
    return known || providerPath || custom || selfHostedCloud;
  } catch {
    return false;
  }
}

function updateStorageButton() {
  const total = storageResults.querySelectorAll("input[data-tab-id]").length;
  closeStorageButton.disabled = total === 0;
}

function renderCustomDomains() {
  customDomainsContainer.replaceChildren();
  for (const domain of customStorageDomains()) {
    const chip = document.createElement("span");
    chip.className = "domain-chip";
    const name = document.createElement("span");
    name.textContent = domain;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-domain";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `${domain} entfernen`);
    remove.addEventListener("click", () => {
      saveCustomStorageDomains(customStorageDomains().filter((item) => item !== domain));
      renderCustomDomains();
      scanTabs();
    });
    chip.append(name, remove);
    customDomainsContainer.append(chip);
  }
}

function renderStorageTabs(tabs) {
  storageResults.replaceChildren();
  const customDomains = customStorageDomains();
  const entries = tabs.filter((tab) => typeof tab.id === "number" && tab.url && isStorageTab(tab.url, customDomains));
  if (entries.length === 0) {
    storageStatus.textContent = "Keine File-Storage-Tabs gefunden.";
    closeStorageButton.disabled = true;
    return;
  }

  storageStatus.textContent = `${entries.length} File-Storage-Tabs gefunden`;
  for (const tab of entries) {
    const row = document.createElement("label");
    row.className = "storage-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.tabId = String(tab.id);
    checkbox.setAttribute("aria-label", `Storage-Tab geöffnet lassen: ${tab.title || tab.url}`);
    checkbox.addEventListener("change", updateStorageButton);
    const info = document.createElement("span");
    info.className = "tab-info";
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || "Unbenannter Tab";
    title.title = title.textContent;
    const host = document.createElement("span");
    host.className = "tab-url";
    host.textContent = new URL(tab.url).hostname;
    info.append(title, host);
    row.append(checkbox, info);
    storageResults.append(row);
  }
  updateStorageButton();
}

function searchTerm(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const isGoogle = /^google\.[a-z.]+$/.test(host) && url.pathname === "/search";
    const isBrave = (host === "search.brave.com" || host === "search.brave") && url.pathname === "/search";
    if (!isGoogle && !isBrave) return null;
    return (url.searchParams.get("q") || "").trim().replace(/\s+/g, " ") || null;
  } catch {
    return null;
  }
}

function searchKeepIds() {
  return [...searchResults.querySelectorAll("input[data-tab-id]:checked")]
    .map((input) => Number(input.dataset.tabId));
}

function updateSearchButton() {
  const total = searchResults.querySelectorAll("input[data-tab-id]").length;
  closeSearchButton.disabled = total === 0;
  closeSearchButton.textContent = total === 0 ? "Nicht markierte schließen" : "Nicht markierte schließen";
}

async function scanSearchTabs(tabs) {
  searchResults.replaceChildren();
  const entries = tabs
    .filter((tab) => typeof tab.id === "number" && tab.url)
    .map((tab) => ({ id: tab.id, term: searchTerm(tab.url) }))
    .filter((entry) => entry.term !== null);

  if (entries.length === 0) {
    searchStatus.textContent = "Keine Google- oder Brave-Such-Tabs gefunden.";
    closeSearchButton.disabled = true;
    return;
  }

  searchStatus.textContent = `${entries.length} Such-Tabs gefunden · Suchbegriffe werden lokal angezeigt`;
  for (const entry of entries) {
    const row = document.createElement("label");
    row.className = "search-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.tabId = String(entry.id);
    checkbox.setAttribute("aria-label", `Such-Tab behalten: ${entry.term}`);
    checkbox.addEventListener("change", updateSearchButton);
    const term = document.createElement("span");
    term.className = "search-term";
    term.textContent = entry.term;
    row.append(checkbox, term);
    searchResults.append(row);
  }
  updateSearchButton();
}

function updateDuplicateButton() {
  const count = duplicateResults.querySelectorAll("input[data-tab-id]:checked").length;
  closeDuplicatesButton.disabled = count === 0;
  closeDuplicatesButton.textContent = count === 0 ? "Ausgewählte Duplikate schließen" : `${count} ausgewählte Duplikate schließen`;
}

function renderDuplicateGroups(groups) {
  duplicateResults.replaceChildren();
  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Keine doppelten Tabs gefunden.";
    duplicateResults.append(empty);
    closeDuplicatesButton.disabled = true;
    return;
  }

  for (const group of groups) {
    const container = document.createElement("article");
    container.className = "group";
    const heading = document.createElement("div");
    heading.className = "group-heading";
    const label = document.createElement("span");
    label.textContent = group[0].title || group[0].url;
    label.title = group[0].url;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${group.length} Tabs`;
    heading.append(label, count);
    container.append(heading);

    for (const tab of group) {
      const row = document.createElement("label");
      row.className = "tab-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.tabId = String(tab.id);
      checkbox.checked = tab.id !== group[0].id;
      checkbox.addEventListener("change", updateDuplicateButton);
      const info = document.createElement("span");
      info.className = "tab-info";
      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.title || "Unbenannter Tab";
      title.title = title.textContent;
      const url = document.createElement("span");
      url.className = "tab-url";
      url.textContent = tab.url;
      url.title = tab.url;
      info.append(title, url);
      row.append(checkbox, info);
      container.append(row);
    }
    duplicateResults.append(container);
  }
  updateDuplicateButton();
}

async function scanTabs() {
  searchStatus.textContent = "Such-Tabs werden geprüft …";
  storageStatus.textContent = "Storage-Tabs werden geprüft …";
  duplicateStatus.textContent = "Tabs werden geprüft …";
  searchResults.replaceChildren();
  storageResults.replaceChildren();
  duplicateResults.replaceChildren();
  closeSearchButton.disabled = true;
  closeStorageButton.disabled = true;
  closeDuplicatesButton.disabled = true;
  try {
    const tabs = await chrome.tabs.query({});
    await scanSearchTabs(tabs);
    renderStorageTabs(tabs);

    const byUrl = new Map();
    for (const tab of tabs) {
      if (typeof tab.id !== "number" || !tab.url) continue;
      let key;
      try {
        key = new URL(tab.url).href;
      } catch {
        continue;
      }
      const group = byUrl.get(key) ?? [];
      group.push(tab);
      byUrl.set(key, group);
    }
    const groups = [...byUrl.values()].filter((group) => group.length > 1);
    const extraCount = groups.reduce((sum, group) => sum + group.length - 1, 0);
    duplicateStatus.textContent = extraCount === 0
      ? "Keine doppelten Tabs gefunden."
      : `${extraCount} mögliche Duplikate in ${groups.length} Gruppen`;
    renderDuplicateGroups(groups);
  } catch (error) {
    searchStatus.textContent = "Tabs konnten nicht gelesen werden. Bitte Erweiterungsberechtigungen prüfen.";
    storageStatus.textContent = "Tabs konnten nicht gelesen werden.";
    duplicateStatus.textContent = "Tabs konnten nicht gelesen werden.";
    console.error("Tab scan failed:", error);
  }
}

rescanButton.addEventListener("click", scanTabs);
domainForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = domainInput.value.trim().toLowerCase();
  if (!value) return;
  try {
    const domain = new URL(value.includes("://") ? value : `https://${value}`).hostname
      .toLowerCase().replace(/^\*\./, "");
    if (!domain || !domain.includes(".")) throw new Error("Invalid domain");
    saveCustomStorageDomains([...customStorageDomains(), domain]);
    domainInput.value = "";
    renderCustomDomains();
    scanTabs();
  } catch {
    domainInput.setCustomValidity("Bitte gib eine gültige Domain ein.");
    domainInput.reportValidity();
  }
});
domainInput.addEventListener("input", () => domainInput.setCustomValidity(""));

closeStorageButton.addEventListener("click", async () => {
  const allStorageIds = [...storageResults.querySelectorAll("input[data-tab-id]")]
    .map((input) => Number(input.dataset.tabId));
  const keep = new Set([...storageResults.querySelectorAll("input[data-tab-id]:checked")]
    .map((input) => Number(input.dataset.tabId)));
  const idsToClose = allStorageIds.filter((id) => !keep.has(id));
  if (idsToClose.length === 0) {
    storageStatus.textContent = "Alle Storage-Tabs sind zum Behalten markiert.";
    return;
  }
  if (!window.confirm(`${idsToClose.length} nicht markierte File-Storage-Tabs schließen?`)) return;
  closeStorageButton.disabled = true;
  try {
    await chrome.tabs.remove(idsToClose);
    storageStatus.textContent = `${idsToClose.length} Storage-Tabs geschlossen.`;
    await scanTabs();
  } catch (error) {
    storageStatus.textContent = "Einige Storage-Tabs konnten nicht geschlossen werden. Die Liste wird aktualisiert …";
    console.error("Closing storage tabs failed:", error);
    await scanTabs();
  }
});
closeSearchButton.addEventListener("click", async () => {
  const allSearchIds = [...searchResults.querySelectorAll("input[data-tab-id]")]
    .map((input) => Number(input.dataset.tabId));
  const keep = new Set(searchKeepIds());
  const idsToClose = allSearchIds.filter((id) => !keep.has(id));
  if (idsToClose.length === 0) {
    searchStatus.textContent = "Alle Such-Tabs sind zum Behalten markiert.";
    return;
  }
  if (!window.confirm(`${idsToClose.length} nicht markierte Such-Tabs schließen? Nur Google- und Brave-Suchergebnisse sind betroffen.`)) return;

  closeSearchButton.disabled = true;
  try {
    await chrome.tabs.remove(idsToClose);
    searchStatus.textContent = `${idsToClose.length} Such-Tabs geschlossen.`;
    await scanTabs();
  } catch (error) {
    searchStatus.textContent = "Einige Such-Tabs konnten nicht geschlossen werden. Die Liste wird aktualisiert …";
    console.error("Closing search tabs failed:", error);
    await scanTabs();
  }
});

closeDuplicatesButton.addEventListener("click", async () => {
  const idsToClose = [...duplicateResults.querySelectorAll("input[data-tab-id]:checked")]
    .map((input) => Number(input.dataset.tabId));
  if (idsToClose.length === 0) return;
  if (!window.confirm(`${idsToClose.length} ausgewählte Duplikat-Tabs schließen?`)) return;
  closeDuplicatesButton.disabled = true;
  try {
    await chrome.tabs.remove(idsToClose);
    await scanTabs();
  } catch (error) {
    duplicateStatus.textContent = "Einige Tabs konnten nicht geschlossen werden. Die Liste wird aktualisiert …";
    console.error("Closing duplicate tabs failed:", error);
    await scanTabs();
  }
});

scanTabs();
renderCustomDomains();
