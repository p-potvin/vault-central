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
## 2026-05-03 - [Avoid lockfile side-effects on npm install]\n**Learning:** Running `npm install <package>` to resolve missing testing dependencies or binaries implicitly causes NPM to update and write to `package-lock.json`.\n**Action:** ALWAYS run `git checkout -- package.json package-lock.json` after installing temporary dependencies for testing purposes to avoid uninstructed lockfile commits.

## 2026-05-05 - [Optimization] React.memo for Large Lists
**Learning:** Extracting an inline `map` loop item renderer into its own component and wrapping it in `React.memo` provides a huge performance boost by skipping re-renders of list items when parent component state (e.g. search string, sidebar toggle) updates.
**Action:** Always extract list items into a `React.memo` wrapped component when dealing with large lists or grids.

## 2026-05-16 - [Optimization] useCallback with React.memo
**Learning:** Wrapping a component in `React.memo` will not prevent re-renders if the props passed to it are inline functions or unmemoized callback functions from the parent. Since functions are re-created on each render, they will fail shallow comparison.
**Action:** When extracting child components to optimize performance with `React.memo`, always verify that any passed function props (like `onClick` handlers) are wrapped in `useCallback` in the parent component.
