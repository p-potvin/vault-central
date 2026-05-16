## 2023-10-27 - [XSS vulnerability in notification innerHTML]
**Vulnerability:** The `src/scripts/content.ts` (and `.js`) files use `el.innerHTML` and string interpolation to construct notifications, including SVGs. While `message.toUpperCase()` uses `textContent`, the initial `innerHTML` with `type` from the map is somewhat safe but we can improve security overall by replacing `innerHTML` with DOM creation or `DOMPurify` to follow the rule "Security & Coding Convention: Avoid using innerHTML with dynamic strings".
**Learning:** Hardcoded innerHTML structures for UI components in content scripts can be targeted if any dynamic part slips into the template string or if malicious SVG is provided.
**Prevention:** Always construct DOM elements safely using `document.createElement` and `Element.append` or `.textContent`, rather than setting `.innerHTML`.

## 🛡️-2024-05-18 - [Memory Exhaustion via large JSON files in FileReader]
**Vulnerability:** The `VaultDashboard.tsx` component allowed users to select any JSON file for the Vault Import feature, passing it directly to `reader.readAsText()` and subsequently `JSON.parse()` without size validation. An attacker (or unaware user) could upload a multi-gigabyte file, crashing the browser tab (Denial of Service).
**Learning:** Frontend `FileReader` operations and `JSON.parse` run synchronously on the main thread and consume significant heap memory. Without size limitations, file uploads are a vector for local DoS.
**Prevention:** Always implement a file size limit (e.g., `file.size > 50 * 1024 * 1024`) before initiating a `FileReader` or passing data to memory-intensive parsers.
