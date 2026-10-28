import { embedTexts } from "./semantic.js";

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
let lastGroupingDiagnostics = { tabCount: 0, embeddedCount: 0, strongestAdjacent: 0 };
analyzeTitlesButton.disabled = true;

const OPENED_AT_KEY = "tabOpenedAtById";
const OPEN_TIME_HALF_LIFE_MS = 8 * 60 * 1000;
const OPEN_TIME_MATCH_THRESHOLD = 0.6;

async function getTabOpenTimes(tabs, canReadHistory) {
  let recorded = {};
  try {
    recorded = (await chrome.storage.session.get(OPENED_AT_KEY))[OPENED_AT_KEY] || {};
  } catch (error) {
    console.warn("Tab opening times are unavailable:", error);
  }
  const historyTimes = new Map();
  if (canReadHistory) {
    const urls = [...new Set(tabs.filter((tab) => !tab.pinned && tab.url && typeof tab.id === "number")
      .flatMap((tab) => {
        try {
          const url = new URL(tab.url);
          return url.protocol === "http:" || url.protocol === "https:" ? [tab.url] : [];
        } catch {
          return [];
        }
      }))];
    for (let start = 0; start < urls.length; start += 10) {
      const batch = urls.slice(start, start + 10);
      const visits = await Promise.all(batch.map(async (url) => {
        try {
          const entries = await chrome.history.getVisits({ url });
          const latest = entries.reduce((time, visit) => Math.max(time, visit.visitTime || 0), 0);
          return [url, latest || null];
        } catch {
          return [url, null];
        }
      }));
      for (const [url, time] of visits) if (time) historyTimes.set(url, time);
    }
  }
  return new Map(tabs.filter((tab) => typeof tab.id === "number").map((tab) => {
    const known = recorded[tab.id];
    if (known && Number.isFinite(known.at)) return [tab.id, known];
    const historyTime = historyTimes.get(tab.url);
    if (historyTime) return [tab.id, { at: historyTime, confidence: 0.8 }];
    return [tab.id, Number.isFinite(tab.lastAccessed)
      ? { at: tab.lastAccessed, confidence: 0.3 }
      : null];
  }));
}

function cosineSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return 0;
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index];
  return dot;
}

function titleTokens(title) {
  const expanded = (title || "").normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLocaleLowerCase();
  const tokens = expanded.match(/[\p{L}\p{N}]{4,}/gu) || [];
  const normalized = new Set();
  for (const token of tokens) {
    let stem = token;
    for (const suffix of ["ing", "ers", "er", "ed", "es", "s"]) {
      if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
        stem = token.slice(0, -suffix.length);
        break;
      }
    }
    normalized.add(stem);
  }
  return normalized;
}

function titlesShareDistinctTerms(leftTitle, rightTitle, termFrequency, corpusSize, timeAffinity = 0) {
  const leftTokens = titleTokens(leftTitle);
  const rightTokens = titleTokens(rightTitle);
  if (leftTokens.size < 2 || rightTokens.size < 2) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token));
  const overlap = shared.length / Math.min(leftTokens.size, rightTokens.size);
  if (shared.length < 2 || overlap < 0.25) return false;
  const rareLimit = Math.max(2, Math.ceil(corpusSize * 0.2));
  const rareSharedCount = shared.filter((token) => (termFrequency.get(token) || 0) <= rareLimit).length;
  return rareSharedCount >= 2 || (rareSharedCount >= 1 && timeAffinity >= OPEN_TIME_MATCH_THRESHOLD);
}

function temporalSimilarity(leftId, rightId, openTimes) {
  const left = openTimes.get(leftId);
  const right = openTimes.get(rightId);
  if (!left || !right) return 0;
  const elapsed = Math.abs(left.at - right.at);
  const confidence = Math.sqrt((left.confidence || 0) * (right.confidence || 0));
  return Math.exp(-elapsed / OPEN_TIME_HALF_LIFE_MS) * confidence;
}

function groupsShareDistinctTitleTerms(leftGroup, rightGroup, termFrequency, corpusSize, openTimes) {
  for (let leftIndex = 0; leftIndex < leftGroup.titles.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < rightGroup.titles.length; rightIndex += 1) {
      const timeAffinity = temporalSimilarity(leftGroup.tabIds[leftIndex], rightGroup.tabIds[rightIndex], openTimes);
      if (titlesShareDistinctTerms(
        leftGroup.titles[leftIndex], rightGroup.titles[rightIndex], termFrequency, corpusSize, timeAffinity
      )) return true;
    }
  }
  return false;
}

