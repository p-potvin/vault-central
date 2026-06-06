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
import Hls from 'hls.js';

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
    console.log("[VaultProcessor] Starting preview generation for:", mediaUrl);
    
    const isHls = mediaUrl.includes('.m3u8') || mediaUrl.includes('manifest');

    try {
        let objectUrl = '';
        if (!isHls) {
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
            
            objectUrl = URL.createObjectURL(videoBlob);
        }
        
        return new Promise<Blob | null>((resolve) => {
            const timeoutId = setTimeout(() => {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                if (hls) hls.destroy();
                console.error("[VaultProcessor] Native preview generation timed out");
                resolve(null);
            }, 60_000);

            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;

            let hls: Hls | null = null;
            if (isHls) {
                if (Hls.isSupported()) {
                    hls = new Hls({
                        enableWorker: false,
                        maxBufferLength: 10,
                        maxMaxBufferLength: 20
                    });
                    hls.loadSource(mediaUrl);
                    hls.attachMedia(video);
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = mediaUrl;
                } else {
                    console.error("[VaultProcessor] HLS not supported");
                    clearTimeout(timeoutId);
                    return resolve(null);
                }
            } else {
                video.src = objectUrl;
            }

            video.addEventListener('loadedmetadata', async () => {
                console.log("[VaultProcessor] loadedmetadata fired, duration:", video.duration);
                const canvas = document.createElement('canvas');
                canvas.width = 426;  // 240p
                canvas.height = 240;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    clearTimeout(timeoutId);
                    if (objectUrl) URL.revokeObjectURL(objectUrl);
                    if (hls) hls.destroy();
                    return resolve(null);
                }

                try {
                    const videoDuration = (video.duration && isFinite(video.duration)) ? video.duration : 60;
                    const startOffset = videoDuration * 0.1;
                    const endOffset = videoDuration * 0.9;
                    const segmentLength = (endOffset - startOffset) / 9;

                    await video.play().catch(() => {});
                    video.pause();

                    const frames: string[] = [];
                    for (let i = 0; i < 10; i++) {
                        video.currentTime = startOffset + (i * segmentLength);
                        
                        await new Promise(r => {
                            let finished = false;
                            const done = () => {
                                if (finished) return;
                                finished = true;
                                video.removeEventListener('seeked', seeked);
                                r(null);
                            };
                            const seeked = () => done();
                            video.addEventListener('seeked', seeked);
                            setTimeout(done, 1500);
                        });

                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        try {
                            ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1);
                            const dataUrl = canvas.toDataURL('image/webp', 0.5);
                            frames.push(dataUrl);
                        } catch (err) {
                            console.warn("[VaultProcessor] Canvas tainted, CORS block on video source.");
                        }
                    }

                    clearTimeout(timeoutId);
                    if (objectUrl) URL.revokeObjectURL(objectUrl);
                    if (hls) hls.destroy();

                    if (frames.length > 0) {
                        const payload = {
                            isFrames: true,
                            frames: frames
                        };
                        const jsonBlob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
                        console.log("[VaultProcessor] WebP frames preview generated:", jsonBlob.size, "bytes");
                        resolve(jsonBlob);
                    } else {
                        console.error("[VaultProcessor] No frames captured");
                        resolve(null);
                    }
                } catch (e) {
                    console.error("[VaultProcessor] Processing loop failed:", e);
                    clearTimeout(timeoutId);
                    if (objectUrl) URL.revokeObjectURL(objectUrl);
                    if (hls) hls.destroy();
                    resolve(null);
                }
            });

            video.addEventListener('error', (e) => {
                console.error("[VaultProcessor] Video load error for native processing", video.error);
                clearTimeout(timeoutId);
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                if (hls) hls.destroy();
                resolve(null);
            });
            
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
