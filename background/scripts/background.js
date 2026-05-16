import browser from 'webextension-polyfill';
import { getBackupSettings, getSavedVideos, recordBackupResult, saveBackupSettings, saveVideos } from '../../src/lib/storage-vault';
import { deletePreview, clearPreviews as dbClearPreviews } from '../../src/lib/dexie-store';
import { savePreviewBlob, getPreviewBlob, setupVault as runtimeSetupVault, unlockVault as runtimeUnlockVault, lockVault as runtimeLockVault, vaultStatus, destroyVault, } from '../../src/lib/vault-runtime';
import { DAILY_BACKUP_ALARM, downloadFullVaultBackup } from '../../src/lib/backup-vault';
import { STORAGE_KEYS } from '../../src/lib/constants';
class DebugLogger {
    logs = [];
    formatArg(arg) {
        if (arg instanceof Error)
            return `${arg.name}: ${arg.message}`;
        if (typeof arg === 'bigint')
            return arg.toString();
        if (typeof arg !== 'object' || arg === null)
            return String(arg);
        try {
            return JSON.stringify(arg);
        }
        catch {
            return Object.prototype.toString.call(arg);
        }
    }
    log(msg, ...args) {
        const line = `[${new Date().toISOString()}] [VaultAuth-Debug] ${msg} ${args.map((a) => this.formatArg(a)).join(' ')}`;
        console.log(line);
        this.logs.push(line);
        if (this.logs.length > 500)
            this.logs.shift();
    }
    warn(msg, ...args) {
        const line = `[${new Date().toISOString()}] [VaultAuth-Warn] ${msg} ${args.map((a) => this.formatArg(a)).join(' ')}`;
        console.warn(line);
        this.logs.push(line);
        if (this.logs.length > 500)
            this.logs.shift();
    }
    error(msg, ...args) {
        const line = `[${new Date().toISOString()}] [VaultAuth-Error] ${msg} ${args.map((a) => this.formatArg(a)).join(' ')}`;
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
function getNextDailyBackupTime() {
    const next = new Date();
    next.setHours(3, 0, 0, 0);
    if (next.getTime() <= Date.now()) {
        next.setDate(next.getDate() + 1);
    }
    return next.getTime();
}
async function scheduleDailyBackupAlarm() {
    const settings = await getBackupSettings();
    await browser.alarms.clear(DAILY_BACKUP_ALARM);
    if (!settings.enabled) {
        logger.log("[backup] Daily backup disabled. Alarm cleared.");
        return;
    }
    await browser.alarms.create(DAILY_BACKUP_ALARM, {
        when: getNextDailyBackupTime(),
        periodInMinutes: 1440
    });
    logger.log("[backup] Daily backup alarm scheduled.");
}
async function runAutomaticBackup() {
    const settings = await getBackupSettings();
    if (!settings.enabled)
        return;
    try {
        const result = await downloadFullVaultBackup('automatic');
        logger.log("[backup] Automatic backup complete:", result);
    }
    catch (err) {
        logger.error("[backup] Automatic backup failed:", err);
        // Avoid leaking internal error details to persisted state. Real error
        // already in the debug log above.
        await recordBackupResult('error', 'Backup operation failed');
    }
}
async function doTabExtraction(targetUrl, ctx = {}) {
    logger.log("[doTabExtraction] Starting extraction for:", targetUrl, "| origin:", ctx.originUrl, "| originTitle:", ctx.originTitle);
    let scraperTabId = undefined;
    let webRequestListener = null;
    let tabUpdateListener = null;
    let globalTimeoutId = null;
    let scraperWindowId = undefined;
    return new Promise(async (resolve) => {
        let isResolved = false;
        let latestM3u8 = null;
        let injectionStarted = false;
        const defaultMetadata = { title: "", thumbnail: "", duration: 0, author: "", views: "", tags: [], likes: "", date: "" };
        logger.log("[doTabExtraction] defaultMetadata initialized (thumbnail will be empty unless scraped)");
        const cleanup = async (result, reason) => {
            if (isResolved)
                return;
            isResolved = true;
            logger.log(`[doTabExtraction] Cleanup triggered. Reason: ${reason}. TabID: ${scraperTabId}. Result src: ${result?.src ?? 'null'}. Thumbnail present: ${!!result?.metadata?.thumbnail}, thumbnail length: ${result?.metadata?.thumbnail?.length ?? 0}`);
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
            if (tabUpdateListener) {
                try {
                    browser.tabs.onUpdated.removeListener(tabUpdateListener);
                }
                catch (e) {
                    logger.warn("[doTabExtraction] Error removing tabUpdateListener:", e);
                }
            }
            if (scraperWindowId !== undefined) {
                try {
                    await browser.windows.remove(scraperWindowId);
                }
                catch (e) {
                    logger.warn("[doTabExtraction] Error closing scraper window:", e);
                }
            }
            else if (scraperTabId !== undefined) {
                try {
                    await browser.tabs.remove(scraperTabId);
                }
                catch (e) {
                    logger.warn("[doTabExtraction] Error closing scraper tab:", e);
                }
            }
            resolve(result);
        };
        try {
            try {
                // Use a popup window so Firefox actually loads the page. 
                // We create it focused to bypass anti-popup block, then quickly restore focus.
                const scraperWindow = await browser.windows.create({
                    url: targetUrl,
                    type: 'popup',
                    state: 'normal',
                    focused: true,
                    width: 1280,
                    height: 720,
                });
                const scraperTabFromWindow = scraperWindow.tabs?.[0];
                logger.log("[doTabExtraction] Scraper window created (normal popup). windowId:", scraperWindow.id, "tabId:", scraperTabFromWindow?.id);
                scraperTabId = scraperTabFromWindow?.id;
                scraperWindowId = scraperWindow.id;
                // Immediately switch focus back to original tab/window to minimize disruption
                if (ctx.originWindowId !== undefined) {
                    try {
                        await browser.windows.update(ctx.originWindowId, { focused: true });
                    }
                    catch (e) { }
                }
                if (ctx.originTabId !== undefined) {
                    try {
                        await browser.tabs.update(ctx.originTabId, { active: true });
                    }
                    catch (e) { }
                }
            }
            catch (popupErr) {
                logger.warn("[doTabExtraction] windows.create failed (popup blocker?). Falling back to tabs.create with active:true:", popupErr);
                const scraperTab = await browser.tabs.create({ url: targetUrl, active: true });
                scraperTabId = scraperTab.id;
                logger.log("[doTabExtraction] Scraper tab fallback (active:true) created. tabId:", scraperTabId);
                // Immediately switch focus back to original tab/window
                if (ctx.originWindowId !== undefined) {
                    try {
                        await browser.windows.update(ctx.originWindowId, { focused: true });
                    }
                    catch (e) { }
                }
                if (ctx.originTabId !== undefined) {
                    try {
                        await browser.tabs.update(ctx.originTabId, { active: true });
                    }
                    catch (e) { }
                }
            }
            globalTimeoutId = setTimeout(() => {
                logger.warn("[doTabExtraction] Global timeout reached after 18s. latestM3u8:", latestM3u8);
                // Even on hard timeout, return what we got — the pipeline always
                // saves SOMETHING, never errors out (per decision-tree spec #2b3/#2c).
                cleanup(latestM3u8 ? { src: latestM3u8, metadata: defaultMetadata } : null, "Timeout reached");
            }, 18000);
            if (browser.webRequest) {
                webRequestListener = (details) => {
                    const lowercaseUrl = details.url.toLowerCase();
                    if (details.tabId === scraperTabId) {
                        const isStream = lowercaseUrl.includes('.m3u8') || lowercaseUrl.includes('manifest') || lowercaseUrl.includes('.ts');
                        const isDirectVideo = /\.(mp4|webm|flv|mkv|mov)(\?|$)/.test(lowercaseUrl);
                        if (isStream || isDirectVideo) {
                            logger.log("[doTabExtraction] Network intercept:", details.url, "| isStream:", isStream, "| isDirectVideo:", isDirectVideo);
                            if (!latestM3u8 || isStream)
                                latestM3u8 = details.url;
                        }
                    }
                };
                browser.webRequest.onBeforeRequest.addListener(webRequestListener, { urls: ["<all_urls>"], tabId: scraperTabId });
                logger.log("[doTabExtraction] webRequest listener attached for tabId:", scraperTabId);
            }
            else {
                logger.warn("[doTabExtraction] browser.webRequest is not available - network interception disabled.");
            }
            tabUpdateListener = (tabId, info) => {
                if (tabId === scraperTabId && info.status === 'complete') {
                    logger.log("[doTabExtraction] Scraper tab loaded (status=complete) via onUpdated. Injecting script...");
                    browser.tabs.onUpdated.removeListener(tabUpdateListener);
                    tabUpdateListener = null;
                    injectScript();
                }
            };
            browser.tabs.onUpdated.addListener(tabUpdateListener);
            browser.tabs.get(scraperTabId).then(tab => {
                if (tab.status === 'complete') {
                    logger.log("[doTabExtraction] Tab was already 'complete' before listener attached (cache hit). Injecting immediately.");
                    if (tabUpdateListener) {
                        browser.tabs.onUpdated.removeListener(tabUpdateListener);
                        tabUpdateListener = null;
                    }
                    injectScript();
                }
                else {
                    logger.log("[doTabExtraction] Tab status on post-create check:", tab.status, "— waiting for onUpdated...");
                }
            }).catch(e => {
                logger.warn("[doTabExtraction] Could not check post-create tab status:", e);
            });
            const injectScript = async () => {
                if (injectionStarted || isResolved || scraperTabId === undefined) {
                    logger.warn("[doTabExtraction] injectScript called but skipped. injectionStarted:", injectionStarted, "isResolved:", isResolved, "scraperTabId:", scraperTabId);
                    return;
                }
                injectionStarted = true;
                logger.log("[doTabExtraction] Executing injection script in tabId:", scraperTabId);
                try {
                    const results = await browser.scripting.executeScript({
                        target: { tabId: scraperTabId },
                        args: [{ originUrl: ctx.originUrl ?? '', originTitle: ctx.originTitle ?? '' }],
                        func: async (injectedCtx) => {
                            const delay = (ms) => new Promise(r => setTimeout(r, ms));
                            // Decision-tree #1b detection: did the scraper tab land on the
                            // same page the user fired Alt+X from? When yes, the metadata
                            // we already gathered in the origin tab is canonical and we
                            // just need a video src + preview from this same DOM.
                            const isDuplicateOfOrigin = (() => {
                                if (!injectedCtx.originUrl)
                                    return false;
                                try {
                                    const origin = new URL(injectedCtx.originUrl);
                                    const here = new URL(window.location.href);
                                    if (origin.hostname === here.hostname && origin.pathname === here.pathname)
                                        return true;
                                }
                                catch { /* fall through */ }
                                if (injectedCtx.originTitle && injectedCtx.originTitle === document.title)
                                    return true;
                                return false;
                            })();
                            const captureWebmPreview = async (video) => {
                                return new Promise(async (resolve) => {
                                    let cleanup = null;
                                    let resolved = false;
                                    const finish = (value) => {
                                        if (resolved)
                                            return;
                                        resolved = true;
                                        cleanup?.();
                                        resolve(value);
                                    };
                                    try {
                                        const canvas = document.createElement('canvas');
                                        canvas.width = 426;
                                        canvas.height = 240;
                                        const ctx = canvas.getContext('2d');
                                        if (!ctx)
                                            return resolve(null);
                                        const stream = canvas.captureStream(10); // 10 fps
                                        cleanup = () => {
                                            stream.getTracks().forEach((track) => track.stop());
                                        };
                                        let recorder;
                                        try {
                                            recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
                                        }
                                        catch (e) {
                                            try {
                                                recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
                                            }
                                            catch (e2) {
                                                console.error("[VaultCentral] MediaRecorder setup failed:", e2);
                                                return finish(null);
                                            }
                                        }
                                        const chunks = [];
                                        recorder.ondataavailable = e => { if (e.data.size > 0)
                                            chunks.push(e.data); };
                                        recorder.onstop = () => {
                                            const blob = new Blob(chunks, { type: 'video/webm' });
                                            const reader = new FileReader();
                                            reader.onload = () => finish(reader.result);
                                            reader.onerror = () => {
                                                console.error("[VaultCentral] Failed to read WebM blob from FileReader.");
                                                finish(null);
                                            };
                                            reader.readAsDataURL(blob);
                                        };
                                        recorder.onerror = () => {
                                            console.error("[VaultCentral] MediaRecorder encountered an error while recording.");
                                            finish(null);
                                        };
                                        recorder.start();
                                        const duration = (video.duration && !isNaN(video.duration) && video.duration > 0) ? video.duration : 60;
                                        // Take 10 snapshots spaced evenly across 10% to 90% of the video
                                        const startOffset = duration * 0.1;
                                        const endOffset = duration * 0.9;
                                        const segmentLength = (endOffset - startOffset) / 9;
                                        // Play to make sure readyState is sufficiently advanced
                                        video.muted = true;
                                        await video.play().catch(() => { });
                                        video.pause();
                                        for (let i = 0; i < 10; i++) {
                                            video.currentTime = startOffset + (i * segmentLength);
                                            // Wait for seeked event or timeout
                                            await new Promise(r => {
                                                let finished = false;
                                                let timeoutId = null;
                                                const done = () => {
                                                    if (finished)
                                                        return;
                                                    finished = true;
                                                    video.removeEventListener('seeked', seeked);
                                                    if (timeoutId !== null) {
                                                        clearTimeout(timeoutId);
                                                    }
                                                    r(null);
                                                };
                                                const seeked = () => {
                                                    done();
                                                };
                                                video.addEventListener('seeked', seeked);
                                                timeoutId = setTimeout(() => {
                                                    done();
                                                }, 400);
                                            });
                                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                                            // Give stream a moment to encode frame
                                            await new Promise(r => setTimeout(r, 100));
                                        }
                                        // Sanity check: if the source video is cross-origin without
                                        // CORS headers, drawImage paints onto a "tainted" canvas
                                        // and getImageData throws. captureStream/MediaRecorder
                                        // produce a valid-looking but visually-empty webm in that
                                        // case. Detect it here and bail so the FFmpeg fallback
                                        // (which fetches the source bytes directly via the
                                        // extension's host_permissions) runs instead.
                                        let hadVisibleContent = false;
                                        try {
                                            // Sample center pixel + two off-center points.
                                            const samples = [
                                                ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data,
                                                ctx.getImageData(canvas.width >> 2, canvas.height >> 2, 1, 1).data,
                                                ctx.getImageData((canvas.width * 3) >> 2, (canvas.height * 3) >> 2, 1, 1).data,
                                            ];
                                            for (const s of samples) {
                                                if (s[0] > 8 || s[1] > 8 || s[2] > 8) {
                                                    hadVisibleContent = true;
                                                    break;
                                                }
                                            }
                                        }
                                        catch (e) {
                                            // SecurityError -> tainted canvas. Treat as no content.
                                            console.warn("[VaultCentral] Canvas tainted by cross-origin video; yielding to FFmpeg fallback.");
                                            hadVisibleContent = false;
                                        }
                                        if (recorder.state !== 'inactive') {
                                            recorder.stop();
                                        }
                                        if (!hadVisibleContent) {
                                            // The webm we'd produce would be black. Discard so the
                                            // pipeline's FFmpeg fallback path triggers.
                                            return finish(null);
                                        }
                                    }
                                    catch (e) {
                                        console.error("[VaultCentral] captureWebmPreview failed:", e);
                                        finish(null);
                                    }
                                });
                            };
                            // Decision-tree #2b: aggressive ladder for messy pages with no
                            // clear video player. Tiers run in order, stopping early if a
                            // <video> starts producing a non-blob src.
                            const aggressiveTrigger = async () => {
                                const tiers = [
                                    // Tier 1: known player libraries' big-play affordances
                                    [
                                        '.jwplayer .jw-icon-display',
                                        '.jwplayer .jw-button-display',
                                        '.video-js .vjs-big-play-button',
                                        '.ytp-large-play-button',
                                        '.plyr__control--overlaid',
                                        '.shaka-play-button',
                                        '.flowplayer .play',
                                    ],
                                    // Tier 2: generic accessible-name play buttons + ARIA roles
                                    [
                                        'button[aria-label*="Play" i]',
                                        'button[title*="Play" i]',
                                        '[role="button"][aria-label*="Play" i]',
                                        '[class*="play-button" i]',
                                        '[class*="play_button" i]',
                                        '[class*="playButton"]',
                                    ],
                                    // Tier 3: hidden-ish embeds that need to materialise
                                    [
                                        'iframe[src*="player" i]',
                                        'iframe[src*="embed" i]',
                                        '[data-video]',
                                        '[data-src*=".m3u8"]',
                                    ],
                                    // Tier 4: blunt force — any <video> regardless
                                    ['video'],
                                ];
                                for (const tier of tiers) {
                                    let triggeredAny = false;
                                    for (const selector of tier) {
                                        try {
                                            const elements = document.querySelectorAll(selector);
                                            for (const el of [...elements]) {
                                                if (el instanceof HTMLVideoElement) {
                                                    el.muted = true;
                                                    el.play().catch(() => { });
                                                    triggeredAny = true;
                                                }
                                                else {
                                                    el.focus?.();
                                                    el.click?.();
                                                    triggeredAny = true;
                                                }
                                                await delay(150);
                                            }
                                        }
                                        catch (e) {
                                            console.debug("[VaultCentral] aggressiveTrigger tier failed:", e);
                                        }
                                    }
                                    if (triggeredAny) {
                                        // Give the tier a chance to spin up a real <video> with a non-blob src
                                        await delay(800);
                                        const playing = [...document.querySelectorAll('video')]
                                            .some(v => (v.src && !v.src.startsWith('blob:')) || v.currentSrc && !v.currentSrc.startsWith('blob:'));
                                        if (playing)
                                            return;
                                    }
                                }
                            };
                            // Decision-tree #2b2: candidate ladder when several <video>
                            // elements are visible and none is the obvious primary.
                            //   1. Player-library boost (id/class match)
                            //   2. Largest visible by area
                            //   3. Closest to viewport center
                            //   4. Highest URL score (mp4/webm/m3u8 > generic)
                            const scoreMediaUrl = (url) => {
                                if (!url || url.startsWith('javascript:') || url.startsWith('blob:'))
                                    return -1;
                                const u = url.toLowerCase();
                                let s = 0;
                                if (/\.(mp4|webm|mkv|flv|mov|m3u8|ts)(\?|$)/.test(u))
                                    s += 1000;
                                if (/(video|player|embed|watch|clip|media|vod)/.test(u))
                                    s += 200;
                                return s;
                            };
                            const distanceToCenter = (rect) => {
                                const cx = window.innerWidth / 2;
                                const cy = window.innerHeight / 2;
                                return Math.hypot((rect.left + rect.width / 2) - cx, (rect.top + rect.height / 2) - cy);
                            };
                            const findBestVideoAndMeta = async () => {
                                const metadata = { title: document.title, thumbnail: '', duration: 0, author: '', views: '', tags: [], likes: '', date: '' };
                                const getMeta = (prop, name) => {
                                    const el = document.querySelector(`meta[property="${prop}"], meta[name="${name}"]`);
                                    return el ? el.content : '';
                                };
                                metadata.title = getMeta('og:title', 'title') || metadata.title;
                                metadata.thumbnail = getMeta('og:image', 'image') || '';
                                metadata.author = getMeta('og:site_name', 'author');
                                metadata.tags = (getMeta('og:video:tag', 'keywords') || '').split(',').map(s => s.trim()).filter(Boolean);
                                const videos = [...document.querySelectorAll('video')];
                                const candidates = [];
                                for (const v of videos) {
                                    const rect = v.getBoundingClientRect();
                                    if (rect.width <= 0 || rect.height <= 0)
                                        continue;
                                    const idClass = (v.id + ' ' + v.className).toLowerCase();
                                    const idClassBoost = /player|main|primary|hero|video-js|vjs|jwplayer/.test(idClass) ? 1_000_000 : 0;
                                    let src = null;
                                    if (v.src && !v.src.startsWith('blob:'))
                                        src = v.src;
                                    else {
                                        const source = [...v.querySelectorAll('source')].find(s => s.src && !s.src.startsWith('blob:'));
                                        if (source)
                                            src = source.src;
                                    }
                                    candidates.push({
                                        el: v,
                                        src,
                                        area: rect.width * rect.height,
                                        centerDistance: distanceToCenter(rect),
                                        urlScore: scoreMediaUrl(src),
                                        idClassBoost,
                                    });
                                }
                                if (candidates.length === 0)
                                    return { src: null, metadata };
                                const sorted = [...candidates].sort((a, b) => {
                                    if (b.idClassBoost !== a.idClassBoost)
                                        return b.idClassBoost - a.idClassBoost;
                                    if (b.area !== a.area)
                                        return b.area - a.area;
                                    if (a.centerDistance !== b.centerDistance)
                                        return a.centerDistance - b.centerDistance;
                                    return b.urlScore - a.urlScore;
                                });
                                const best = sorted[0];
                                if (best.el.duration && !isNaN(best.el.duration))
                                    metadata.duration = best.el.duration;
                                const webm = await captureWebmPreview(best.el);
                                if (webm)
                                    metadata.thumbnail = webm;
                                return { src: best.src, metadata };
                            };
                            // First pass: maybe the page already has the player ready
                            let result = await findBestVideoAndMeta();
                            if (!result.src && !result.metadata.thumbnail.startsWith('data:video')) {
                                // Decision-tree #2b: messy page — escalate
                                await delay(1500);
                                await aggressiveTrigger();
                                await delay(1500);
                                result = await findBestVideoAndMeta();
                            }
                            // Always-save guarantee (#2b3 / #2c): never throw. Caller handles
                            // null src by saving with originUrl as link.
                            return { ...result, isDuplicateOfOrigin };
                        }
                    });
                    const foundResult = results[0]?.result;
                    logger.log("[doTabExtraction] Injected script result - src:", foundResult?.src ?? 'null', "| thumbnail length:", foundResult?.metadata?.thumbnail?.length ?? 0, "| latestM3u8:", latestM3u8 ?? 'null');
                    if (!foundResult?.metadata?.thumbnail && scraperTabId !== undefined) {
                        try {
                            logger.log("[doTabExtraction] No thumbnail from injected script. Attempting captureTab fallback on tabId:", scraperTabId);
                            await browser.tabs.update(scraperTabId, { active: true });
                            await new Promise(r => setTimeout(r, 800));
                            const captureTabFn = browser.tabs.captureTab;
                            const snap = captureTabFn
                                ? await captureTabFn(scraperTabId, { format: "jpeg", quality: 30 })
                                : await browser.tabs.captureVisibleTab(scraperWindowId, { format: "jpeg", quality: 30 });
                            if (snap && foundResult) {
                                logger.log("[doTabExtraction] captureTab/captureVisibleTab succeeded. thumbnail length:", snap.length);
                                foundResult.metadata.thumbnail = snap;
                            }
                            else {
                                logger.warn("[doTabExtraction] captureTab/captureVisibleTab returned nothing.");
                            }
                        }
                        catch (e) {
                            logger.warn("[doTabExtraction] Tab screenshot fallback failed:", e);
                        }
                    }
                    if (latestM3u8 && foundResult) {
                        logger.log("[doTabExtraction] Resolving with network-intercepted src:", latestM3u8, "| thumbnail:", !!foundResult.metadata.thumbnail);
                        foundResult.src = latestM3u8;
                        cleanup(foundResult, "Intercepted network src");
                    }
                    else if (foundResult?.src) {
                        logger.log("[doTabExtraction] Resolving with DOM-extracted src:", foundResult.src, "| thumbnail:", !!foundResult.metadata.thumbnail);
                        cleanup(foundResult, "DOM extraction success");
                    }
                    else if (latestM3u8) {
                        logger.log("[doTabExtraction] Resolving with network-only fallback. No DOM src. thumbnail:", !!(foundResult?.metadata?.thumbnail));
                        cleanup({ src: latestM3u8, metadata: foundResult?.metadata ?? defaultMetadata }, "Network fallback");
                    }
                    else {
                        logger.warn("[doTabExtraction] No src found. Scheduling 2s timeout fallback.");
                        setTimeout(() => {
                            cleanup(latestM3u8 ? { src: latestM3u8, metadata: foundResult?.metadata ?? defaultMetadata } : (foundResult ?? null), "Timeout fallback");
                        }, 2000);
                    }
                }
                catch (e) {
                    logger.error("[doTabExtraction] Injection threw an error:", e);
                    cleanup(null, "Injection threw an error");
                }
            };
        }
        catch (e) {
            logger.error("[doTabExtraction] Setup failed:", e);
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
    logger.log("[runCapturePipeline] Received capture request. url:", data.url, "| thumbnail from content.ts:", !!data.thumbnail, "(len:", data.thumbnail?.length ?? 0, ")");
    try {
        const targetUrl = data.url;
        let finalSrc = data.url;
        let capturedWebmPreviewDataUrl = "";
        if (!data.thumbnail && windowId) {
            try {
                logger.log("[runCapturePipeline] No initial thumbnail. Capturing visible tab screenshot from windowId:", windowId);
                data.thumbnail = await browser.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 20 });
                logger.log("[runCapturePipeline] captureVisibleTab succeeded. thumbnail length:", data.thumbnail?.length ?? 0);
            }
            catch (e) {
                logger.warn("[runCapturePipeline] captureVisibleTab failed:", e);
            }
        }
        else {
            logger.log("[runCapturePipeline] Thumbnail already present from content.ts (len:", data.thumbnail?.length ?? 0, "). Skipping captureVisibleTab.");
        }
        logger.log("[runCapturePipeline] Starting doTabExtraction for:", targetUrl);
        const extracted = await doTabExtraction(targetUrl, {
            originUrl: data.originUrl,
            originTitle: data.originTitle,
            originTabId: tabId,
            originWindowId: windowId
        });
        logger.log("[runCapturePipeline] doTabExtraction returned. src:", extracted?.src ?? 'null', "| scraped thumbnail length:", extracted?.metadata?.thumbnail?.length ?? 0);
        // Decision-tree type assignment:
        //   - extraction returned a media src → type='video'
        //   - no media src found (#2b3, #2c, #3 fall-through) → type='link'
        // The current page URL is still saved either way (always-save guarantee).
        if (extracted && extracted.src) {
            data.type = 'video';
        }
        else if (!data.type) {
            data.type = 'link';
        }
        if (extracted && extracted.src) {
            finalSrc = extracted.src;
            if (extracted.metadata) {
                const meta = extracted.metadata;
                if (meta.title) {
                    logger.log("[runCapturePipeline] Scraped title:", meta.title);
                    data.title = meta.title;
                }
                if (meta.author) {
                    logger.log("[runCapturePipeline] Scraped author:", meta.author);
                    data.author = meta.author;
                }
                if (meta.thumbnail?.startsWith('data:video')) {
                    logger.log("[runCapturePipeline] Scraped WebM preview present (len:", meta.thumbnail.length, "). Saving it as binary preview instead of metadata thumbnail.");
                    capturedWebmPreviewDataUrl = meta.thumbnail;
                }
                else if (meta.thumbnail) {
                    logger.log("[runCapturePipeline] Scraped thumbnail present (len:", meta.thumbnail.length, "). Replacing fallback.");
                    data.thumbnail = meta.thumbnail;
                }
                else {
                    logger.log("[runCapturePipeline] Scraped thumbnail is EMPTY. Preserving existing thumbnail.");
                }
                if (meta.duration) {
                    data.duration = meta.duration;
                }
                if (meta.views) {
                    data.views = meta.views;
                }
                if (Array.isArray(meta.tags) && meta.tags.length > 0) {
                    data.tags = meta.tags;
                }
                if (meta.likes) {
                    data.likes = meta.likes;
                }
                if (meta.date) {
                    data.date = meta.date;
                }
            }
        }
        else {
            logger.warn("[runCapturePipeline] Extraction returned no usable src. Falling back to original URL:", targetUrl);
        }
        data.rawVideoSrc = finalSrc;
        logger.log("[runCapturePipeline] Final rawVideoSrc:", data.rawVideoSrc, "| final thumbnail length:", data.thumbnail?.length ?? 0);
        const saved = await getSavedVideos(true);
        logger.log("[runCapturePipeline] Existing vault size:", saved.length);
        if (saved.some(v => v.url === data.url)) {
            logger.warn("[runCapturePipeline] Item already exists in vault. Aborting save. url:", data.url);
            return { success: false, message: "Item already in vault" };
        }
        data.timestamp = Date.now();
        if (!capturedWebmPreviewDataUrl && data.thumbnail?.startsWith('data:video')) {
            capturedWebmPreviewDataUrl = data.thumbnail;
        }
        const thumbIsWebm = Boolean(capturedWebmPreviewDataUrl);
        if (thumbIsWebm) {
            data.thumbnail = "";
        }
        saved.push(data);
        await saveVideos(saved);
        logger.log("[runCapturePipeline] Saved! New vault size:", saved.length);
        if (thumbIsWebm) {
            logger.log("[runCapturePipeline] Injected script captured WebM. Decoding and saving to IndexedDB.");
            try {
                const response = await fetch(capturedWebmPreviewDataUrl);
                const blob = await response.blob();
                try {
                    await savePreviewBlob(data.url, blob);
                    logger.log("[runCapturePipeline] Successfully saved injected WebM preview to Dexie.");
                }
                catch (e) {
                    // Vault may be locked — preview will be regenerated on next view
                    logger.warn("[runCapturePipeline] Could not save preview now (vault state):", e);
                }
            }
            catch (err) {
                logger.warn("[runCapturePipeline] Failed to save injected WebM to Dexie:", err);
            }
        }
        if (data.rawVideoSrc && !thumbIsWebm) {
            logger.log("[runCapturePipeline] Queuing background preview generation for:", data.rawVideoSrc);
            setupOffscreenDocument().then((ready) => {
                if (!ready) {
                    logger.warn("[runCapturePipeline] Preview processor unavailable; cannot generate background preview.");
                    return;
                }
                browser.runtime.sendMessage({
                    action: "generate_preview_process",
                    data: {
                        previewKey: data.url,
                        sourceUrl: data.rawVideoSrc,
                        duration: typeof data.duration === 'number' ? data.duration : 60
                    }
                }).catch((e) => {
                    logger.warn("[runCapturePipeline] generate_preview message failed:", e);
                });
            });
        }
        return { success: true, data };
    }
    catch (err) {
        logger.error("[runCapturePipeline] Unhandled error:", err);
        return { success: false, message: 'Capture pipeline failed' };
    }
}
async function setupOffscreenDocument() {
    const offscreenUrl = 'src/offscreen/processor.html';
    logger.log("[setupOffscreenDocument] Setting up offscreen document:", offscreenUrl);
    if (!browser.offscreen) {
        logger.warn("[setupOffscreenDocument] browser.offscreen API not available. Attempting iframe fallback.");
        if (typeof document !== 'undefined' && document.body) {
            let frame = document.getElementById('vault-processor-frame');
            if (!frame) {
                logger.log("[setupOffscreenDocument] Creating fallback iframe processor.");
                frame = document.createElement('iframe');
                frame.id = 'vault-processor-frame';
                frame.src = browser.runtime.getURL(offscreenUrl);
                document.body.appendChild(frame);
                await new Promise((r) => frame.onload = r);
                logger.log("[setupOffscreenDocument] Fallback iframe loaded.");
            }
            else {
                logger.log("[setupOffscreenDocument] Fallback iframe already exists.");
            }
            return true;
        }
        else {
            logger.warn("[setupOffscreenDocument] No document.body available for iframe fallback. Preview generation unavailable.");
            return false;
        }
    }
    try {
        const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [browser.runtime.getURL(offscreenUrl)] });
        if (contexts && contexts.length > 0) {
            logger.log("[setupOffscreenDocument] Offscreen document already exists. Skipping creation.");
            return true;
        }
        logger.log("[setupOffscreenDocument] Creating offscreen document...");
        await browser.offscreen.createDocument({
            url: offscreenUrl,
            reasons: ['DOM_PARSER', 'AUDIO_PLAYBACK', 'BLOBS'],
            justification: 'FFmpeg WASM processing for video previews'
        });
        logger.log("[setupOffscreenDocument] Offscreen document created.");
        return true;
    }
    catch (e) {
        logger.error("[setupOffscreenDocument] Failed to create offscreen document:", e);
        return false;
    }
}
browser.runtime.onMessage.addListener((request, sender) => {
    logger.log("[onMessage] Received action:", request.action, "| from tab:", sender?.tab?.id, "url:", sender?.tab?.url?.substring(0, 80));
    if (request.action === "extract_fresh_m3u8")
        return doTabExtraction(request.url).then((res) => ({ src: res?.src || null }));
    if (request.action === "open_dashboard") {
        openDashboard();
        return Promise.resolve(true);
    }
    if (request.action === "process_capture")
        return runCapturePipeline(request.data, sender?.tab?.id, sender?.tab?.windowId);
    if (request.action === "capture-video" || request.type === "capture-video") {
        // Mirror the keyboard-shortcut command path: forward to the sending
        // tab's content script (which holds the user's hover state).
        if (sender?.tab?.id) {
            void browser.tabs.sendMessage(sender.tab.id, { type: "capture-video" }).catch(() => { });
        }
        return Promise.resolve(true);
    }
    if (request.action === "generate_preview") {
        return setupOffscreenDocument().then(async (ready) => {
            if (!ready) {
                return { success: false, error: "Preview processor unavailable" };
            }
            return browser.runtime.sendMessage({
                action: "generate_preview_process",
                data: request.data
            });
        });
    }
    if (request.action === "generate_preview_process")
        return undefined;
    // === Vault runtime handlers ===
    // The unlocked vault state lives in this background context only.
    // Other contexts (dashboard, content, offscreen) talk to it via these
    // runtime messages. See src/lib/vault-runtime.ts.
    if (request.action === "vault.setup") {
        return runtimeSetupVault(request.pin, request.algorithm)
            .then(() => ({ success: true }))
            .catch((e) => {
            logger.error('[vault.setup] failed:', e);
            return { success: false, error: 'Vault setup failed' };
        });
    }
    if (request.action === "vault.unlock") {
        return runtimeUnlockVault(request.pin)
            .then(ok => ({ success: ok }))
            .catch((e) => {
            logger.error('[vault.unlock] failed:', e);
            return { success: false, error: 'Vault unlock failed' };
        });
    }
    if (request.action === "vault.lock") {
        runtimeLockVault();
        return Promise.resolve({ success: true });
    }
    if (request.action === "vault.status") {
        return vaultStatus().then(s => ({ success: true, ...s }));
    }
    if (request.action === "vault.destroy") {
        return destroyVault().then(() => ({ success: true }));
    }
    if (request.action === "preview.save") {
        // request: { videoUrl, blobBytes (number[]), mimeType }
        const blob = new Blob([new Uint8Array(request.blobBytes)], { type: request.mimeType || 'application/octet-stream' });
        return savePreviewBlob(request.videoUrl, blob)
            .then(() => ({ success: true }))
            .catch((e) => {
            logger.error('[preview.save] failed:', e);
            return { success: false, error: 'Preview save failed' };
        });
    }
    if (request.action === "preview.get") {
        return getPreviewBlob(request.videoUrl).then(async (blob) => {
            if (!blob)
                return { success: true, found: false };
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const arr = new Array(bytes.length);
            for(let i=0; i<bytes.length; i++) arr[i] = bytes[i];
            // Convert to a transferable plain array for runtime messaging.
            return { success: true, found: true, bytes: arr, mimeType: blob.type };
        }).catch((e) => {
            logger.error('[preview.get] failed:', e);
            return { success: false, error: 'Preview retrieval failed' };
        });
    }
    if (request.action === "preview.delete") {
        return deletePreview(request.videoUrl).then(() => ({ success: true }));
    }
    if (request.action === "preview.clear_all") {
        return dbClearPreviews().then(() => ({ success: true }));
    }
    // === end vault runtime handlers ===
    if (request.action === "download_debug_logs") {
        logger.downloadLogFile();
        return Promise.resolve(true);
    }
    if (request.action === "run_full_backup") {
        return downloadFullVaultBackup('manual')
            .then(result => result)
            .catch(err => {
            logger.error('[run_full_backup] failed:', err);
            return { success: false, error: 'Backup operation failed' };
        });
    }
    if (request.action === "get_backup_settings") {
        return getBackupSettings()
            .then(settings => ({ success: true, settings }))
            .catch(err => {
            logger.error('[get_backup_settings] failed:', err);
            return { success: false, error: 'Failed to retrieve backup settings' };
        });
    }
    if (request.action === "save_backup_settings") {
        return saveBackupSettings(request.settings)
            .then(scheduleDailyBackupAlarm)
            .then(() => ({ success: true }))
            .catch(err => {
            logger.error('[save_backup_settings] failed:', err);
            return { success: false, error: 'Failed to save backup settings' };
        });
    }
    logger.warn("[onMessage] Unknown action received:", request.action);
    return undefined;
});
browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DAILY_BACKUP_ALARM) {
        void runAutomaticBackup();
    }
});
browser.runtime.onInstalled.addListener(() => {
    void scheduleDailyBackupAlarm();
});
browser.runtime.onStartup.addListener(() => {
    void scheduleDailyBackupAlarm();
});
void scheduleDailyBackupAlarm();
browser.action.onClicked.addListener(() => {
    logger.log("[action.onClicked] Extension icon clicked. Opening dashboard.");
    openDashboard();
});
browser.commands.onCommand.addListener(async (command) => {
    logger.log("[commands.onCommand] Command received:", command);
    if (command === "_execute_action" || command === "open-dashboard") {
        openDashboard();
    }
    else if (command === "capture-video") {
        try {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            const activeTab = tabs[0];
            logger.log("[commands.onCommand] capture-video. Active tab:", activeTab?.id, "url:", activeTab?.url?.substring(0, 80));
            if (!activeTab?.id || !activeTab.url || activeTab.url.startsWith('chrome:')) {
                logger.warn("[commands.onCommand] Cannot capture - no valid active tab.");
                return;
            }
            try {
                await browser.tabs.sendMessage(activeTab.id, { type: "capture-video" });
                logger.log("[commands.onCommand] Sent capture-video to content script.");
            }
            catch (error) {
                logger.warn("[commands.onCommand] Content script not available on tab. Showing alert.", error);
                try {
                    await browser.scripting.executeScript({
                        target: { tabId: activeTab.id },
                        func: () => alert("[Vault Central] Extension script is not active on this page. Please refresh.")
                    });
                }
                catch (e) {
                    logger.error("[commands.onCommand] executeScript for alert also failed:", e);
                }
            }
        }
        catch (error) {
            logger.error("[commands.onCommand] Unexpected error handling capture-video command:", error);
        }
    }
});
