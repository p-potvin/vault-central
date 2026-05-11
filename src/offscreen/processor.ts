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

// ────────────────────────────────────────────────────────────
// Sandbox iframe management
// ────────────────────────────────────────────────────────────

type PendingEntry = { resolve: (v: any) => void; reject: (e: any) => void };

let _sandboxIframe: HTMLIFrameElement | null = null;
let _ffmpegCoreBytes: { js: ArrayBuffer; wasm: ArrayBuffer } | null = null;
let _sandboxReady = false;
let _initPromise: Promise<void> | null = null;
const _pending = new Map<string, PendingEntry>();

window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'vc_sandbox_result') return;
    const entry = _pending.get(msg.id);
    if (!entry) return;
    _pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error));
    else entry.resolve(msg.bytes ?? null);
});

function createSandboxIframe(): Promise<HTMLIFrameElement> {
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

async function initSandbox(): Promise<void> {
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
    await new Promise<void>((resolve, reject) => {
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
        iframe.contentWindow!.postMessage(
            { type: 'vc_init', id, jsBytes: _ffmpegCoreBytes!.js, wasmBytes: _ffmpegCoreBytes!.wasm },
            '*',
        );
    });
}

/**
 * Returns a ready sandbox iframe, initialising it exactly once even under
 * concurrent callers.
 */
async function ensureSandbox(): Promise<HTMLIFrameElement> {
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
    return _sandboxIframe!;
}

// ────────────────────────────────────────────────────────────
// Video processing
// ────────────────────────────────────────────────────────────

async function processVideoPreview(mediaUrl: string, duration: number): Promise<Blob | null> {
    console.log("[VaultProcessor] Fetching video bypassing CORS via host_permissions:", mediaUrl);
    
    // For M3U8, native video element won't play it directly (unless Safari). 
    // Fall back or return null to not hang.
    if (mediaUrl.includes('.m3u8') || mediaUrl.includes('manifest')) {
        console.warn("[VaultProcessor] HLS/M3U8 is not supported for MediaRecorder offscreen generation.");
        return null;
    }

    try {
        const response = await fetch(mediaUrl);
        const videoBlob = await response.blob();
        if (videoBlob.size === 0) return null;
        
        const objectUrl = URL.createObjectURL(videoBlob);
        console.log("[VaultProcessor] Generating preview natively offscreen...", videoBlob.size, "bytes");

        return new Promise<Blob | null>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('[VaultProcessor] Native preview generation timed out'));
            }, 120_000); // 2 mins max

            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.src = objectUrl;

            video.addEventListener('loadedmetadata', async () => {
                const canvas = document.createElement('canvas');
                canvas.width = 426;  // 240p
                canvas.height = 240;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    clearTimeout(timeoutId);
                    URL.revokeObjectURL(objectUrl);
                    if (video.parentNode) video.parentNode.removeChild(video);
                    return resolve(null);
                }

                try {
                    let start = (video.duration && isFinite(video.duration)) ? video.duration * 0.1 : 0;
                    if (start > 120) start = Math.min(start, 30);
                    video.currentTime = start;
                    
                    // Actually play the video off-screen
                    await video.play();

                    const stream = canvas.captureStream(24);
                    let recorder: MediaRecorder;
                    try {
                        recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
                    } catch (e) {
                        recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
                    }

                    const chunks: Blob[] = [];
                    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
                    
                    let drawInterval: any;
                    recorder.onstop = () => {
                        clearTimeout(timeoutId);
                        clearInterval(drawInterval);
                        stream.getTracks().forEach(t => t.stop());
                        video.pause();
                        if (video.parentNode) video.parentNode.removeChild(video);
                        URL.revokeObjectURL(objectUrl);
                        if (chunks.length > 0) {
                            resolve(new Blob(chunks, { type: 'video/webm' }));
                        } else {
                            resolve(null);
                        }
                    };

                    drawInterval = setInterval(() => {
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    }, 1000 / 24);

                    recorder.start();

                    // Record 3 real-time seconds of the video
                    setTimeout(() => {
                        if (recorder.state === 'recording') recorder.stop();
                    }, 3000);

                } catch (e) {
                    console.error("[VaultProcessor] MediaRecorder or playback failed:", e);
                    clearTimeout(timeoutId);
                    URL.revokeObjectURL(objectUrl);
                    if (video.parentNode) video.parentNode.removeChild(video);
                    resolve(null);
                }
            });

            video.addEventListener('error', () => {
                console.error("[VaultProcessor] Video load error for native processing");
                clearTimeout(timeoutId);
                URL.revokeObjectURL(objectUrl);
                if (video.parentNode) video.parentNode.removeChild(video);
                resolve(null);
            });
            
            // Append securely and hidden to trigger real playback in Firefox
            video.style.cssText = 'position:fixed;top:-9999px;opacity:0';
            document.body.appendChild(video);
            video.load();
        });
    } catch (e) {
        console.error("[VaultProcessor] Fallback processor failed during fetch:", e);
        return null;
    }
}

// ────────────────────────────────────────────────────────────
// Runtime message handler (called by background.ts)
// ────────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((message: any) => {
    if (message.action !== 'generate_preview_process') return undefined;
    return handleGeneratePreviewProcess(message);
});

async function handleGeneratePreviewProcess(message: any) {
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
    } catch (err: any) {
        console.error('[VaultProcessor] Preview generation failed:', err);
        return { success: false, error: 'Preview generation failed' };
    }
}
