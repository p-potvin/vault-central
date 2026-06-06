/**
 * processor.ts — Offscreen document that orchestrates FFmpeg preview generation.
 *
 * FFmpeg's @ffmpeg/core is compiled with Emscripten and uses new Function() in
 * its JS glue code.  Chrome MV3 forbids 'unsafe-eval' in extension_pages CSP,
 * so we cannot run FFmpeg directly here.
 *
 * Solution: we load a sandboxed extension page (sandbox.html) as a hidden iframe.
 * Sandboxed pages are exempt from the extension's CSP — they can freely use
 * new Function() / eval().  We communicate with the sandbox exclusively via
 * window.postMessage, passing data as transferable ArrayBuffers.
 *
 * Protocol (→ sandbox, ← sandbox):
 *   → { type:'vc_init',    id, jsBytes, wasmBytes }  (clone, not transfer)
 *   ← { type:'vc_sandbox_result', id, bytes:null }   (FFmpeg ready)
 *   → { type:'vc_process', id, videoBytes, duration } (transfer videoBytes)
 *   ← { type:'vc_sandbox_result', id, bytes }        (transfer result)
 *   ← { type:'vc_sandbox_result', id, error }        (on failure)
 */
import browser from 'webextension-polyfill';
import { savePreview } from '../lib/vault-client';
let _sandboxIframe = null;
let _sandboxReady = false;
let _initPromise = null;
const _pending = new Map();
window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'vc_sandbox_result')
        return;
    const entry = _pending.get(msg.id);
    if (!entry)
        return;
    _pending.delete(msg.id);
    if (msg.error)
        entry.reject(new Error(msg.error));
    else
        entry.resolve(msg.bytes ?? null);
});
function createSandboxIframe() {
    return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.src = browser.runtime.getURL('src/offscreen/sandbox.html');
        iframe.style.cssText = 'position:absolute;width:0;height:0;border:0';
        document.body.appendChild(iframe);
        iframe.addEventListener('load', () => {
            _sandboxIframe = iframe;
            resolve(iframe);
        }, { once: true });
    });
}
async function initSandbox() {
    const iframe = await createSandboxIframe();
    await new Promise((resolve, reject) => {
        const id = '_init_' + Date.now();
        const timeoutId = setTimeout(() => {
            _pending.delete(id);
            reject(new Error('[VaultProcessor] Sandbox init timed out'));
        }, 60_000);
        _pending.set(id, {
            resolve: () => { clearTimeout(timeoutId); _sandboxReady = true; resolve(); },
            reject: (e) => { clearTimeout(timeoutId); reject(e); },
        });
        console.log("[VaultProcessor] Sending vc_init to sandbox iframe...");
        iframe.contentWindow.postMessage({
            type: 'vc_init',
            id,
            coreURL: browser.runtime.getURL('ffmpeg-core/ffmpeg-core.js'),
            wasmURL: browser.runtime.getURL('ffmpeg-core/ffmpeg-core.wasm'),
            workerURL: browser.runtime.getURL('ffmpeg-core/ffmpeg-worker.js'),
        }, '*');
    });
}
/**
 * Returns a ready sandbox iframe, initialising it exactly once even under
 * concurrent callers.
 */
