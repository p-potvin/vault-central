/**
 * processor.ts — Offscreen document that generates video previews.
 *
 * A preview is 10 WebP stills sampled across the video (10%–90% of its
 * duration) and stored as a single JSON payload; PreviewThumb flips through
 * them on hover. Everything runs on a plain <video> + <canvas> here in the
 * offscreen document — no WASM, no sandboxed page.
 *
 * This used to drive FFmpeg WASM inside a sandboxed extension page (needed
 * because Emscripten's glue code calls new Function(), which MV3's
 * extension_pages CSP forbids). That path was replaced by native canvas
 * capture and left behind as dead code carrying a 30 MB ffmpeg-core.wasm;
 * it was removed on Sun, 02 Aug 2026. Restoring it means bringing back
 * sandbox.ts, the sandbox manifest entry, and the ffmpeg-core copy target.
 */

import browser from 'webextension-polyfill';
import { savePreview } from '../lib/vault-client';
import Hls from 'hls.js';

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
