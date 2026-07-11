// Popup UI. It only reads/writes the header list in chrome.storage.local.
// background.js reacts to storage changes to rebuild DNR rules and the badge.

const STORAGE_KEY = "headers";
const NEXT_ID_KEY = "nextId";
const DOMAIN_KEY = "domain";
const MASK = "••••••••";

// Valid HTTP header field name per RFC 7230 (token characters).
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Host part of a domain filter. Accepts a single label (e.g. "localhost"),
// a dotted host (e.g. "example.com"), or an IPv4 address (e.g. "127.0.0.1").
// Each label may contain letters, digits and hyphens, but not lead/trail a hyphen.
const HOST_RE = /^(?!-)[A-Za-z0-9-]+(?<!-)(\.(?!-)[A-Za-z0-9-]+(?<!-))*$/;

// Split a domain filter into its host and optional port. Returns
// { host, port } where port is "" when none was given.
function splitDomain(value) {
  const colon = value.lastIndexOf(":");
  if (colon === -1) return { host: value, port: "" };
  return { host: value.slice(0, colon), port: value.slice(colon + 1) };
}

// Validate the domain input. Returns an error message string, or "" if valid.
// Accepts: blank, host, host:port, *.host, *.host:port. Host may be a single
// label (localhost), a dotted name (example.com), or an IPv4 address.
function validateDomain(raw) {
  const value = raw.trim();
  if (value === "") return "";

  const { host, port } = splitDomain(value);
  const bareHost = host.startsWith("*.") ? host.slice(2) : host;

  if (!HOST_RE.test(bareHost)) {
    return "Enter a domain like example.com, *.example.com or localhost:8000.";
  }
  if (port !== "" && !/^\d{1,5}$/.test(port)) {
    return "Port must be a number, e.g. localhost:8000.";
  }
  if (port !== "" && Number(port) > 65535) {
    return "Port must be between 1 and 65535.";
  }
  return "";
}

const listEl = document.getElementById("header-list");
const emptyEl = document.getElementById("empty-state");
const formEl = document.getElementById("add-form");
const nameInput = document.getElementById("name-input");
const valueInput = document.getElementById("value-input");
const sensitiveInput = document.getElementById("sensitive-input");
const errorEl = document.getElementById("form-error");
const domainInput = document.getElementById("domain-input");
const domainErrorEl = document.getElementById("domain-error");
const domainToggle = document.getElementById("domain-toggle");
const domainBody = document.getElementById("domain-body");
const domainDot = document.getElementById("domain-dot");

// Tracks which sensitive rows are currently revealed (in-memory, resets on close).
const revealed = new Set();

async function loadHeaders() {
  const data = await chrome.storage.local.get([STORAGE_KEY, NEXT_ID_KEY]);
  return {
    headers: Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [],
    nextId: typeof data[NEXT_ID_KEY] === "number" ? data[NEXT_ID_KEY] : 1
  };
}

async function loadDomain() {
  const data = await chrome.storage.local.get(DOMAIN_KEY);
  return typeof data[DOMAIN_KEY] === "string" ? data[DOMAIN_KEY] : "";
}

async function saveDomain(domain) {
  await chrome.storage.local.set({ [DOMAIN_KEY]: domain });
}

// Show the red marker only when a restriction is active (non-blank domain).
function updateDomainDot(domain) {
  const active = domain.trim() !== "";
  domainDot.hidden = !active;
  domainToggle.title = active
    ? `Restricted to ${domain.trim()}`
    : "Not restricted (sent to all sites)";
}

// Expand/collapse the domain setting body.
function setDomainExpanded(expanded) {
  domainToggle.setAttribute("aria-expanded", String(expanded));
  domainBody.hidden = !expanded;
}

