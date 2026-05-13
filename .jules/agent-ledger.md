# Agent Ledger
Created ledger
- **2024-05-11**: Bolt Performance Optimization - Added `domainCache` to `src/scripts/content.ts` and `src/scripts/content.js` to prevent repeated synchronous `new URL()` instantiations during URL extraction, eliminating an O(N) performance bottleneck.

- **2026-05-13**: Ziegler Security Cleanup - Addressed error leakage vulnerabilities by removing internal error details `e.message` and `String(e)` from payload responses in `src/scripts/content.ts`, `src/scripts/content.js`, `src/offscreen/sandbox.ts`, and `src/offscreen/sandbox.js`. Replaced with generic error strings. Also removed debug logging in VaultDashboard for code health.
