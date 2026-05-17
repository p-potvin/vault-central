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
let _ffmpegCoreBytes = null;
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
    // Fetch FFmpeg core files (only once per offscreen document lifetime).
    if (!_ffmpegCoreBytes) {
        const [js, wasm] = await Promise.all([
            fetch(browser.runtime.getURL('ffmpeg-core/ffmpeg-core.js')).then(r => r.arrayBuffer()),
            fetch(browser.runtime.getURL('ffmpeg-core/ffmpeg-core.wasm')).then(r => r.arrayBuffer()),
        ]);
        _ffmpegCoreBytes = { js, wasm };
    }
    // Send init message.  Do NOT transfer the buffers — processor must keep
    // its copy so it can re-initialize a new sandbox if the iframe is torn down.
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
        iframe.contentWindow.postMessage({ type: 'vc_init', id, jsBytes: _ffmpegCoreBytes.js, wasmBytes: _ffmpegCoreBytes.wasm }, '*');
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
async function processVideoPreview(mediaUrl, duration) {
    console.log("[VaultProcessor] Starting preview generation for:", mediaUrl);
    if (mediaUrl.includes('.m3u8') || mediaUrl.includes('manifest')) {
        console.warn("[VaultProcessor] HLS/M3U8 is not supported natively.");
        return null;
    }
    try {
        console.log("[VaultProcessor] Fetching video...");
        const response = await fetch(mediaUrl, {
            headers: { "User-Agent": navigator.userAgent }
        });
        if (!response.ok) {
            console.error("[VaultProcessor] Fetch failed:", response.status);
            return null;
        }
        const videoBlob = await response.blob();
        console.log("[VaultProcessor] Fetched bytes:", videoBlob.size, "type:", videoBlob.type);
        if (videoBlob.size < 1000) {
            console.error("[VaultProcessor] Fetched blob is too small (403 block?).");
            return null;
        }
        const objectUrl = URL.createObjectURL(videoBlob);
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
                console.error("[VaultProcessor] Native preview generation timed out");
                reject(new Error('[VaultProcessor] Native preview generation timed out'));
            }, 120_000);
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.src = objectUrl;
            video.addEventListener('loadedmetadata', async () => {
                console.log("[VaultProcessor] loadedmetadata fired, duration:", video.duration);
                const canvas = document.createElement('canvas');
                canvas.width = 426; // 240p
                canvas.height = 240;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    clearTimeout(timeoutId);
                    URL.revokeObjectURL(objectUrl);
                    if (video.parentNode)
                        video.parentNode.removeChild(video);
                    return resolve(null);
                }
                try {
                    let start = (video.duration && isFinite(video.duration)) ? video.duration * 0.1 : 0;
                    if (start > 120)
                        start = Math.min(start, 30);
                    video.currentTime = start;
                    const stream = canvas.captureStream(10);
                    let recorder;
                    try {
                        recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
                    }
                    catch (e) {
                        recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
                    }
                    const chunks = [];
                    recorder.ondataavailable = e => { if (e.data.size > 0)
                        chunks.push(e.data); };
                    recorder.onstop = () => {
                        clearTimeout(timeoutId);
                        stream.getTracks().forEach(t => t.stop());
                        if (video.parentNode)
                            video.parentNode.removeChild(video);
                        URL.revokeObjectURL(objectUrl);
                        if (chunks.length > 0) {
                            console.log("[VaultProcessor] Output generated:", chunks.reduce((acc, c) => acc + c.size, 0), "bytes");
                            resolve(new Blob(chunks, { type: 'video/webm' }));
                        }
                        else {
                            console.error("[VaultProcessor] No chunks from MediaRecorder");
                            resolve(null);
                        }
                    };
                    recorder.start(1000);
                    // Step through frames manually to avoid autoplay blocks completely
                    const frameCount = 30; // 3 seconds at 10 fps
                    const step = 0.1; // 100ms
                    for (let i = 0; i < frameCount; i++) {
                        await new Promise(r => {
                            video.addEventListener('seeked', r, { once: true });
                            setTimeout(r, 1000);
                        });
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        if (i < frameCount - 1) {
                            video.currentTime += step;
                            await new Promise(r => setTimeout(r, 100)); // allow interval encoding
                        }
                    }
                    recorder.stop();
                }
                catch (e) {
                    console.error("[VaultProcessor] Processing loop failed:", e);
                    clearTimeout(timeoutId);
                    URL.revokeObjectURL(objectUrl);
                    if (video.parentNode)
                        video.parentNode.removeChild(video);
                    resolve(null);
                }
            });
            video.addEventListener('error', (e) => {
                console.error("[VaultProcessor] Video load error for native processing", video.error);
                clearTimeout(timeoutId);
                URL.revokeObjectURL(objectUrl);
                if (video.parentNode)
                    video.parentNode.removeChild(video);
                resolve(null);
            });
            // Do not append to body. video.load() without appending causes no autoplay constraints
            video.load();
        });
    }
    catch (e) {
        console.error("[VaultProcessor] Fallback processor failed during fetch:", e);
        return null;
    }
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
