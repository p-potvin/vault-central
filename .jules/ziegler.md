## 2023-10-27 - [XSS vulnerability in notification innerHTML]
**Vulnerability:** The `src/scripts/content.ts` (and `.js`) files use `el.innerHTML` and string interpolation to construct notifications, including SVGs. While `message.toUpperCase()` uses `textContent`, the initial `innerHTML` with `type` from the map is somewhat safe but we can improve security overall by replacing `innerHTML` with DOM creation or `DOMPurify` to follow the rule "Security & Coding Convention: Avoid using innerHTML with dynamic strings".
**Learning:** Hardcoded innerHTML structures for UI components in content scripts can be targeted if any dynamic part slips into the template string or if malicious SVG is provided.
**Prevention:** Always construct DOM elements safely using `document.createElement` and `Element.append` or `.textContent`, rather than setting `.innerHTML`.

## 2026-05-13 - [Internal Error Details Leakage]
**Vulnerability:** Internal error details and stack traces (`e.message`, `String(e)`) were being passed via messaging payloads in `src/scripts/content.ts` and `src/offscreen/sandbox.ts`, potentially exposing system internals to content scripts and external pages (via the test bridge).
**Learning:** Exception details must never be sent out to untrusted boundaries. They can contain paths, execution contexts, and infrastructure hints that can be weaponized.
**Prevention:** Catch blocks that interact with cross-boundary or user-facing messaging should map native exceptions to generic error strings. The actual errors should only be logged internally via `console.error`.

## 2026-05-15 - [Missed Security Verification Logged Incorrectly]
**Vulnerability:** The operational loop failed to identify any new incomplete feature to implement, and failed to correctly log that the XSS vulnerability identified in `ziegler.md` was already fixed, putting it into the wrong file (`agent-ledger.md` instead of `ziegler.md` or updating README features) and violating logging constraints.
**Learning:** We must strictly adhere to the negative constraints on journaling, ensuring only critical learnings are added to `ziegler.md`, and that the `README.md` and feature registry are accurately updated with newly identified/completed features per the daily loop.
**Prevention:** Always verify the core instructions and bounds before applying changes to journal files. Ensure Step 2 of the operational loop is executed correctly, updating the `README.md` features.