async function ensureSandbox() {
    if (_sandboxReady && _sandboxIframe && document.body.contains(_sandboxIframe)) {
        return _sandboxIframe;
    }
    // Reset ready flag if iframe disappeared (e.g., offscreen doc recycled).
    _sandboxReady = false;
    if (!_initPromise) {
        _initPromise = initSandbox().catch((e) => {
            // Allow retry on next call.
            _initPromise = null;
            throw e;
        });
    }
    await _initPromise;
    return _sandboxIframe;
}
// ────────────────────────────────────────────────────────────
// Video processing
// ────────────────────────────────────────────────────────────
async function processVideoPreviewFFmpeg(mediaUrl, duration) {
    console.log("[VaultProcessor] Starting FFmpeg sandbox preview generation for:", mediaUrl);
    if (mediaUrl.includes('.m3u8') || mediaUrl.includes('manifest')) {
        console.warn("[VaultProcessor] HLS/M3U8 is not supported natively.");
        return null;
    }
    try {
        const iframe = await ensureSandbox();
        console.log("[VaultProcessor] Fetching video bytes for sandbox...");
        const response = await fetch(mediaUrl, {
            headers: { "User-Agent": navigator.userAgent }
        });
        if (!response.ok) {
            console.error("[VaultProcessor] Fetch failed:", response.status);
            return null;
        }
        const videoBuffer = await response.arrayBuffer();
        console.log("[VaultProcessor] Fetched bytes:", videoBuffer.byteLength);
        if (videoBuffer.byteLength < 1000) {
            console.error("[VaultProcessor] Fetched video is too small (403 block?).");
            return null;
        }
        return new Promise((resolve) => {
            const id = 'proc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const timeoutId = setTimeout(() => {
                _pending.delete(id);
                console.error("[VaultProcessor] FFmpeg sandbox process timed out");
                resolve(null);
            }, 180_000); // 3 minutes timeout for heavy transcoding
            _pending.set(id, {
                resolve: (bytes) => {
                    clearTimeout(timeoutId);
                    if (bytes) {
                        resolve(new Blob([bytes], { type: 'video/webm' }));
                    }
                    else {
                        resolve(null);
                    }
                },
                reject: (err) => {
                    clearTimeout(timeoutId);
                    console.error("[VaultProcessor] Sandbox run rejected:", err);
                    resolve(null);
                }
            });
            console.log("[VaultProcessor] Sending vc_process to sandbox iframe. id:", id);
            iframe.contentWindow.postMessage({ type: 'vc_process', id, videoBytes: videoBuffer, duration }, '*', [videoBuffer] // Transfer the ArrayBuffer to avoid copying!
            );
        });
    }
    catch (e) {
        console.error("[VaultProcessor] Sandbox preview generation failed:", e);
        return null;
    }
}
async function processVideoPreview(mediaUrl, duration) {
    console.log("[VaultProcessor] Starting native WebP frame preview generation for:", mediaUrl);
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.src = mediaUrl;
        const canvas = document.createElement('canvas');
        canvas.width = 426;
        canvas.height = 240;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error("[VaultProcessor] Canvas 2d context not available");
            return resolve(null);
        }
        let isResolved = false;
        let timeoutId = null;
        const cleanup = () => {
            if (timeoutId)
                clearTimeout(timeoutId);
            video.pause();
            video.src = '';
            video.load();
        };
        const finish = (blob) => {
            if (isResolved)
                return;
            isResolved = true;
            cleanup();
            resolve(blob);
        };
        // 3-minute hard timeout
        timeoutId = setTimeout(() => {
            console.error("[VaultProcessor] Preview generation timed out");
            finish(null);
        }, 180000);
        video.addEventListener('error', (e) => {
            console.error("[VaultProcessor] Video element encountered error:", video.error);
            finish(null);
        });
        video.addEventListener('loadedmetadata', async () => {
            try {
                const vidDuration = (video.duration && !isNaN(video.duration) && video.duration > 0) ? video.duration : duration;
                const startOffset = vidDuration * 0.1;
                const endOffset = vidDuration * 0.9;
                const segmentLength = (endOffset - startOffset) / 9;
                // Play briefly to make sure rendering frames is initialized
                await video.play().catch(() => { });
                video.pause();
                const frames = [];
                for (let i = 0; i < 10; i++) {
                    const targetTime = startOffset + (i * segmentLength);
                    video.currentTime = targetTime;
                    await new Promise(r => {
                        let seekDone = false;
                        let seekTimeout = null;
                        const done = () => {
                            if (seekDone)
                                return;
                            seekDone = true;
                            video.removeEventListener('seeked', onSeeked);
                            if (seekTimeout)
                                clearTimeout(seekTimeout);
                            r(null);
                        };
                        const onSeeked = () => { done(); };
                        video.addEventListener('seeked', onSeeked);
                        seekTimeout = setTimeout(done, 2000); // 2s timeout per seek
                    });
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    // Simple check if canvas center pixel throws security error (CORS block)
                    try {
                        ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1);
                        const frameData = canvas.toDataURL('image/webp', 0.5);
                        frames.push(frameData);
                    }
                    catch (err) {
                        console.warn("[VaultProcessor] Canvas tainted, CORS block on video source:", err);
                        return finish(null); // Tainted canvas -> return null to fallback
                    }
                }
                if (frames.length === 0) {
                    return finish(null);
                }
                // Verify the center pixel has color content
                let hasContent = false;
                try {
                    const sample = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
                    if (sample[0] > 8 || sample[1] > 8 || sample[2] > 8) {
                        hasContent = true;
                    }
                }
                catch { }
                if (!hasContent) {
                    console.warn("[VaultProcessor] Frames are entirely black/empty.");
                    return finish(null);
                }
                const payload = {
                    isFrames: true,
                    frames: frames
                };
                const jsonStr = JSON.stringify(payload);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                console.log("[VaultProcessor] Successfully generated JSON frames preview. Size:", blob.size, "bytes");
                finish(blob);
            }
            catch (err) {
                console.error("[VaultProcessor] Error extracting frames:", err);
                finish(null);
            }
        });
    });
}
// ────────────────────────────────────────────────────────────
// Runtime message handler (called by background.ts)
// ────────────────────────────────────────────────────────────
browser.runtime.onMessage.addListener((message) => {
    if (message.action !== 'generate_preview_process')
        return undefined;
    return handleGeneratePreviewProcess(message);
});
async function handleGeneratePreviewProcess(message) {
    const { previewKey, sourceUrl, url, duration } = message.data;
    const mediaUrl = sourceUrl || url;
    const storageKey = previewKey || url || sourceUrl;
    if (!mediaUrl || !storageKey) {
        return { success: false, error: 'Missing preview source URL or storage key' };
    }
    try {
        const blob = await processVideoPreview(mediaUrl, typeof duration === 'number' ? duration : 60);
        if (blob) {
            await savePreview(storageKey, blob);
            return { success: true };
        }
        return { success: false, error: 'Preview generation returned no blob' };
    }
    catch (err) {
        console.error('[VaultProcessor] Preview generation failed:', err);
        return { success: false, error: 'Preview generation failed' };
    }
}
