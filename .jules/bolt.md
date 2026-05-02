## 2026-04-21 - [useDeferredValue for filtering]
**Learning:** useDeferredValue provides an easy win for large list filtering when typing in inputs without having to implement debouncing.
**Action:** Use useDeferredValue for filtering lists to keep UI responsive on typing.

## 2024-04-23 - Prevent main-thread blocking in expensive list filters
**Learning:** Filtering lists while typing can cause massive input latency if the list is long, since React will re-render and re-calculate synchronously on every keystroke. Also, running string manipulations like `.toLowerCase()` inside an `O(N)` loop on every render is incredibly inefficient.
**Action:** Use React 19's `useDeferredValue` on the raw string state to keep inputs fast and responsive, and ensure the `.toLowerCase()` call is hoisted *outside* the `filter` loop so it only evaluates once per render instead of `N` times.
## 2024-04-23 - Prevent main-thread blocking in expensive list filters
**Learning:** Filtering lists while typing can cause massive input latency if the list is long, since React will re-render and re-calculate synchronously on every keystroke. Also, running string manipulations like `.toLowerCase()` inside an `O(N)` loop on every render is incredibly inefficient.
**Action:** Use React 19's `useDeferredValue` on the raw string state to keep inputs fast and responsive, and ensure the `.toLowerCase()` call is hoisted *outside* the `filter` loop so it only evaluates once per render instead of `N` times.
## 2026-04-25 - [Avoid lockfile side-effects]
**Learning:** Running `npm install` to fix missing test binaries can silently modify `package-lock.json`, violating the strict boundary.
**Action:** Always run `git checkout -- package-lock.json` after an uninstructed `npm install` to restore the original state before creating a PR.
## 2024-04-26 - [Fast string sorting]
**Learning:** `String.prototype.localeCompare` is incredibly slow when used inside large `.sort()` loops on arrays. V8 has to recreate the locale settings and resolve arguments on every single element comparison.
**Action:** Always instantiate `Intl.Collator` outside of `.sort()` callbacks and use the collator's `.compare` method instead for 10x-100x performance improvements.

## 2024-05-18 - [Optimization] Cache Intl.DateTimeFormat in React Render Loops
**Learning:** Instantiating `new Date().toLocaleDateString()` and `.toLocaleString()` inside large render loops in React (like maps or frequent state updates) creates an enormous O(N) performance bottleneck because V8 must re-parse and instantiate the locale format rules on every call.
**Action:** Use `Intl.DateTimeFormat` outside of the render loops instead, caching the format instances to avoid redundant instantiations inside lists or frequent renders.
## 2026-05-01 - [Optimization] Array join over String Concatenation for Large Payloads
**Learning:** Repetitive string concatenation (`binary += chunk`) inside a loop for large data payloads (like Blob to Base64 conversion) causes an O(N^2) memory reallocation overhead in V8.
**Action:** Use an array to collect chunks (`chunks.push(chunk)`) and call `.join('')` at the end to assemble the final string, significantly reducing memory footprint and improving execution time.