function centerEmbeddingVectors(embeddings) {
  if (embeddings.size < 4) return { vectors: embeddings, centered: false };
  const entries = [...embeddings.entries()];
  const dimensions = entries[0][1].length;
  const mean = Array(dimensions).fill(0);
  for (const [, vector] of entries) {
    vector.forEach((value, dimension) => { mean[dimension] += value / entries.length; });
  }
  const centered = new Map(entries.map(([id, vector]) => {
    const adjusted = vector.map((value, dimension) => value - mean[dimension]);
    const norm = Math.sqrt(adjusted.reduce((sum, value) => sum + value * value, 0));
    return [id, norm > 1e-8 ? adjusted.map((value) => value / norm) : vector];
  }));
  return { vectors: centered, centered: true };
}

function makeTitleGroups(tabs, embeddings, centeredScores, openTimes) {
  const orderedTabs = tabs.filter((tab) => !tab.pinned).sort((left, right) => left.index - right.index);
  const titledTabs = orderedTabs.filter((tab) => tab.title);
  const corpusSize = titledTabs.length;
  const termFrequency = new Map();
  for (const tab of titledTabs) {
    for (const token of titleTokens(tab.title)) termFrequency.set(token, (termFrequency.get(token) || 0) + 1);
  }
  const boundaryAfter = [];
  const anchorsByBoundary = [];
  const DIRECT_MATCH_THRESHOLD = centeredScores ? 0.60 : 0.74;
  const REMOTE_AFFINITY_THRESHOLD = centeredScores ? 0.70 : 0.84;
  const REMOTE_OVERRIDE_FLOOR = centeredScores ? 0.34 : 0.42;
  const REMOTE_WIN_MARGIN = centeredScores ? 0.08 : 0.09;
  let strongestAdjacent = 0;
  let weakestAdjacent = 1;
  let localMatchCount = 0;
  let remoteOverrideCount = 0;
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
    const first = embeddings.get(orderedTabs[left].id);
    if (!first) continue;
    for (let right = left + 2; right < orderedTabs.length; right += 1) {
      const second = embeddings.get(orderedTabs[right].id);
      if (!second) continue;
      const leftTab = orderedTabs[left];
      const rightTab = orderedTabs[right];
      const baseAffinity = cosineSimilarity(first, second);
      const timeAffinity = temporalSimilarity(leftTab.id, rightTab.id, openTimes);
      const hasSharedTerms = titlesShareDistinctTerms(
        leftTab.title, rightTab.title, termFrequency, corpusSize, timeAffinity
      );
      const affinity = baseAffinity + 0.12 * timeAffinity;
      if (affinity < REMOTE_AFFINITY_THRESHOLD
        && !(baseAffinity >= REMOTE_AFFINITY_THRESHOLD - 0.05 && timeAffinity >= OPEN_TIME_MATCH_THRESHOLD)
        && !hasSharedTerms) continue;
      const weightedAffinity = hasSharedTerms ? Math.max(affinity, 0.82) : affinity;
      const influence = weightedAffinity / Math.sqrt(right - left);
      if (influence > 0) {
        updateRemoteRange(left, right - 1, { influence, affinity: weightedAffinity, tabIds: [leftTab.id, rightTab.id] });
      }
    }
  }

  for (let boundary = 0; boundary < orderedTabs.length - 1; boundary += 1) {
    const leftTab = orderedTabs[boundary];
    const rightTab = orderedTabs[boundary + 1];
    const leftVector = embeddings.get(leftTab.id);
    const rightVector = embeddings.get(rightTab.id);
    const localTimeAffinity = temporalSimilarity(leftTab.id, rightTab.id, openTimes);
    const hasSharedTerms = titlesShareDistinctTerms(
      leftTab.title, rightTab.title, termFrequency, corpusSize, localTimeAffinity
    );
    const baseLocalAffinity = leftVector && rightVector ? cosineSimilarity(leftVector, rightVector) : 0;
    const localInfluence = baseLocalAffinity + 0.12 * localTimeAffinity;
    strongestAdjacent = Math.max(strongestAdjacent, localInfluence);
    weakestAdjacent = Math.min(weakestAdjacent, localInfluence);
    const strongestRemote = remoteInfluenceAt(boundary);

    const remoteOverrides = strongestRemote.influence > Math.max(localInfluence + REMOTE_WIN_MARGIN, REMOTE_OVERRIDE_FLOOR);
    const hasLocalMatch = baseLocalAffinity >= DIRECT_MATCH_THRESHOLD
      || (baseLocalAffinity >= DIRECT_MATCH_THRESHOLD - 0.05 && localTimeAffinity >= OPEN_TIME_MATCH_THRESHOLD)
      || hasSharedTerms;
    if (hasLocalMatch) localMatchCount += 1;
    else if (remoteOverrides) remoteOverrideCount += 1;
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
    const anchorIdsInRange = [...anchorIds].filter((id) => tabIds.has(id));
    const anchorVectors = anchorIdsInRange.map((id) => embeddings.get(id)).filter(Boolean);
    const nameBasis = anchorVectors.length ? anchorIdsInRange : rangeTabs.map((tab) => tab.id).filter((id) => embeddings.has(id));
    const nameVectors = nameBasis.map((id) => embeddings.get(id));
    let representativeId = nameBasis[0];
    if (nameVectors.length > 1) {
      const center = Array(nameVectors[0].length).fill(0);
      for (const vector of nameVectors) vector.forEach((value, index) => { center[index] += value; });
      const centerNorm = Math.sqrt(center.reduce((sum, value) => sum + value * value, 0)) || 1;
      const normalizedCenter = center.map((value) => value / centerNorm);
      representativeId = nameBasis.reduce((bestId, candidateId) =>
        cosineSimilarity(embeddings.get(candidateId), normalizedCenter) > cosineSimilarity(embeddings.get(bestId), normalizedCenter)
          ? candidateId : bestId, nameBasis[0]);
    }
    const representative = rangeTabs.find((tab) => tab.id === representativeId) || rangeTabs[0];
    return {
      name: representative?.title || "Ähnliche Seiten",
      anchorTitles: anchorIdsInRange.map((id) => rangeTabs.find((tab) => tab.id === id)?.title).filter(Boolean),
      tabIds: rangeTabs.map((tab) => tab.id),
      titles: rangeTabs.map((tab) => tab.title || "Unbenannter Tab"),
      includedBetween: rangeTabs.length > 1 ? Math.max(0, rangeTabs.length - anchorIds.size) : 0,
      boundaryStart: first > 0,
      boundaryEnd: last < orderedTabs.length - 1,
      startPosition: first,
      endPosition: last
    };
  });

  const mergedSegments = [];
  const mergeThreshold = centeredScores ? 0.80 : 0.91;
  const groupCenter = (group) => {
    const vectors = group.tabIds.map((id) => embeddings.get(id)).filter(Boolean);
    if (vectors.length === 0) return null;
    const center = Array(vectors[0].length).fill(0);
    for (const vector of vectors) vector.forEach((value, dimension) => { center[dimension] += value / vectors.length; });
    const norm = Math.sqrt(center.reduce((sum, value) => sum + value * value, 0));
    return norm > 1e-8 ? center.map((value) => value / norm) : null;
  };
  const groupSimilarity = (left, right) => {
    const leftCenter = groupCenter(left);
    const rightCenter = groupCenter(right);
    let temporalTotal = 0;
    let pairCount = 0;
    for (const leftId of left.tabIds) {
      for (const rightId of right.tabIds) {
        temporalTotal += temporalSimilarity(leftId, rightId, openTimes);
        pairCount += 1;
      }
    }
    return cosineSimilarity(leftCenter, rightCenter) + 0.08 * (pairCount ? temporalTotal / pairCount : 0);
  };
  for (const group of allSegments) {
    const previous = mergedSegments.at(-1);
    const canMerge = previous
      && previous.tabIds.length > 1
      && group.tabIds.length > 1
      && previous.endPosition + 1 === group.startPosition;
    if (canMerge) {
      const semanticMatch = groupSimilarity(previous, group) >= mergeThreshold;
      const sharedTitleTerms = groupsShareDistinctTitleTerms(previous, group, termFrequency, corpusSize, openTimes);
      if (semanticMatch || sharedTitleTerms) {
        const combinedIds = [...previous.tabIds, ...group.tabIds];
        const combined = { ...previous, tabIds: combinedIds, titles: [...previous.titles, ...group.titles] };
        const combinedCenter = groupCenter(combined);
        const representativeId = combinedIds.reduce((bestId, candidateId) =>
          cosineSimilarity(embeddings.get(candidateId), combinedCenter) > cosineSimilarity(embeddings.get(bestId), combinedCenter)
            ? candidateId : bestId, combinedIds[0]);
        combined.name = orderedTabs.find((tab) => tab.id === representativeId)?.title || previous.name;
        combined.anchorTitles = [...new Set([...previous.anchorTitles, ...group.anchorTitles])];
        combined.includedBetween = previous.includedBetween + group.includedBetween;
        combined.boundaryEnd = group.boundaryEnd;
        combined.endPosition = group.endPosition;
        mergedSegments[mergedSegments.length - 1] = combined;
        continue;
      }
    }
    mergedSegments.push({ ...group });
  }

  lastUngroupedTabs = mergedSegments.filter((group) => group.tabIds.length === 1)
    .map((group) => ({ title: group.titles[0], index: orderedTabs.find((tab) => tab.id === group.tabIds[0])?.index ?? 0 }));
  lastGroupingDiagnostics = {
    tabCount: orderedTabs.length,
    embeddedCount: orderedTabs.filter((tab) => embeddings.has(tab.id)).length,
    strongestAdjacent,
    weakestAdjacent: orderedTabs.length > 1 ? weakestAdjacent : 0,
    localMatchCount,
    remoteOverrideCount,
    directThreshold: DIRECT_MATCH_THRESHOLD,
    centeredScores
  };
  return mergedSegments.filter((group) => group.tabIds.length > 1);
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

  // Ask only after the user's click. History data is queried only for URLs
  // already open in this window; page access stays optional as before.
  groupingStatus.textContent = "Bitte bestätige optional den Verlaufs- und Website-Zugriff für diese Analyse …";
  analyzeTitlesButton.disabled = true;
  const permissions = origins.length > 0 ? ["history", "scripting"] : ["history"];
  const permissionRequest = new Promise((resolve, reject) => {
    chrome.permissions.request({ permissions, ...(origins.length ? { origins } : {}) }, (granted) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(granted);
    });
  });
  permissionRequest.then(async () => {
    const [canReadHistory, canReadPages] = await Promise.all([
      chrome.permissions.contains({ permissions: ["history"] }),
      origins.length ? chrome.permissions.contains({ permissions: ["scripting"], origins }) : false
    ]);
    await createTitleGroupSuggestions(tabs, canReadPages, canReadHistory);
  }).catch((error) => {
    console.error("Optional analysis permissions request failed:", error);
    void createTitleGroupSuggestions(tabs, false, false);
  });
}

