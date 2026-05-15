# Agent Ledger
Created ledger
- **2026-05-11**: Bolt Performance Optimization - Added `domainCache` to `src/scripts/content.ts` and `src/scripts/content.js` to prevent repeated synchronous `new URL()` instantiations during URL extraction, eliminating an O(N) performance bottleneck.

- **2026-05-14**: VaultDashboard UI Updates - Updated the 'Browser Sync' button to be fully colored (removed dashed border) when sync is enabled, adding the dashed border only on hover. Also adjusted the 'Details view' (viewMode 1) to explicitly set a height of 60px (`h-[60px]`) and centered the V-ID badge vertically by adding `items-center`.

- **2026-05-13**: Ziegler Security Cleanup - Addressed error leakage vulnerabilities by removing internal error details `e.message` and `String(e)` from payload responses in `src/scripts/content.ts`, `src/scripts/content.js`, `src/offscreen/sandbox.ts`, and `src/offscreen/sandbox.js`. Replaced with generic error strings. Also removed debug logging in VaultDashboard for code health.

- **2026-05-13**: Bolt Performance Optimization - Replaced synchronous `document.elementFromPoint` layout calculations with `e.composedPath()[0]` in global `mousemove` listeners across content scripts to eliminate severe main-thread scroll jank.
## 2026-05-15 - Optimize DOM querying in content script

**Goal:** Reduce performance overhead during MutationObserver callbacks.

**Changes:**
- Modified `src/scripts/content.ts` and `src/scripts/content.js` to use `document.querySelectorAll("a:not([data-vault-scanned])")` instead of `document.querySelectorAll("a")`.
- Added logic to set `data-vault-scanned` attribute on processed elements.
- Updated `browser.storage.onChanged` listener to clear the `data-vault-scanned` attribute from all links when the cached URLs change, ensuring correct rescans.

**Reasoning:** On infinitely scrolling pages, the number of links grows significantly. Querying all links and iterating over them on every DOM mutation becomes a major O(N) bottleneck. By targeting only unprocessed links and caching the processing state in the DOM, we reduce the complexity to O(new_links), drastically improving performance and preventing scroll jank.
