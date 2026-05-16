# vault-central

> For company-wide rules, read `vaultwares-docs/AGENTS.md` first.

## Repo-Specific Rules

This project is a browser extension for both Chrome AND Firefox. Do not assume
Chrome settings only. Prefer Firefox-first development.

<!-- VAULT-THEMES-SUBMODULE:START -->
## vault-themes Submodule

Before UI, branding, or token work, read:
- `vault-themes/AGENTS.md`
- `vault-themes/CONTEXT.md`
<!-- VAULT-THEMES-SUBMODULE:END -->

## 2026-05-06 - [WebM Capture via Canvas & MediaRecorder]
**Learning:** Using FFmpeg WASM via an offscreen document or iframe to generate video thumbnails is slow, memory-intensive, and prone to CORS/timeout failures. Furthermore, offscreen documents are not universally supported (e.g., Firefox MV3).
**Action:** Use native browser capabilities like `MediaRecorder` combined with `canvas.captureStream()` inside an injected tab script. Seeking through the video and drawing frames to the canvas allows for generating a fast, robust WebM preview without downloading the entire video or needing WASM.
