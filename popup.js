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
const analyzeTitlesButton = document.querySelector("#analyzeTitles");
const groupingStatus = document.querySelector("#groupingStatus");
const titleGroupsContainer = document.querySelector("#titleGroups");
const ungroupedTabsContainer = document.querySelector("#ungroupedTabs");
const applyGroupsButton = document.querySelector("#applyGroups");

let proposedTitleGroups = [];
let currentWindowSnapshot = [];
let lastUngroupedTabs = [];
let lastGroupingBoundaryCount = 0;
analyzeTitlesButton.disabled = true;

const TITLE_STOPWORDS = new Set((
  "der die das den dem des ein eine einer einem eines und oder aber fuer fur von vom im in am an auf aus mit ohne ueber unter zu zum zur bei als ist sind war waren wird werden the a an and or but for from of in on at to with without about by is are was were be this that these those your my home page new tab login sign in sign up dashboard startseite"
).split(/\s+/));

const TITLE_TOPICS = [
  { id: "game-development", label: "Game Development", patterns: [/\bunreal(?:\s+engine)?\b/, /\bue[45]\b/, /\bunity\b/, /\bgodot\b/, /\bgame\s*(?:dev|development|developer|design|programming|art)\b/, /\bvideo\s*games?\b/, /\b3d\s+artists?\b/, /\blevel\s+design\b/] },
  { id: "3d-art", label: "3D Art & Modeling", patterns: [/\b3d\s*(?:artist|art|model(?:ing|ling)?|sculpt(?:ing)?)\b/, /\b(?:blender|maya|zbrush|3ds\s*max|substance\s+painter)\b/, /\bcharacter\s+(?:art|modeling|modelling|sculpting)\b/] },
  { id: "jewelry-engagement", label: "Ringe & Verlobung", patterns: [/\bverlobungsring(?:e|en)?\b/, /\b(?:jewelry|jewellery|schmuck|engagement\s+rings?|wedding\s+rings?|bridal\s+jewelry)\b/, /(?=.*\b(?:engagement|verlobung|wedding|bridal)\b)(?=.*\b(?:ring|jewelry|jewellery|diamond|schmuck)\b)/] },
  { id: "web-development", label: "Web Development", patterns: [/\b(?:react|angular|vue(?:\.js)?|svelte|next\.js|nuxt|frontend|front\s*end|web\s+development)\b/, /\bhtml\b.*\bcss\b/, /\bjavascript\b/] },
  { id: "software-development", label: "Software Development", patterns: [/\b(?:software\s+development|programming|coding|developer|python|java|rust|golang|typescript|c\+\+|c#|git|api)\b/] },
  { id: "ai-ml", label: "AI & Machine Learning", patterns: [/\b(?:artificial\s+intelligence|machine\s+learning|deep\s+learning|neural\s+networks?|llm|generative\s+ai|chatgpt|gpt-[\w.]+)\b/] },
  { id: "data-science", label: "Data Science", patterns: [/\b(?:data\s+science|data\s+analysis|analytics|pandas|numpy|sql|statistics|visualization)\b/] },
  { id: "cloud-devops", label: "Cloud & DevOps", patterns: [/\b(?:docker|kubernetes|k8s|aws|azure|google\s+cloud|devops|terraform|cloud\s+computing|ci\/cd)\b/] },
  { id: "cybersecurity", label: "Cybersecurity", patterns: [/\b(?:cybersecurity|cyber\s+security|infosec|penetration\s+testing|pentest|vulnerability|encryption)\b/] },
  { id: "career", label: "Jobs & Careers", patterns: [/\b(?:stellenausschreibung(?:en)?|stellenanzeige(?:n)?|job\s+(?:opening|listing|posting)|careers?|hiring|vacanc(?:y|ies)|bewerbung(?:en)?|stellenangebot(?:e)?)\b/] }
];

function normalizedTitle(title) {
  return (title || "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function titleTopics(title) {
  const normalized = normalizedTitle(title);
  return TITLE_TOPICS.filter((topic) => topic.patterns.some((pattern) => pattern.test(normalized)));
}

function titleTokens(title) {
  return normalizedTitle(title)
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => (token.length > 2 || token === "3d") && !TITLE_STOPWORDS.has(token) && !/^\d+$/.test(token)) ?? [];
}

function titleVectors(tabs, pageSummaries = new Map()) {
  const documents = tabs.map((tab) => {
    const analysisText = `${tab.title || ""} ${pageSummaries.get(tab.id) || ""}`.trim();
    return { tab, tokens: titleTokens(analysisText), topics: titleTopics(analysisText) };
  });
  const documentFrequency = new Map();
  for (const document of documents) {
    for (const token of new Set(document.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }
  const idf = new Map([...documentFrequency].map(([token, frequency]) => [
    token,
    Math.log(1 + (documents.length + 1) / (frequency + 1))
  ]));
  return documents.map((document) => {
    const counts = new Map();
    for (const token of document.tokens) counts.set(token, (counts.get(token) || 0) + 1);
    const vector = new Map([...counts].map(([token, count]) => [
      token,
      (count / Math.max(document.tokens.length, 1)) * idf.get(token)
    ]));
    const norm = Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));
    return { ...document, vector, norm };
  });
}

function titleCosine(left, right) {
  if (!left.norm || !right.norm) return 0;
  let dot = 0;
  for (const [token, value] of left.vector) dot += value * (right.vector.get(token) || 0);
  return dot / (left.norm * right.norm);
}

function titleTopicSimilarity(left, right) {
  const rightTopics = new Set(right.topics.map((topic) => topic.id));
  const leftTopics = new Set(left.topics.map((topic) => topic.id));
  const shared = [...leftTopics].filter((topic) => rightTopics.has(topic)).length;
  const smallestTopicSet = Math.min(leftTopics.size, rightTopics.size);
  return smallestTopicSet ? 0.72 * shared / smallestTopicSet : 0;
}

function titleAffinity(left, right) {
  return Math.max(titleCosine(left, right), titleTopicSimilarity(left, right));
}

function makeTitleGroups(tabs, pageSummaries = new Map()) {
  const orderedTabs = tabs.filter((tab) => !tab.pinned).sort((left, right) => left.index - right.index);
  const documents = titleVectors(orderedTabs.filter((tab) => tab.title), pageSummaries);
  const documentByTabId = new Map(documents.map((document) => [document.tab.id, document]));
  const boundaryAfter = [];
  const anchorsByBoundary = [];
  const LOCAL_MATCH_THRESHOLD = 0.28;
  const REMOTE_OVERRIDE_FLOOR = 0.24;
  const boundaryCount = Math.max(0, orderedTabs.length - 1);
  let treeSize = 1;
  while (treeSize < boundaryCount) treeSize *= 2;
  const remoteInfluenceTree = Array(treeSize * 2).fill(null);
  const updateRemoteRange = (left, right, candidate) => {
    let startNode = left + treeSize;
    let endNode = right + treeSize;
    while (startNode <= endNode) {
      if (startNode % 2 === 1) {
        if (!remoteInfluenceTree[startNode] || candidate.influence > remoteInfluenceTree[startNode].influence) {
          remoteInfluenceTree[startNode] = candidate;
        }
        startNode += 1;
      }
      if (endNode % 2 === 0) {
        if (!remoteInfluenceTree[endNode] || candidate.influence > remoteInfluenceTree[endNode].influence) {
          remoteInfluenceTree[endNode] = candidate;
        }
        endNode -= 1;
      }
      startNode = Math.floor(startNode / 2);
      endNode = Math.floor(endNode / 2);
    }
  };
  const remoteInfluenceAt = (boundary) => {
    let node = boundary + treeSize;
    let strongest = { influence: 0, tabIds: [] };
    while (node > 0) {
      const candidate = remoteInfluenceTree[node];
      if (candidate && candidate.influence > strongest.influence) strongest = candidate;
      node = Math.floor(node / 2);
    }
    return strongest;
  };

  // Each remote title pair contributes a distance-weighted influence to every
  // boundary it spans. Range-max updates avoid cubic work on large tab strips.
  for (let left = 0; left < orderedTabs.length; left += 1) {
    const first = documentByTabId.get(orderedTabs[left].id);
    if (!first) continue;
    for (let right = left + 2; right < orderedTabs.length; right += 1) {
      const second = documentByTabId.get(orderedTabs[right].id);
      if (!second) continue;
      const influence = titleAffinity(first, second) / Math.sqrt(right - left);
      if (influence > 0) {
        updateRemoteRange(left, right - 1, { influence, tabIds: [first.tab.id, second.tab.id] });
      }
    }
  }

  for (let boundary = 0; boundary < orderedTabs.length - 1; boundary += 1) {
    const leftTab = orderedTabs[boundary];
    const rightTab = orderedTabs[boundary + 1];
    const leftDoc = documentByTabId.get(leftTab.id);
    const rightDoc = documentByTabId.get(rightTab.id);
    const localInfluence = leftDoc && rightDoc ? titleAffinity(leftDoc, rightDoc) : 0;
    const strongestRemote = remoteInfluenceAt(boundary);

    const remoteOverrides = strongestRemote.influence > Math.max(localInfluence, REMOTE_OVERRIDE_FLOOR);
    const hasLocalMatch = localInfluence >= LOCAL_MATCH_THRESHOLD;
    const isBoundary = !hasLocalMatch && !remoteOverrides;
    boundaryAfter.push(isBoundary);
    anchorsByBoundary.push(hasLocalMatch
      ? [leftTab.id, rightTab.id]
      : remoteOverrides ? strongestRemote.tabIds : []);
  }

  const segments = [];
  let start = 0;
  for (let boundary = 0; boundary < boundaryAfter.length; boundary += 1) {
    if (!boundaryAfter[boundary]) continue;
    segments.push({ start, end: boundary });
    start = boundary + 1;
  }
  if (orderedTabs.length > 0) segments.push({ start, end: orderedTabs.length - 1 });
  lastGroupingBoundaryCount = boundaryAfter.filter(Boolean).length;

  const allSegments = segments.map(({ start: first, end: last }) => {
    const rangeTabs = orderedTabs.slice(first, last + 1);
    const tabIds = new Set(rangeTabs.map((tab) => tab.id));
    const anchorIds = new Set();
    for (let boundary = first; boundary < last; boundary += 1) {
      for (const id of anchorsByBoundary[boundary] || []) {
        if (tabIds.has(id)) anchorIds.add(id);
      }
    }
    const anchorDocuments = [...anchorIds].map((id) => documentByTabId.get(id)).filter(Boolean);
    const basis = anchorDocuments.length ? anchorDocuments : rangeTabs.map((tab) => documentByTabId.get(tab.id)).filter(Boolean);
    const topicCounts = new Map();
    const termWeights = new Map();
    const termCounts = new Map();
    for (const document of basis) {
      for (const topic of document.topics) topicCounts.set(topic.id, (topicCounts.get(topic.id) || 0) + 1);
      for (const token of new Set(document.tokens)) termCounts.set(token, (termCounts.get(token) || 0) + 1);
      for (const [token, weight] of document.vector) termWeights.set(token, (termWeights.get(token) || 0) + weight);
    }
    const sharedTopics = TITLE_TOPICS
      .filter((topic) => (topicCounts.get(topic.id) || 0) > 1)
      .sort((left, right) => topicCounts.get(right.id) - topicCounts.get(left.id));
    const sharedTerms = [...termWeights]
      .filter(([token]) => termCounts.get(token) > 1)
      .sort((left, right) => right[1] - left[1]);
    const name = sharedTopics.length
      ? sharedTopics.slice(0, 2).map((topic) => topic.label).join(" · ")
      : (sharedTerms.length ? sharedTerms : [...termWeights].sort((left, right) => right[1] - left[1]))
        .slice(0, 2).map(([token]) => token.charAt(0).toLocaleUpperCase() + token.slice(1)).join(" · ");
    return {
      name: name || (rangeTabs.length === 1 ? rangeTabs[0].title : "Verwandte Tabs"),
      topics: sharedTopics.map((topic) => topic.label),
      tabIds: rangeTabs.map((tab) => tab.id),
      titles: rangeTabs.map((tab) => tab.title || "Unbenannter Tab"),
      includedBetween: rangeTabs.length > 1 ? Math.max(0, rangeTabs.length - anchorIds.size) : 0,
      boundaryStart: first > 0,
      boundaryEnd: last < orderedTabs.length - 1
    };
  });
  lastUngroupedTabs = allSegments.filter((group) => group.tabIds.length === 1)
    .map((group) => ({ title: group.titles[0], index: orderedTabs.find((tab) => tab.id === group.tabIds[0])?.index ?? 0 }));
  return allSegments.filter((group) => group.tabIds.length > 1);
}

function extractPageContext() {
  const clean = (value, maxLength) => (value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  const description = document.querySelector('meta[name="description"], meta[property="og:description"]')?.content || "";
  const headings = [...document.querySelectorAll("h1, h2")]
    .slice(0, 4)
    .map((heading) => clean(heading.textContent, 90))
    .filter(Boolean)
    .join(" ");
  const root = document.querySelector("main, article, [role='main']") || document.body;
  let visibleSample = "";
  if (root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && visibleSample.length < 450) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, noscript, nav, footer, header, aside, form, [hidden], [aria-hidden='true']")) continue;
      if (parent.getClientRects().length === 0) continue;
      const text = clean(node.nodeValue, 450 - visibleSample.length);
      if (text) visibleSample += `${visibleSample ? " " : ""}${text}`;
    }
  }
  return [clean(description, 180), clean(headings, 240), clean(visibleSample, 450)]
    .filter(Boolean)
    .join(" ")
    .slice(0, 850);
}

async function readPageContexts(tabs) {
  const readableTabs = tabs.filter((tab) => {
    try {
      const url = new URL(tab.url);
      return (url.protocol === "https:" || url.protocol === "http:") && typeof tab.id === "number";
    } catch {
      return false;
    }
  });
  const results = await Promise.all(readableTabs.map(async (tab) => {
    try {
      const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageContext });
      return [tab.id, typeof injected[0]?.result === "string" ? injected[0].result : ""];
    } catch {
      return [tab.id, ""];
    }
  }));
  return new Map(results.filter(([, context]) => context));
}

