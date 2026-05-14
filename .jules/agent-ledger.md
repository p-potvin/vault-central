# Agent Ledger
Created ledger
- **2024-05-11**: Bolt Performance Optimization - Added `domainCache` to `src/scripts/content.ts` and `src/scripts/content.js` to prevent repeated synchronous `new URL()` instantiations during URL extraction, eliminating an O(N) performance bottleneck.
- **2026-05-14**: VaultDashboard UI Updates - Updated the 'Browser Sync' button to be fully colored (removed dashed border) when sync is enabled, adding the dashed border only on hover. Also adjusted the 'Details view' (viewMode 1) to explicitly set a height of 60px (`h-[60px]`) and centered the V-ID badge vertically by adding `items-center`.
