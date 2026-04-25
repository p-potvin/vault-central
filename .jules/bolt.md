## 2024-04-23 - Prevent main-thread blocking in expensive list filters
**Learning:** Filtering lists while typing can cause massive input latency if the list is long, since React will re-render and re-calculate synchronously on every keystroke. Also, running string manipulations like `.toLowerCase()` inside an `O(N)` loop on every render is incredibly inefficient.
**Action:** Use React 19's `useDeferredValue` on the raw string state to keep inputs fast and responsive, and ensure the `.toLowerCase()` call is hoisted *outside* the `filter` loop so it only evaluates once per render instead of `N` times.
## 2026-04-25 - [Avoid lockfile side-effects]
**Learning:** Running `npm install` to fix missing test binaries can silently modify `package-lock.json`, violating the strict boundary.
**Action:** Always run `git checkout -- package-lock.json` after an uninstructed `npm install` to restore the original state before creating a PR.
