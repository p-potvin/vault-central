## 2023-10-27 - [XSS vulnerability in notification innerHTML]
**Vulnerability:** The `src/scripts/content.ts` (and `.js`) files use `el.innerHTML` and string interpolation to construct notifications, including SVGs. While `message.toUpperCase()` uses `textContent`, the initial `innerHTML` with `type` from the map is somewhat safe but we can improve security overall by replacing `innerHTML` with DOM creation or `DOMPurify` to follow the rule "Security & Coding Convention: Avoid using innerHTML with dynamic strings".
**Learning:** Hardcoded innerHTML structures for UI components in content scripts can be targeted if any dynamic part slips into the template string or if malicious SVG is provided.
**Prevention:** Always construct DOM elements safely using `document.createElement` and `Element.append` or `.textContent`, rather than setting `.innerHTML`.

## 2026-05-13 - [Internal Error Details Leakage]
**Vulnerability:** Internal error details and stack traces (`e.message`, `String(e)`) were being passed via messaging payloads in `src/scripts/content.ts` and `src/offscreen/sandbox.ts`, potentially exposing system internals to content scripts and external pages (via the test bridge).
**Learning:** Exception details must never be sent out to untrusted boundaries. They can contain paths, execution contexts, and infrastructure hints that can be weaponized.
**Prevention:** Catch blocks that interact with cross-boundary or user-facing messaging should map native exceptions to generic error strings. The actual errors should only be logged internally via `console.error`.