function beginTitleAnalysis() {
  const tabs = [...currentWindowSnapshot];
  const origins = [...new Set(tabs.flatMap((tab) => {
    try {
      const url = new URL(tab.url);
      return url.protocol === "https:" || url.protocol === "http:" ? [`${url.protocol}//${url.hostname}/*`] : [];
    } catch {
      return [];
    }
  }))];

  if (origins.length === 0) {
    void createTitleGroupSuggestions(tabs, false);
    return;
  }

  // Request only the currently open site origins, directly from this click.
  groupingStatus.textContent = `Bitte erlaube den Zugriff auf ${origins.length} derzeit offene Website${origins.length === 1 ? "" : "s"}; es werden nur kurze Textproben lokal ausgewertet.`;
  analyzeTitlesButton.disabled = true;
  let permissionRequest;
  try {
    permissionRequest = chrome.permissions.request({ permissions: ["scripting"], origins });
  } catch (error) {
    console.error("Optional page access request failed:", error);
    void createTitleGroupSuggestions(tabs, false);
    return;
  }
  permissionRequest.then((granted) => createTitleGroupSuggestions(tabs, granted))
    .catch((error) => {
      console.error("Optional page access request failed:", error);
      void createTitleGroupSuggestions(tabs, false);
    });
}

async function createTitleGroupSuggestions(tabs, canReadPages) {
  groupingStatus.textContent = canReadPages
    ? "Kurze Seitenkontexte werden gelesen und lokal verglichen …"
    : "Seitentitel werden lokal verglichen …";
  titleGroupsContainer.replaceChildren();
  ungroupedTabsContainer.replaceChildren();
  applyGroupsButton.disabled = true;
  analyzeTitlesButton.disabled = true;
  try {
    const pageSummaries = canReadPages ? await readPageContexts(tabs) : new Map();
    proposedTitleGroups = makeTitleGroups(tabs, pageSummaries);

    if (lastUngroupedTabs.length > 0) {
      const note = document.createElement("p");
      note.textContent = `Einzeltabs bleiben ungegruppiert: ${lastUngroupedTabs.map((tab) => tab.title).join(" · ")}`;
      ungroupedTabsContainer.append(note);
    }

    const groupedCount = proposedTitleGroups.reduce((sum, group) => sum + group.tabIds.length, 0);
    const pinnedCount = tabs.filter((tab) => tab.pinned).length;
    const contextNote = canReadPages
      ? `${pageSummaries.size} kurze Seitenproben lokal analysiert`
      : "nur Seitentitel verwendet (Seitenzugriff nicht erteilt)";
    const noGroupNote = proposedTitleGroups.length === 0 ? "Keine mehrteiligen Gruppen erkannt. " : "";
    groupingStatus.textContent = `${noGroupNote}${proposedTitleGroups.length} Gruppen für ${groupedCount} Tabs · ${lastGroupingBoundaryCount} Grenze${lastGroupingBoundaryCount === 1 ? "" : "n"} · ${contextNote}${pinnedCount ? ` · ${pinnedCount} angeheftete Tabs bleiben außerhalb` : ""}`;
    proposedTitleGroups.forEach((group, index) => {
      const card = document.createElement("article");
      card.className = "suggested-group";
      const label = document.createElement("label");
      label.htmlFor = `group-name-${index}`;
      label.textContent = group.tabIds.length === 1
        ? "Einzeltab"
        : `Gruppenname · ${group.tabIds.length} Tabs${group.includedBetween ? ` · ${group.includedBetween} dazwischenliegend` : ""}`;
      const input = document.createElement("input");
      input.id = `group-name-${index}`;
      input.className = "group-name-input";
      input.maxLength = 60;
      input.value = group.name.slice(0, 60);
      input.dataset.groupIndex = String(index);
      const titles = document.createElement("p");
      titles.className = "suggested-tabs";
      titles.textContent = group.titles.join(" · ");
      if (group.topics.length > 0) {
        const relation = document.createElement("p");
        relation.className = "group-relation";
        relation.textContent = `Themenbezug: ${group.topics.join(" · ")}`;
        card.append(label, input, relation, titles);
      } else {
        card.append(label, input, titles);
      }
      titleGroupsContainer.append(card);
    });
    applyGroupsButton.disabled = proposedTitleGroups.length === 0;
  } catch (error) {
    proposedTitleGroups = [];
    groupingStatus.textContent = "Gruppierungsvorschläge konnten nicht erstellt werden.";
    console.error("Title-based grouping failed:", error);
  } finally {
    analyzeTitlesButton.disabled = false;
  }
}

