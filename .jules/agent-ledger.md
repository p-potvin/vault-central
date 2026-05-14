# Agent Ledger
Created ledger
- **2026-05-11**: Bolt Performance Optimization - Added `domainCache` to `src/scripts/content.ts` and `src/scripts/content.js` to prevent repeated synchronous `new URL()` instantiations during URL extraction, eliminating an O(N) performance bottleneck.

- **2026-05-14**: VaultDashboard UI Updates - Updated the 'Browser Sync' button to be fully colored (removed dashed border) when sync is enabled, adding the dashed border only on hover. Also adjusted the 'Details view' (viewMode 1) to explicitly set a height of 60px (`h-[60px]`) and centered the V-ID badge vertically by adding `items-center`.

- **2026-05-13**: Ziegler Security Cleanup - Addressed error leakage vulnerabilities by removing internal error details `e.message` and `String(e)` from payload responses in `src/scripts/content.ts`, `src/scripts/content.js`, `src/offscreen/sandbox.ts`, and `src/offscreen/sandbox.js`. Replaced with generic error strings. Also removed debug logging in VaultDashboard for code health.

- **2026-05-13**: Bolt Performance Optimization - Replaced synchronous `document.elementFromPoint` layout calculations with `e.composedPath()[0]` in global `mousemove` listeners across content scripts to eliminate severe main-thread scroll jank.
