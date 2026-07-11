// Service worker: single source of truth for DNR rules and the toolbar badge.
// The popup only writes the header list to storage; this worker reacts to
// storage changes and rebuilds the declarativeNetRequest rules + badge.

const STORAGE_KEY = "headers";

// Every request resource type, so headers are added to all request kinds.
const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "other"
];

async function getHeaders() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

// Build a DNR rule for one enabled header. The header's stable `id` doubles
// as the DNR rule id.
function toRule(header) {
  return {
    id: header.id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: header.name, operation: "set", value: header.value }
      ]
    },
    condition: {
      urlFilter: "*",
      resourceTypes: RESOURCE_TYPES
    }
  };
}

// Replace the whole dynamic rule set atomically with the current enabled headers.
async function rebuildRules() {
  const headers = await getHeaders();
  const enabled = headers.filter(
    (h) => h.enabled && h.name && h.name.trim() !== ""
  );

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  const addRules = enabled.map(toRule);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });

  return enabled.length;
}

async function updateBadge(enabledCount) {
  const count =
    typeof enabledCount === "number"
      ? enabledCount
      : (await getHeaders()).filter((h) => h.enabled && h.name).length;

  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#2f81f7" });
}

async function sync() {
  const enabledCount = await rebuildRules();
  await updateBadge(enabledCount);
}

chrome.runtime.onInstalled.addListener(() => {
  sync();
});

chrome.runtime.onStartup.addListener(() => {
  sync();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) {
    sync();
  }
});
