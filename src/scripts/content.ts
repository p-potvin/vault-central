import browser from 'webextension-polyfill';
import { VideoDataSchema } from '../types/schemas';

/**
 * [VaultAuth] Content Script (Modernized)
 * --------------------------------------
 * Handles DOM-based video detection, visual status indicators (Hearts),
 * and user notifications with a security-first approach.
 */

let lastHoveredElement: HTMLElement | null = null;
let mutationTimeout: ReturnType<typeof setTimeout> | null = null;

// Track the element currently under the mouse
document.addEventListener("mousemove", (e: MouseEvent) => {
    lastHoveredElement = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
}, { passive: true });

/**
 * Visual Feedback: Permanent Heart Indicator
 */
function addHeartIndicator(el: HTMLElement) {
    if (!el || el.querySelector(".vault-heart-indicator")) return;

    // Ensure relative positioning for absolute child
    const style = window.getComputedStyle(el);
    if (style.position === "static") {
        el.style.position = "relative";
    }

    const heart = document.createElement("div");
    heart.className = "vault-heart-indicator";
    
    // Industrial-Cyber SVG Design
    heart.innerHTML = `
        <svg viewBox="0 0 24 24" fill="#ef4444" stroke="white" stroke-width="1.5" 
             style="width: 16px; height: 16px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5)); display: block;">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
    `;

    Object.assign(heart.style, {
        position: "absolute",
        top: "4px",
        left: "4px",
        zIndex: "2147483647",
        pointerEvents: "none",
        transition: "transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
    });

    el.appendChild(heart);
}

/**
 * Scans the page for saved videos and marks them
 */
async function highlightVaultItems() {
    try {
        const storage = await browser.storage.local.get("savedVideos");
        const savedVideos = (storage.savedVideos || []) as any[];
        
        if (savedVideos.length === 0) return;

        const savedUrls = new Set(savedVideos.map((v: any) => v.url));
        const links = document.querySelectorAll("a");

        links.forEach(link => {
            if (savedUrls.has(link.href)) {
                addHeartIndicator(link as HTMLElement);
            }
        });
    } catch (e) {
        console.error("[VaultAuth] Highlight failure:", e);
    }
}

/**
 * Industrial Notification System
 */
function showVaultNotification(type: 'success' | 'removed' | 'error', message: string) {
    const existing = document.getElementById("vault-notification-portal");
    if (existing) existing.remove();

    const el = document.createElement("div");
    el.id = "vault-notification-portal";
    el.textContent = `[VAULT] ${message}`;

    const themeMap: Record<string, { bg: string, border: string }> = {
        success: { bg: "#10b981", border: "#059669" },
        removed: { bg: "#f97316", border: "#ea580c" },
        error: { bg: "#ef4444", border: "#dc2626" }
    };

    const theme = themeMap[type] || themeMap.error;

    Object.assign(el.style, {
        position: "fixed",
        bottom: "24px",
        right: "24px",
        padding: "12px 20px",
        borderRadius: "4px",
        borderLeft: `4px solid ${theme.border}`,
        backgroundColor: "rgba(17, 24, 39, 0.95)",
        color: "white",
        fontSize: "13px",
        fontWeight: "600",
        fontFamily: "'Courier New', monospace",
        boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.3)",
        zIndex: "999999",
        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: "0",
        transform: "translateX(50px)",
        pointerEvents: "none"
    });

    document.body.appendChild(el);

    requestAnimationFrame(() => {
        el.style.opacity = "1";
        el.style.transform = "translateX(0)";
    });

    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateX(50px)";
        setTimeout(() => el.remove(), 400);
    }, 3500);

    // Contextual indicator updates
    if (lastHoveredElement) {
        const target = lastHoveredElement.closest("a") as HTMLElement || lastHoveredElement;
        if (type === 'success') addHeartIndicator(target);
        if (type === 'removed') {
            const heart = target.querySelector(".vault-heart-indicator");
            if (heart) heart.remove();
        }
    }
}

/**
 * Reliable Data Extraction (Runtime Validated)
 */
function attemptExtraction(el: HTMLElement | null): any {
    const link = el?.closest("a") as HTMLAnchorElement | null;
    const url = link?.href || window.location.href;
    
    let title = "Untitled Media";
    if (el) {
        title = el.getAttribute("title") || el.getAttribute("aria-label") || el.getAttribute("alt") || "";
    }
    if (!title && link) {
        title = link.getAttribute("title") || link.getAttribute("aria-label") || "";
    }
    if (!title) {
        title = document.title;
    }

    const rawData = {
        title: title.trim().substring(0, 100),
        url: url,
        thumbnail: "",
        timestamp: Date.now()
    };

    const result = VideoDataSchema.safeParse(rawData);
    if (!result.success) {
        console.warn("[VaultAuth] Extraction validation failed:", result.error);
        return rawData;
    }
    return result.data;
}

/**
 * Message Handlers
 */
browser.runtime.onMessage.addListener((request: any) => {
    if (request.action === "get_video_data") {
        console.log("[VaultAuth] Triggering extraction from DOM...");
        return Promise.resolve(attemptExtraction(lastHoveredElement));
    }
    
    if (request.action === "show_notification") {
        showVaultNotification(request.type, request.message);
        return Promise.resolve(true);
    }
    return undefined;
});

// Initialization
const observer = new MutationObserver(() => {
    if (mutationTimeout) clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(highlightVaultItems, 1200);
});

if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    highlightVaultItems();
} else {
    window.addEventListener("DOMContentLoaded", () => {
        if(document.body) {
          observer.observe(document.body, { childList: true, subtree: true });
          highlightVaultItems();
        }
    });
}
