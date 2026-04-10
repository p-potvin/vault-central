import browser from 'webextension-polyfill';
import { getSavedVideos, saveVideos } from '../../src/lib/storage-vault';
import { STORAGE_KEYS } from '../../src/lib/constants';
class DebugLogger {
    logs = [];
    log(msg, ...args) {
        const line = `[${new Date().toISOString()}] [VaultAuth-Debug] ${msg} ${args.map((a) => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
        console.log(line);
        this.logs.push(line);
        if (this.logs.length > 500)
            this.logs.shift();
    }
    warn(msg, ...args) {
        const line = `[${new Date().toISOString()}] [VaultAuth-Warn] ${msg} ${args.map((a) => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
        console.warn(line);
        this.logs.push(line);
        if (this.logs.length > 500)
            this.logs.shift();
    }
    error(msg, ...args) {
        const line = `[${new Date().toISOString()}] [VaultAuth-Error] ${msg} ${args.map((a) => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
        console.error(line);
        this.logs.push(line);
        if (this.logs.length > 500)
            this.logs.shift();
    }
    async downloadLogFile() {
        const blob = new Blob([this.logs.join('\n')], { type: 'text/plain' });
        const objUrl = URL.createObjectURL(blob);
        await browser.downloads.download({ url: objUrl, filename: `vault_central_debug_${Date.now()}.log` });
        URL.revokeObjectURL(objUrl);
    }
}
const logger = new DebugLogger();
async function doTabExtraction(targetUrl) {
    logger.log("Starting extraction for:", targetUrl);
    let scraperTabId = undefined;
    let webRequestListener = null;
    let globalTimeoutId = null;
    let scraperWindowId = undefined;
    return new Promise(async (resolve) => {
        let isResolved = false;
        let latestM3u8 = null;
        let injectionStarted = false;
        const defaultMetadata = { title: "", thumbnail: "", duration: 0, author: "", views: "", tags: [], likes: "", date: "" };
        const cleanup = async (result, reason) => {
            if (isResolved)
                return;
            isResolved = true;
            logger.log(`Cleanup triggered. Reason: ${reason}. TabID: ${scraperTabId}`);
            if (globalTimeoutId)
                clearTimeout(globalTimeoutId);
            if (webRequestListener && browser.webRequest) {
                try {
                    browser.webRequest.onBeforeRequest.removeListener(webRequestListener);
                }
                catch (e) {
                    logger.warn("Error removing webRequest listener:", e);
                }
            }
            if (scraperTabId !== undefined) {
                try {
                    await browser.tabs.remove(scraperTabId);
                }
                catch (e) { }
            }
            resolve(result);
        };
        try {
            const scraperTab = await browser.tabs.create({ url: targetUrl, active: false });
            if (scraperTab.id !== undefined) {
                try {
                    await browser.tabs.hide(scraperTab.id);
                }
                catch (e) { }
            }
            scraperTabId = scraperTab.id;
            scraperWindowId = scraperTab.windowId;
            globalTimeoutId = setTimeout(() => {
                cleanup(latestM3u8 ? { src: latestM3u8, metadata: defaultMetadata } : null, "Timeout reached");
            }, 35000); // Extended timeout for WebM generation
            if (browser.webRequest) {
                webRequestListener = (details) => {
                    const lowercaseUrl = details.url.toLowerCase();
                    if (details.tabId === scraperTabId) {
                        const isStream = lowercaseUrl.includes('.m3u8') || lowercaseUrl.includes('manifest') || lowercaseUrl.includes('.ts');
                        const isDirectVideo = /\.(mp4|webm|flv|mkv|mov)(\?|$)/.test(lowercaseUrl);
                        if (isStream || isDirectVideo) {
                            if (!latestM3u8 || isStream)
                                latestM3u8 = details.url;
                        }
                    }
                };
                browser.webRequest.onBeforeRequest.addListener(webRequestListener, { urls: ["<all_urls>"], tabId: scraperTabId });
            }
            const tabUpdateListener = (tabId, info) => {
                if (tabId === scraperTabId && info.status === 'complete') {
                    browser.tabs.onUpdated.removeListener(tabUpdateListener);
                    injectScript();
                }
            };
            browser.tabs.onUpdated.addListener(tabUpdateListener);
            const injectScript = async () => {
                if (injectionStarted || isResolved || scraperTabId === undefined)
                    return;
                injectionStarted = true;
                try {
                    const results = await browser.scripting.executeScript({
                        target: { tabId: scraperTabId },
                        func: async () => {
                            const delay = (ms) => new Promise(r => setTimeout(r, ms));
                            const captureWebMPreview = async (video) => {
                                try {
                                    video.muted = true;
                                    video.playsInline = true;
                                    const canvas = document.createElement('canvas');
                                    canvas.width = video.videoWidth || 640;
                                    canvas.height = video.videoHeight || 360;
                                    const ctx = canvas.getContext('2d');
                                    const stream = canvas.captureStream(20);
                                    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
                                    const chunks = [];
                                    recorder.ondataavailable = e => { if (e.data.size > 0)
                                        chunks.push(e.data); };
                                    recorder.start();
                                    const duration = (video.duration && isFinite(video.duration) && video.duration > 0) ? video.duration : 60;
                                    const segments = 10;
                                    const segmentLength = 2000;
                                    for (let i = 0; i < segments; i++) {
                                        video.currentTime = (duration / segments) * i;
                                        await new Promise((r) => {
                                            const seeked = () => { video.removeEventListener('seeked', seeked); r(null); };
                                            video.addEventListener('seeked', seeked);
                                            setTimeout(r, 1000);
                                        });
                                        await video.play().catch(() => { });
                                        const start = Date.now();
                                        while (Date.now() - start < segmentLength) {
                                            if (ctx)
                                                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                                            await delay(50); // Pump frames to bypass background throttle
                                        }
                                    }
                                    video.pause();
                                    recorder.stop();
                                    return await new Promise((resolve) => {
                                        recorder.onstop = () => {
                                            const blob = new Blob(chunks, { type: 'video/webm' });
                                            const reader = new FileReader();
                                            reader.onloadend = () => resolve(reader.result);
                                            reader.readAsDataURL(blob);
                                        };
                                    });
                                }
                                catch (e) {
                                    return null;
                                }
                            };
                            const captureJpegFrame = async (video) => {
                                try {
                                    if (video.currentTime === 0)
                                        video.currentTime = 5;
                                    await delay(800);
                                    const canvas = document.createElement('canvas');
                                    canvas.width = video.videoWidth || 640;
                                    canvas.height = video.videoHeight || 360;
                                    const ctx = canvas.getContext('2d');
                                    if (ctx) {
                                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                                        return canvas.toDataURL('image/jpeg', 0.5);
                                    }
                                }
                                catch (e) {
                                    return null;
                                }
                                return null;
                            };
                            const clickAllPlayers = async () => {
                                const selectors = [
                                    'video', 'iframe', 'button[aria-label*="Play"]',
                                    '.vjs-big-play-button', '.ytp-large-play-button',
                                    '[class^="media-player"]', '[role="button"]'
                                ];
                                for (const selector of selectors) {
                                    try {
                                        const elements = document.querySelectorAll(selector);
                                        for (const el of Array.from(elements)) {
                                            if (el instanceof HTMLVideoElement) {
                                                el.muted = true;
                                                el.play().catch(() => { });
                                            }
                                            else {
                                                el.focus();
                                                el.click();
                                            }
                                            await delay(200);
                                        }
                                    }
                                    catch (e) { }
                                }
                            };
                            const findBestVideoAndMeta = async () => {
                                const metadata = { title: document.title, thumbnail: "", duration: 0, author: "", views: "", tags: [], likes: "", date: "" };
                                const getMeta = (prop, name) => {
                                    const el = document.querySelector(`meta[property="${prop}"], meta[name="${name}"]`);
                                    return el ? el.content : "";
                                };
                                metadata.title = getMeta("og:title", "title") || metadata.title;
                                metadata.thumbnail = getMeta("og:image", "image") || "";
                                metadata.author = getMeta("og:site_name", "author");
                                metadata.tags = (getMeta("og:video:tag", "keywords") || '').split(',').map(s => s.trim());
                                const videos = Array.from(document.querySelectorAll('video'));
                                let bestSrc = null;
                                let maxScore = -1;
                                let bestVideoEl = null;
                                for (const v of videos) {
                                    const rect = v.getBoundingClientRect();
                                    let score = rect.width * rect.height;
                                    const idClass = (v.id + " " + v.className).toLowerCase();
                                    if (idClass.match(/player|main|primary|hero|video-js|vjs|jwplayer/))
                                        score += 1000000;
                                    if (v.src && !v.src.startsWith('blob:')) {
                                        if (score > maxScore) {
                                            maxScore = score;
                                            bestSrc = v.src;
                                            bestVideoEl = v;
                                            if (!isNaN(v.duration))
                                                metadata.duration = v.duration;
                                        }
                                    }
                                    else {
                                        const sources = Array.from(v.querySelectorAll('source'));
                                        for (const s of sources) {
                                            if (s.src && !s.src.startsWith('blob:')) {
                                                if (score > maxScore) {
                                                    maxScore = score;
                                                    bestSrc = s.src;
                                                    bestVideoEl = v;
                                                    if (!isNaN(v.duration))
                                                        metadata.duration = v.duration;
                                                }
                                            }
                                        }
                                    }
                                }
                                if (bestVideoEl) {
                                    const webm = await captureWebMPreview(bestVideoEl);
                                    if (webm) {
                                        metadata.thumbnail = webm;
                                    }
                                    else {
                                        const jpeg = await captureJpegFrame(bestVideoEl);
                                        if (jpeg)
                                            metadata.thumbnail = jpeg;
                                    }
                                }
                                return { src: bestSrc, metadata };
                            };
                            let result = await findBestVideoAndMeta();
                            if (!result.src && !result.metadata.thumbnail.startsWith('data:video')) {
                                await delay(2500);
                                await clickAllPlayers();
                                await delay(3000);
                                result = await findBestVideoAndMeta();
                            }
                            return result;
                        }
                    });
                    const foundResult = results[0]?.result;
                    if (!foundResult?.metadata?.thumbnail && scraperWindowId !== undefined) {
                        try {
                            await browser.tabs.update(scraperTabId, { active: true });
                            await new Promise(r => setTimeout(r, 800));
                            const snap = await browser.tabs.captureTab(scraperWindowId, { format: "jpeg", quality: 30 });
                            if (snap && foundResult)
                                foundResult.metadata.thumbnail = snap;
                        }
                        catch (e) { }
                    }
                    if (latestM3u8 && foundResult) {
                        foundResult.src = latestM3u8;
                        cleanup(foundResult, "Intercepted network src");
                    }
                    else if (foundResult?.src) {
                        cleanup(foundResult, "DOM extraction success");
                    }
                    else if (latestM3u8) {
                        cleanup({ src: latestM3u8, metadata: foundResult?.metadata ?? defaultMetadata }, "Network fallback");
                    }
                    else {
                        setTimeout(() => {
                            cleanup(latestM3u8 ? { src: latestM3u8, metadata: foundResult?.metadata ?? defaultMetadata } : (foundResult ?? null), "Timeout fallback");
                        }, 2000);
                    }
                }
                catch (e) {
                    cleanup(null, "Injection threw an error");
                }
            };
        }
        catch (e) {
            cleanup(null, "Setup failed");
        }
    });
}
async function openDashboard() {
    const url = browser.runtime.getURL('dashboard-v2.html');
    const tabs = await browser.tabs.query({});
    const { [STORAGE_KEYS.ACTIVE_TAB_ID]: storedTabId } = await browser.storage.local.get(STORAGE_KEYS.ACTIVE_TAB_ID);
    let dashboardTab = null;
    if (storedTabId) {
        dashboardTab = tabs.find(t => t.id === storedTabId && t.url?.startsWith(url));
    }
    if (!dashboardTab)
        dashboardTab = tabs.find(t => t.url?.startsWith(url));
    if (dashboardTab && dashboardTab.id) {
        await browser.tabs.update(dashboardTab.id, { active: true });
        if (dashboardTab.windowId)
            await browser.windows.update(dashboardTab.windowId, { focused: true });
    }
    else {
        const newTab = await browser.tabs.create({ url, active: true });
        if (newTab.id)
            await browser.storage.local.set({ [STORAGE_KEYS.ACTIVE_TAB_ID]: newTab.id });
    }
}
async function runCapturePipeline(data, tabId, windowId) {
    try {
        const targetUrl = data.url;
        let finalSrc = data.url;
        if (!data.thumbnail && windowId) {
            try {
                data.thumbnail = await browser.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 20 });
            }
            catch (e) { }
        }
        const extracted = await doTabExtraction(targetUrl);
        if (extracted && extracted.src) {
            finalSrc = extracted.src;
            if (extracted.metadata) {
                Object.assign(data, extracted.metadata);
            }
        }
        data.rawVideoSrc = finalSrc;
        const saved = await getSavedVideos(true);
        if (saved.some(v => v.url === data.url))
            return { success: false, message: "Item already in vault" };
        saved.push(data);
        await saveVideos(saved);
        if (data.rawVideoSrc && !data.thumbnail.startsWith('data:video')) {
            setupOffscreenDocument().then(() => {
                browser.runtime.sendMessage({
                    action: "generate_preview",
                    data: { url: data.rawVideoSrc, duration: typeof data.duration === 'number' ? data.duration : 60 }
                }).catch(() => { });
            });
        }
        return { success: true, data };
    }
    catch (err) {
        return { success: false, message: err.message };
    }
}
async function setupOffscreenDocument() {
    const offscreenUrl = 'src/offscreen/processor.html';
    if (!browser.offscreen) {
        if (typeof document !== 'undefined' && document.body) {
            let frame = document.getElementById('vault-processor-frame');
            if (!frame) {
                frame = document.createElement('iframe');
                frame.id = 'vault-processor-frame';
                frame.src = browser.runtime.getURL(offscreenUrl);
                document.body.appendChild(frame);
                await new Promise((r) => frame.onload = r);
            }
        }
        return;
    }
    try {
        const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [browser.runtime.getURL(offscreenUrl)] });
        if (contexts && contexts.length > 0)
            return;
        await browser.offscreen.createDocument({
            url: offscreenUrl,
            reasons: ['DOM_PARSER', 'AUDIO_PLAYBACK', 'BLOBS'],
            justification: 'FFmpeg WASM processing for video previews'
        });
    }
    catch (e) { }
}
browser.runtime.onMessage.addListener((request, sender) => {
    if (request.action === "extract_fresh_m3u8")
        return doTabExtraction(request.url).then(res => ({ src: res?.src || null }));
    if (request.action === "open_dashboard") {
        openDashboard();
        return Promise.resolve(true);
    }
    if (request.action === "process_capture")
        return runCapturePipeline(request.data, sender?.tab?.id, sender?.tab?.windowId);
    if (request.action === "generate_preview") {
        return setupOffscreenDocument().then(() => {
            browser.runtime.sendMessage(request).catch(() => { });
            return true;
        });
    }
    if (request.action === "download_debug_logs") {
        logger.downloadLogFile();
        return Promise.resolve(true);
    }
    return false;
});
browser.action.onClicked.addListener(() => openDashboard());
browser.commands.onCommand.addListener(async (command) => {
    if (command === "_execute_action" || command === "open-dashboard") {
        openDashboard();
    }
    else if (command === "capture-video") {
        try {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            const activeTab = tabs[0];
            if (!activeTab?.id || !activeTab.url || activeTab.url.startsWith('chrome:'))
                return;
            try {
                await browser.tabs.sendMessage(activeTab.id, { type: "capture-video" });
            }
            catch (error) {
                try {
                    await browser.scripting.executeScript({
                        target: { tabId: activeTab.id },
                        func: () => alert("[Vault Central] Extension script is not active on this page. Please refresh.")
                    });
                }
                catch (e) { }
            }
        }
        catch (error) { }
    }
});
