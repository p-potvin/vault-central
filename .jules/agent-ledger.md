# Agent Ledger
Created ledger
- **2024-05-11**: Bolt Performance Optimization - Added `domainCache` to `src/scripts/content.ts` and `src/scripts/content.js` to prevent repeated synchronous `new URL()` instantiations during URL extraction, eliminating an O(N) performance bottleneck.
- **2026-05-13**: Bolt Performance Optimization - Replaced synchronous `document.elementFromPoint` layout calculations with `e.composedPath()[0]` in global `mousemove` listeners across content scripts to eliminate severe main-thread scroll jank.
