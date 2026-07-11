# Mu Header

A small Chrome extension (Manifest V3) that adds custom HTTP headers to **all**
outgoing requests, similar to ModHeader. Built with plain JS + HTML/CSS — no build
step, no dependencies.

## Features

- Add custom request headers (name + value).
- Per-header **on/off toggle**.
- Mark a value as **sensitive** — it renders masked (`••••••••`) and can be revealed
  temporarily by clicking the 👁 button.
- **Remove** a header (🗑).
- **Badge** on the toolbar icon showing how many headers are currently enabled.
- Dark-themed popup.

Headers apply globally: every site, every tab, and every request type (page loads,
XHR/fetch, scripts, images, etc.).

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this folder (the one containing `manifest.json`).

The Mu Header icon appears in the toolbar. Click it to open the popup.

Whenever you edit the source files, return to `chrome://extensions` and click the
**Reload** (↻) button on the Mu Header card.

## Usage

1. Click the toolbar icon.
2. Enter a header **name** (e.g. `Authorization`) and **value** (e.g. `Bearer abc123`).
3. Optionally tick **Sensitive** to keep the value masked in the UI.
4. Click **Add header**. It is enabled by default — the badge count updates.
5. Use the toggle to enable/disable, 👁 to reveal a sensitive value, 🗑 to remove.

To confirm a header is being sent: open any site → DevTools → **Network** → click a
request → **Headers** → **Request Headers**.

## Customizing the icon

The icon ships as PNG files in the `icons/` folder at three sizes:

- `icons/icon16.png`
- `icons/icon48.png`
- `icons/icon128.png`

To use your own icon, either:

- **Replace the files** — overwrite the three PNGs with your own, keeping the same
  filenames and pixel dimensions (16×16, 48×48, 128×128), **or**
- **Change the paths** — edit the `"icons"` and `"action.default_icon"` sections in
  `manifest.json` to point at your files.

Then reload the extension on `chrome://extensions` for the new icon to appear.

## How it works

- `popup.js` reads/writes the header list to `chrome.storage.local` — that's the only
  thing the popup touches.
- `background.js` (the service worker) listens for storage changes and rebuilds the
  request-header rules using the **`declarativeNetRequest`** API (the MV3-supported way
  to modify headers), and updates the toolbar badge. This keeps a single source of truth.

## Security note

The **Sensitive** flag only masks the value in the popup UI. Values are stored in plain
text in `chrome.storage.local` (this is the same behavior as similar tools). Don't treat
it as encryption. Note also that Chrome disallows modifying a few protected headers; those
are silently ignored by the browser.

## Files

| File            | Purpose                                             |
| --------------- | --------------------------------------------------- |
| `manifest.json` | Extension manifest (MV3), permissions, icon paths.  |
| `background.js` | Service worker: builds DNR rules + badge.           |
| `popup.html`    | Popup markup.                                        |
| `popup.css`     | Dark theme styling.                                 |
| `popup.js`      | Popup logic (storage read/write, rendering).        |
| `icons/`        | Toolbar/store icons (customizable).                 |