async function createTitleGroupSuggestions(tabs, canReadPages, canReadHistory = false) {
  groupingStatus.textContent = canReadPages
    ? "Kurze Seitenkontexte werden gelesen; das lokale mehrsprachige Modell wird vorbereitet …"
    : "Das lokale mehrsprachige Modell wird mit den Seitentiteln vorbereitet …";
  titleGroupsContainer.replaceChildren();
  ungroupedTabsContainer.replaceChildren();
  applyGroupsButton.disabled = true;
  analyzeTitlesButton.disabled = true;
  try {
    const pageSummaries = canReadPages ? await readPageContexts(tabs) : new Map();
    const openTimes = await getTabOpenTimes(tabs, canReadHistory);
    const analyzableTabs = tabs.filter((tab) => !tab.pinned && tab.title && typeof tab.id === "number");
    const updateModelProgress = (event) => {
      if (event.status === "progress" && Number.isFinite(event.progress)) {
        groupingStatus.textContent = `Lade lokales Modell: ${Math.round(event.progress)}% …`;
      } else if (event.status === "embedding") {
        groupingStatus.textContent = `Vergleiche semantisch passende Seiten: ${event.completed}/${event.total} …`;
      }
    };
    if (analyzableTabs.length === 0) {
      proposedTitleGroups = [];
      lastUngroupedTabs = [];
      lastGroupingBoundaryCount = 0;
      lastGroupingDiagnostics = { tabCount: 0, embeddedCount: 0, strongestAdjacent: 0 };
    }
    const titleVectors = analyzableTabs.length
      ? await embedTexts(analyzableTabs.map((tab) => tab.title), updateModelProgress)
      : [];
    const contextTabs = analyzableTabs.filter((tab) => pageSummaries.has(tab.id));
    const contextVectors = contextTabs.length
      ? await embedTexts(contextTabs.map((tab) => pageSummaries.get(tab.id)), updateModelProgress)
      : [];
    const contextByTab = new Map(contextTabs.map((tab, index) => [tab.id, contextVectors[index]]));
    const rawEmbeddings = new Map(analyzableTabs.map((tab, index) => {
      const titleVector = titleVectors[index];
      const contextVector = contextByTab.get(tab.id);
      if (!contextVector) return [tab.id, titleVector];
      const combined = titleVector.map((value, dimension) => value * 0.95 + contextVector[dimension] * 0.05);
      const norm = Math.sqrt(combined.reduce((sum, value) => sum + value * value, 0)) || 1;
      return [tab.id, combined.map((value) => value / norm)];
    }));
    const { vectors: embeddings, centered: centeredScores } = centerEmbeddingVectors(rawEmbeddings);
    proposedTitleGroups = makeTitleGroups(tabs, embeddings, centeredScores, openTimes);

    if (lastUngroupedTabs.length > 0) {
      const note = document.createElement("p");
      note.textContent = `Einzeltabs bleiben ungegruppiert: ${lastUngroupedTabs.map((tab) => tab.title).join(" · ")}`;
      ungroupedTabsContainer.append(note);
    }

    const groupedCount = proposedTitleGroups.reduce((sum, group) => sum + group.tabIds.length, 0);
    const pinnedCount = tabs.filter((tab) => tab.pinned).length;
    const contextNote = canReadPages
      ? `${pageSummaries.size} kurze Seitenproben plus Seitentitel lokal analysiert`
      : "nur Seitentitel verwendet (Seitenzugriff nicht erteilt)";
    const observedOpenTimes = analyzableTabs.filter((tab) => openTimes.get(tab.id)?.confidence >= 1).length;
    const historyOpenTimes = analyzableTabs.filter((tab) => openTimes.get(tab.id)?.confidence === 0.8).length;
    const approximateOpenTimes = analyzableTabs.length - observedOpenTimes - historyOpenTimes;
    const timeNote = `${observedOpenTimes} Öffnungszeitpunkte erfasst · ${historyOpenTimes} Verlauf · ${approximateOpenTimes} Näherungen`;
    const noGroupNote = proposedTitleGroups.length === 0
      ? `Keine mehrteiligen Gruppen erkannt (${lastGroupingDiagnostics.embeddedCount}/${lastGroupingDiagnostics.tabCount} Tabs eingebettet; stärkste Nachbarähnlichkeit ${Math.round(lastGroupingDiagnostics.strongestAdjacent * 100)}%, Schwelle ${Math.round((lastGroupingDiagnostics.directThreshold || 0.6) * 100)}%). `
      : "";
    const singleGroupDiagnostic = proposedTitleGroups.length === 1
      ? ` · Übergänge: ${lastGroupingDiagnostics.localMatchCount} direkte, ${lastGroupingDiagnostics.remoteOverrideCount} entfernte; Nachbarwerte ${Math.round(lastGroupingDiagnostics.weakestAdjacent * 100)}–${Math.round(lastGroupingDiagnostics.strongestAdjacent * 100)}%`
      : "";
    const singleNote = lastUngroupedTabs.length ? ` · ${lastUngroupedTabs.length} Einzeltabs ungegruppiert` : "";
    groupingStatus.textContent = `${noGroupNote}${proposedTitleGroups.length} Gruppen für ${groupedCount} Tabs · ${lastGroupingBoundaryCount} Grenze${lastGroupingBoundaryCount === 1 ? "" : "n"}${singleNote}${singleGroupDiagnostic} · ${contextNote} · ${timeNote}${pinnedCount ? ` · ${pinnedCount} angeheftete Tabs bleiben außerhalb` : ""}`;
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
      if (group.anchorTitles.length > 1) {
        const relation = document.createElement("p");
        relation.className = "group-relation";
        relation.textContent = `Semantische Anker: ${group.anchorTitles.slice(0, 2).join(" ↔ ")}`;
        card.append(label, input, relation, titles);
      } else {
        card.append(label, input, titles);
      }
      titleGroupsContainer.append(card);
    });
    applyGroupsButton.disabled = proposedTitleGroups.length === 0;
  } catch (error) {
    proposedTitleGroups = [];
    const reason = error instanceof Error ? error.message : String(error);
    groupingStatus.textContent = `Analyse fehlgeschlagen: ${reason.slice(0, 220)}`;
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
    groupingStatus.textContent = `${groups.length} Gruppen erstellt · ${applied} Tabs gruppiert. Einzeltabs bleiben ungegruppiert.`;
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
  analyzeTitlesButton.disabled = true;
  applyGroupsButton.disabled = true;
  proposedTitleGroups = [];
  titleGroupsContainer.replaceChildren();
  ungroupedTabsContainer.replaceChildren();
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