async function applyTitleGroups() {
  if (proposedTitleGroups.length === 0) return;
  applyGroupsButton.disabled = true;
  analyzeTitlesButton.disabled = true;
  groupingStatus.textContent = "Tab-Gruppen werden erstellt …";
  const colors = ["blue", "green", "purple", "orange", "cyan", "pink", "yellow", "red"];
  let applied = 0;
  try {
    const currentWindowTabs = await chrome.tabs.query({ currentWindow: true });
    const currentIds = new Set(currentWindowTabs.filter((tab) => !tab.pinned).map((tab) => tab.id));
    const groups = proposedTitleGroups.map((group, index) => ({
      ...group,
      name: titleGroupsContainer.querySelector(`[data-group-index="${index}"]`)?.value.trim() || group.name,
      tabIds: group.tabIds.filter((id) => currentIds.has(id))
    })).filter((group) => group.tabIds.length > 1);
    const idsToRegroup = currentWindowTabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
    if (idsToRegroup.length > 0) await chrome.tabs.ungroup(idsToRegroup);
    for (const [index, group] of groups.entries()) {
      const groupId = await chrome.tabs.group({ tabIds: group.tabIds });
      await chrome.tabGroups.update(groupId, { title: group.name.slice(0, 60), color: colors[index % colors.length] });
      applied += group.tabIds.length;
    }
    groupingStatus.textContent = `${groups.length} Gruppen erstellt · ${applied} Tabs gruppiert. Nicht zugeordnete Tabs bleiben außerhalb.`;
    proposedTitleGroups = [];
    titleGroupsContainer.replaceChildren();
  } catch (error) {
    groupingStatus.textContent = `Gruppierung teilweise angewendet (${applied} Tabs). Bitte Vorschläge erneut erstellen.`;
    console.error("Applying title groups failed:", error);
  } finally {
    applyGroupsButton.disabled = true;
    analyzeTitlesButton.disabled = false;
  }
}

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
    currentWindowSnapshot = await chrome.tabs.query({ currentWindow: true });
    analyzeTitlesButton.disabled = false;
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
    analyzeTitlesButton.disabled = false;
    console.error("Tab scan failed:", error);
  }
}

rescanButton.addEventListener("click", scanTabs);
analyzeTitlesButton.addEventListener("click", beginTitleAnalysis);
applyGroupsButton.addEventListener("click", applyTitleGroups);
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
