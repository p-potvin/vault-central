![VaultWares](https://img.shields.io/badge/VaultWares-Privacy--First-blue?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAxTDMgNXY2YzAgNS41NSAzLjg0IDEwLjc0IDkgMTIgNS4xNi0xLjI2IDktNi40NSA5LTEyVjVsLTktNHoiLz48L3N2Zz4=) ![Version](https://img.shields.io/badge/version-3.2.0-green?style=for-the-badge) ![License](https://img.shields.io/badge/license-ISC-lightgrey?style=for-the-badge) ![Chrome](https://img.shields.io/badge/Chrome-Supported-yellow?style=for-the-badge&logo=googlechrome) ![Firefox](https://img.shields.io/badge/Firefox-Supported-orange?style=for-the-badge&logo=firefox)

# 🛡️ Vault Central — by VaultWares

> **Privacy first. Security second. Functionality third.**

Vault Central is a privacy-first browser extension that lets you instantly save videos and links while you browse — no accounts, no cloud, no tracking. One keystroke captures the real video source from under your cursor, validates every field through Zod schemas, and stores everything locally in an AES-256-encrypted IndexedDB vault. A fully themed, paginated dashboard lets you browse, search, filter, and play back your library without ever leaving your browser.

---

## ✨ Features

| Category | Details |
|---|---|
| 🎯 **One-Keystroke Capture** | `Alt+X` saves the closest video or link under the cursor — thumbnail, metadata, and raw stream URL |
| 🔍 **HLS Interception** | Silently opens a minimized background tab, intercepts `.m3u8` / `.mp4` network requests, and resolves the real stream before saving |
| 🖼️ **Rich Metadata** | Extracts title, description, author, duration, views, tags, and thumbnail via LD+JSON and DOM scraping |
| 🎬 **FFmpeg Preview Clips** | Automatically generates a 10-frame WebM preview using FFmpeg WASM and stores it in IndexedDB via Dexie.js |
| 🎨 **12 Built-in Themes** | Solarized Light/Dark plus 10 vault-themes skins; upload your own CSS from the settings panel |
| 🔒 **Optional PIN Lock** | 4- or 6-digit AES-256 PIN encrypts IndexedDB blobs and locks the dashboard after a configurable idle timeout |
| 🔔 **Live Site Indicators** | Injects a subtle heart icon on already-saved thumbnails; toast notifications confirm saves in real time |
| 📊 **Smart Dashboard** | Group by hostname, multi-field filter/sort, five view modes (Biggest → Details), infinite scroll, and per-section pagination |
| 🚫 **Zero External Tracking** | Everything lives in browser-local storage — no telemetry, no sync server, no analytics |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18 LTS — [Download](https://nodejs.org/)
- **Python** ≥ 3.10 (for theme generation) — [Download](https://www.python.org/)
- **A supported browser**: Chrome, Brave, Edge, or Firefox

### 1 — Clone & Install

```bash
git clone https://github.com/p-potvin/vault-central.git
cd vault-central
git submodule update --init   # pulls vault-themes
npm install
```

### 2 — Build

```bash
npm run build
```

The build pipeline runs:
1. `python scripts/generate-themes.py` — compiles vault-themes CSS tokens
2. `tsc && vite build` — transpiles TypeScript and bundles the React UI
3. `esbuild` — bundles `content.ts` and `background.ts` as standalone IIFE scripts
4. `package-extension.cjs` — zips the `dist/` folder into a distributable archive

The `dist/` folder is your unpacked extension.

### 3 — Load in Chrome / Edge / Brave

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` folder
4. The Vault Central icon will appear in your toolbar

### 4 — Load in Firefox

1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select any file inside `dist/` (e.g. `manifest.json`)

> **Note:** Firefox temporary add-ons are removed on restart. For a persistent install, submit through the [Firefox Add-on Developer Hub](https://addons.mozilla.org/en-US/developers/).

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+X` | Capture video / link under mouse cursor |
| `Alt+C` | Open the Vault Central dashboard |

Both shortcuts can be remapped from your browser's extension shortcut settings.

---

## 🖥️ Developer Setup

### Running in Dev Mode

```bash
npm run dev        # Vite dev server for the dashboard UI (hot-reload)
npm run test       # Run the Vitest unit-test suite
npm run test:watch # Vitest in watch mode
```

### Project Layout

```
vault-central/
├── background/scripts/   # Service worker — capture pipeline, HLS interception
├── src/
│   ├── components/       # React components (VaultDashboard, VideoPlayer, …)
│   ├── lib/              # constants, themes, storage-vault, Zod schemas
│   ├── scripts/          # content.ts — injected into every page
│   └── types/            # Global TypeScript interfaces & CSS module declarations
├── scripts/              # generate-themes.py
├── vault-themes/         # Git submodule — shared CSS token library
├── vaultwares-agentciation/ # Agent integration specs
├── dist/                 # Build output (gitignored)
├── manifest.json
└── package.json
```

### Environment Notes

- **TypeScript 5.9+** — `src/types/css.d.ts` declares `module '*.css'` to satisfy the TS2882 side-effect import check required for CSS imports in `dashboard-entry.tsx` and `pin-entry.tsx`.
- **vault-themes submodule** — must be initialised (`git submodule update --init`) before running the build; `generate-themes.py` fails otherwise.
- **FFmpeg WASM** — loaded via `chrome.offscreen` in the background worker; no server-side processing.

---

## 🏗️ Architecture & Agent Integration

```
┌─────────────────────────────────────────────────────┐
│                   Browser Tab (any page)            │
│  content.ts  ──── Alt+X ──→  startCaptureFlow()    │
│     │  findThumbnail → resolveLink → extractMeta   │
│     └──────── chrome.runtime.sendMessage ──────────┐│
└─────────────────────────────────────────────────────┘
                                                      ││
┌──────────────────── background.ts ──────────────────┘│
│  runCapturePipeline()                                │
│   ├─ doTabExtraction()  ← minimized window           │
│   │    score network URLs (m3u8 > mp4 > webm)       │
│   │    inject scraper → LD+JSON + player activation │
│   └─ storeVaultItem()  → Dexie IndexedDB            │
│         └─ FFmpeg WASM offscreen preview generation │
└──────────────────────────────────────────────────────┘
                                                       │
┌──────────────── Dashboard (dashboard-v2.html) ───────┘
│  VaultDashboard.tsx  ← React + TanStack Query        │
│  PinEntry popup  ← AES-256 PIN guard                 │
└──────────────────────────────────────────────────────┘
```

Agent integration specifications live in `vaultwares-agentciation/` and `.github/AGENT.md`. These documents describe the capture pipeline contracts, metadata schemas, and the VaultWares Privacy-First coding standard that all automated and human contributors must follow.

---

## 🧭 Privacy & Security Policy

Vault Central adheres to the **VaultWares Privacy-First Standard**:

| Principle | Implementation |
|---|---|
| **Privacy** | All data stored locally; zero external requests made by the extension itself |
| **Data Integrity** | Every field parsed through Zod schemas to block XSS and injection |
| **Isolation** | HLS interception runs in a separate minimized tab; no cross-origin data leaks |
| **Encryption** | AES-256 (CryptoJS) applied to IndexedDB blobs when PIN is enabled |
| **Zero Tracking** | No analytics, no telemetry, no remote logging |

---

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for coding standards, branch conventions, and the security checklist required before opening a pull request.

---

## 📄 License

ISC © [VaultWares](https://github.com/p-potvin/vault-central)
