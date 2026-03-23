import browser from 'webextension-polyfill';

/**
 * [VaultAuth] Background Extraction Logic
 * ---------------------------------------
 * Performs a background extraction of video sources from a target URL.
 * Uses a temporary hidden tab to intercept network requests and run injection logic.
 * Compatible with Chrome and Firefox via webextension-polyfill.
 */
async function doTabExtraction(targetUrl: string): Promise<string | null> {
    console.log("[VaultAuth] Starting extraction for:", targetUrl);
    let scraperTabId: number | undefined = undefined;
    let webRequestListener: ((details: browser.WebRequest.OnBeforeRequestDetailsType) => void) | null = null;
    let globalTimeoutId: ReturnType<typeof setTimeout> | null = null;

    return new Promise(async (resolve) => {
        let isResolved = false;
        let latestM3u8: string | null = null;
        let injectionStarted = false;

        const cleanup = async (result: string | null, reason: string) => {
            if (isResolved) return;
            isResolved = true;

            console.log(`[VaultAuth] Cleanup: ${reason}. TabID: ${scraperTabId}`);

            if (globalTimeoutId) clearTimeout(globalTimeoutId);

            if (webRequestListener && browser.webRequest) {
                try {
                    browser.webRequest.onBeforeRequest.removeListener(webRequestListener);
                } catch (e) {
                    console.warn("[VaultAuth] Error removing webRequest listener:", e);
                }
            }

            if (scraperTabId !== undefined) {
                try {
                    await browser.tabs.remove(scraperTabId);
                } catch (e) {
                    /* ignore if already closed */
                    console.debug("[VaultAuth] Tab already closed or error:", e);
                }
            }

            resolve(result);
        };

        try {
            // Create a background tab (not active)
            const scraperTab = await browser.tabs.create({ url: targetUrl, active: false });
            scraperTabId = scraperTab.id;

            // Global safety timeout
            globalTimeoutId = setTimeout(() => {
                cleanup(latestM3u8 || null, "Global isolation timeout reached (16s)");
            }, 16000);

            // 1. Network intercept for .m3u8 (HLS Bypass)
            if (browser.webRequest) {
                webRequestListener = (details) => {
                    if (details.tabId === scraperTabId && details.url.includes('.m3u8')) {
                        console.log("[VaultAuth] Intercepted HLS stream:", details.url);
                        latestM3u8 = details.url;
                        // We don't resolve immediately; keep listening until script injection or timeout
                    }
                };
                browser.webRequest.onBeforeRequest.addListener(
                    webRequestListener,
                    { urls: ["<all_urls>"], tabId: scraperTabId }
                );
            }

            // 2. DOM Extraction via Script Injection
            const tabUpdateListener = (tabId: number, info: browser.Tabs.OnUpdatedChangeInfoType) => {
                if (tabId === scraperTabId && info.status === 'complete') {
                    browser.tabs.onUpdated.removeListener(tabUpdateListener);
                    injectScript();
                }
            };
            browser.tabs.onUpdated.addListener(tabUpdateListener);

            const injectScript = async () => {
                if (injectionStarted || isResolved || scraperTabId === undefined) return;
                injectionStarted = true;

                try {
                    const results = await browser.scripting.executeScript({
                        target: { tabId: scraperTabId },
                        func: () => {
                            const v = document.querySelector('video') as HTMLVideoElement | null;
                            if (v && v.src && !v.src.startsWith('blob:')) return v.src;
                            const s = document.querySelector('video source') as HTMLSourceElement | null;
                            if (s && s.src && !s.src.startsWith('blob:')) return s.src;
                            return null;
                        }
                    });

                    const foundSrc = results[0]?.result;
                    if (foundSrc) {
                        cleanup(foundSrc as string, "Script injection success");
                    }
                } catch (e) {
                    console.error("[VaultAuth] Injection error:", e);
                }
            };

        } catch (e) {
            console.error("[VaultAuth] Tab isolation failed:", e);
            cleanup(null, "Internal isolation error");
        }
    });
}

/**
 * Singleton Dashboard Opener
 */
async function openDashboard() {
    const url = browser.runtime.getURL('dashboard-v2.html');
    const tabs = await browser.tabs.query({ url });
    
    if (tabs.length > 0) {
        // If already open, focus the first one
        await browser.tabs.update(tabs[0].id!, { active: true });
        // Also focus the window just in case
        if (tabs[0].windowId) {
            await browser.windows.update(tabs[0].windowId, { focused: true });
        }
    } else {
        // Otherwise create new
        await browser.tabs.create({ url });
    }
}

/**
 * Message Dispatcher
 */
browser.runtime.onMessage.addListener((request: any) => {
    if (request.action === "extract_fresh_m3u8") {
        return doTabExtraction(request.url).then(src => ({ src }));
    }
    if (request.action === "open_dashboard") {
        openDashboard();
        return true;
    }
    return false;
});

/**
 * Handle Extension Action (Icon Click)
 */
browser.action.onClicked.addListener(() => {
    openDashboard();
});

/**
 * Handle Commands (Keyboard Shortcuts)
 */
browser.commands.onCommand.addListener(async (command) => {
    if (command === "_execute_action" || command === "open-dashboard") {
        openDashboard();
    } else if (command === "capture-video") {
        try {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]?.id) {
                console.log("[VaultAuth] Sending shortcut command to tab", tabs[0].id);
                await browser.tabs.sendMessage(tabs[0].id, { type: "capture-video" });
            }
        } catch (error) {
            console.error("[VaultAuth] Error triggering capture-video shortcut:", error);
        }
    }
});