async function saveHeaders(headers, nextId) {
  const patch = { [STORAGE_KEY]: headers };
  if (typeof nextId === "number") patch[NEXT_ID_KEY] = nextId;
  await chrome.storage.local.set(patch);
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function render(headers) {
  listEl.textContent = "";

  if (headers.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  for (const header of headers) {
    listEl.appendChild(renderRow(header, headers));
  }
}

// Replace the value display with an inline text input. Enter or blur commits
// the new value; Escape cancels. On commit we persist and re-render so the
// service worker rebuilds its rules from the updated storage.
function startEditingValue(valueEl, header, headers) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "header-value-edit";
  input.value = header.value || "";

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const next = input.value;
    if (next !== header.value) {
      header.value = next;
      await saveHeaders(headers);
    }
    render(headers);
  };
  const cancel = () => {
    if (done) return;
    done = true;
    render(headers);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", commit);

  valueEl.replaceWith(input);
  input.focus();
  input.select();
}

function renderRow(header, headers) {
  const li = document.createElement("li");
  li.className = "header-item" + (header.enabled ? "" : " disabled");

  // Enable / disable toggle
  const toggle = document.createElement("label");
  toggle.className = "toggle";
  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.checked = !!header.enabled;
  toggleInput.title = header.enabled ? "Enabled" : "Disabled";
  const slider = document.createElement("span");
  slider.className = "slider";
  toggle.append(toggleInput, slider);
  toggleInput.addEventListener("change", async () => {
    header.enabled = toggleInput.checked;
    await saveHeaders(headers);
    render(headers);
  });

  // Name + value text
  const textWrap = document.createElement("div");
  textWrap.className = "header-text";
  const nameEl = document.createElement("div");
  nameEl.className = "header-name";
  nameEl.textContent = header.name;
  const valueEl = document.createElement("div");
  valueEl.className = "header-value";
  valueEl.dataset.valueFor = String(header.id);
  const isHidden = header.sensitive && !revealed.has(header.id);
  valueEl.textContent = isHidden ? MASK : header.value || "(empty)";
  // Click the value to edit it in place. A masked sensitive value must be
  // revealed first (via 👁 or the pencil) — no point editing the dots.
  if (!isHidden) {
    valueEl.classList.add("editable");
    valueEl.title = "Click to edit";
    valueEl.addEventListener("click", () =>
      startEditingValue(valueEl, header, headers)
    );
  }
  textWrap.append(nameEl, valueEl);

  li.append(toggle, textWrap);

  // Edit button: opens the value for in-place editing. For a masked sensitive
  // value, reveal it first, re-render, then edit the freshly rendered field.
  const editBtn = document.createElement("button");
  editBtn.className = "icon-btn";
  editBtn.type = "button";
  editBtn.textContent = "✏️";
  editBtn.title = "Edit value";
  editBtn.addEventListener("click", () => {
    if (isHidden) {
      revealed.add(header.id);
      render(headers);
    }
    const target = listEl.querySelector(
      `.header-value[data-value-for="${header.id}"]`
    );
    if (target) startEditingValue(target, header, headers);
  });
  li.appendChild(editBtn);

  // Reveal / hide button (only for sensitive headers)
  if (header.sensitive) {
    const eyeBtn = document.createElement("button");
    eyeBtn.className = "icon-btn";
    eyeBtn.type = "button";
    const shown = revealed.has(header.id);
    eyeBtn.textContent = shown ? "🙈" : "👁";
    eyeBtn.title = shown ? "Hide value" : "Reveal value";
    eyeBtn.addEventListener("click", () => {
      if (revealed.has(header.id)) revealed.delete(header.id);
      else revealed.add(header.id);
      render(headers);
    });
    li.appendChild(eyeBtn);
  }

  // Delete button
  const delBtn = document.createElement("button");
  delBtn.className = "icon-btn delete";
  delBtn.type = "button";
  delBtn.textContent = "🗑";
  delBtn.title = "Remove header";
  delBtn.addEventListener("click", async () => {
    const idx = headers.findIndex((h) => h.id === header.id);
    if (idx !== -1) headers.splice(idx, 1);
    revealed.delete(header.id);
    await saveHeaders(headers);
    render(headers);
  });
  li.appendChild(delBtn);

  return li;
}

async function init() {
  const { headers } = await loadHeaders();
  render(headers);

  const currentDomain = await loadDomain();
  domainInput.value = currentDomain;
  updateDomainDot(currentDomain);

  // Start expanded if a restriction is already set, so it's not hidden.
  if (currentDomain !== "") setDomainExpanded(true);

  domainToggle.addEventListener("click", () => {
    setDomainExpanded(domainToggle.getAttribute("aria-expanded") !== "true");
  });

  // Persist the domain as the user types, only when it is valid. Invalid
  // input shows an inline error and is not saved (last valid value stays).
  domainInput.addEventListener("input", async () => {
    const raw = domainInput.value;
    const err = validateDomain(raw);
    if (err) {
      domainErrorEl.textContent = err;
      domainErrorEl.hidden = false;
      return;
    }
    domainErrorEl.hidden = true;
    updateDomainDot(raw.trim());
    await saveDomain(raw.trim());
  });

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const name = nameInput.value.trim();
    const value = valueInput.value;

    if (!name) {
      showError("Header name is required.");
      return;
    }
    if (!HEADER_NAME_RE.test(name)) {
      showError("Invalid header name (no spaces or special characters).");
      return;
    }

    const { headers, nextId } = await loadHeaders();

    if (
      headers.some((h) => h.name.toLowerCase() === name.toLowerCase())
    ) {
      showError("A header with that name already exists.");
      return;
    }

    headers.push({
      id: nextId,
      name,
      value,
      enabled: true,
      sensitive: sensitiveInput.checked
    });

    await saveHeaders(headers, nextId + 1);
    render(headers);

    formEl.reset();
    nameInput.focus();
  });
}

init();
