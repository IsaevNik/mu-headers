// Popup UI. It only reads/writes the header list in chrome.storage.local.
// background.js reacts to storage changes to rebuild DNR rules and the badge.

const STORAGE_KEY = "headers";
const NEXT_ID_KEY = "nextId";
const MASK = "••••••••";

// Valid HTTP header field name per RFC 7230 (token characters).
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const listEl = document.getElementById("header-list");
const emptyEl = document.getElementById("empty-state");
const formEl = document.getElementById("add-form");
const nameInput = document.getElementById("name-input");
const valueInput = document.getElementById("value-input");
const sensitiveInput = document.getElementById("sensitive-input");
const errorEl = document.getElementById("form-error");

// Tracks which sensitive rows are currently revealed (in-memory, resets on close).
const revealed = new Set();

async function loadHeaders() {
  const data = await chrome.storage.local.get([STORAGE_KEY, NEXT_ID_KEY]);
  return {
    headers: Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [],
    nextId: typeof data[NEXT_ID_KEY] === "number" ? data[NEXT_ID_KEY] : 1
  };
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
  const isHidden = header.sensitive && !revealed.has(header.id);
  valueEl.textContent = isHidden ? MASK : header.value || "(empty)";
  textWrap.append(nameEl, valueEl);

  li.append(toggle, textWrap);

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
