// Service worker: single source of truth for DNR rules and the toolbar badge.
// The popup only writes the header list to storage; this worker reacts to
// storage changes and rebuilds the declarativeNetRequest rules + badge.

const STORAGE_KEY = "headers";
const DOMAIN_KEY = "domain";

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

async function getDomain() {
  const data = await chrome.storage.local.get(DOMAIN_KEY);
  return typeof data[DOMAIN_KEY] === "string" ? data[DOMAIN_KEY].trim() : "";
}

// Escape a hostname for safe inclusion in a RE2 regexFilter (dots are the
// only regex-special character valid in a hostname).
function escapeHost(host) {
  return host.replace(/\./g, "\\.");
}

// Build the DNR condition for the global domain filter.
//   ""                 -> all sites
//   "example.com"      -> exactly example.com (NOT its subdomains), any port
//   "*.example.com"    -> subdomains of example.com only (NOT the bare host)
//   "localhost:8000"   -> localhost on port 8000 only
//   "127.0.0.1:8001"   -> that IP on port 8001 only
// Subdomain vs. exact control isn't expressible with urlFilter/requestDomains
// (both always include subdomains), so we anchor the host with a regexFilter.
function buildCondition(domain) {
  if (domain === "") {
    return { urlFilter: "*", resourceTypes: RESOURCE_TYPES };
  }

  // Split off an optional :port suffix (the last colon).
  const colon = domain.lastIndexOf(":");
  const host = colon === -1 ? domain : domain.slice(0, colon);
  const port = colon === -1 ? "" : domain.slice(colon + 1);

  const hostPart = host.startsWith("*.")
    ? `([^/]+\\.)${escapeHost(host.slice(2))}`
    : escapeHost(host);

  // A specific port matches only that port; no port matches any (or none).
  const portPart = port === "" ? "(:\\d+)?" : `:${port}`;

  // http/https, the host, the port rule, then a "/" or end of URL.
  const regexFilter = `^https?://${hostPart}${portPart}(/|$)`;
  return { regexFilter, resourceTypes: RESOURCE_TYPES };
}

// Build a DNR rule for one enabled header. The header's stable `id` doubles
// as the DNR rule id. `condition` is shared across all rules in a rebuild.
function toRule(header, condition) {
  return {
    id: header.id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: header.name, operation: "set", value: header.value }
      ]
    },
    condition
  };
}

// Replace the whole dynamic rule set atomically with the current enabled headers.
async function rebuildRules() {
  const headers = await getHeaders();
  const domain = await getDomain();
  const enabled = headers.filter(
    (h) => h.enabled && h.name && h.name.trim() !== ""
  );

  const condition = buildCondition(domain);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  const addRules = enabled.map((h) => toRule(h, condition));

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
  if (area === "local" && (changes[STORAGE_KEY] || changes[DOMAIN_KEY])) {
    sync();
  }
});
