# Vault Central Global Instructions

This project is a browser extension for both Chrome AND Firefox, do not assume chrome settings only. In fact, prefer firefox-first development.

<!-- VAULT-THEMES-SUBMODULE:START -->
## Vault Themes Submodule Rules

This repository includes `vault-themes`. Before changing UI, branding, design
systems, theme tokens, shared components, authentication UX, encrypted
client-to-client communication UX, Figma-derived implementation, or agent/IDE
instructions, read these stable root files:

- `vault-themes/AGENTS.md`
- `vault-themes/CONTEXT.md`

When the submodule has the cleaned layout, also read:

- `vault-themes/brand/brand-guide.md`
- `vault-themes/brand/tokens/tokens.ts`

Treat `vault-themes` as the shared VaultWares source of truth. Do not copy its
rules into this repo unless a tool-specific file requires a short pointer.
<!-- VAULT-THEMES-SUBMODULE:END -->

## 2024-05-06 - [WebM Capture via Canvas & MediaRecorder]
**Learning:** Using FFmpeg WASM via an offscreen document or iframe to generate video thumbnails is slow, memory-intensive, and prone to CORS/timeout failures. Furthermore, offscreen documents are not universally supported (e.g., Firefox MV3).
**Action:** Use native browser capabilities like `MediaRecorder` combined with `canvas.captureStream()` inside an injected tab script. Seeking through the video and drawing frames to the canvas allows for generating a fast, robust WebM preview without downloading the entire video or needing WASM.
