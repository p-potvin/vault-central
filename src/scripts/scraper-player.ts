import browser from 'webextension-polyfill';
import { captureFrames } from '../lib/frame-capture';

/** Matches the offscreen processor: fewer than this and the capture stalled. */
const MIN_USABLE_FRAMES = 4;
async function run() {
    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('src');
    const originTitle = params.get('originTitle') || 'Captured Media';
    if (!videoUrl) {
        console.error("[ScraperPlayer] No video URL provided to scraper-player");
        return;
    }
    console.log("[ScraperPlayer] Loading video via blob fetch: ", videoUrl);
    const video = document.querySelector('#player') as HTMLVideoElement;
    try {
        // Fetch as blob to bypass CORS and prevent canvas tainting
        const response = await fetch(videoUrl);
        if (!response.ok)
            throw new Error(`Fetch failed: ${response.status}`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        video.src = blobUrl;
        // Wait for metadata
        await new Promise((resolve, reject) => {
            video.onloadedmetadata = () => resolve(null);
            video.onerror = () => reject(new Error("Video load error"));
        });
        const duration = (video.duration && !isNaN(video.duration) && video.duration > 0) ? video.duration : 60;
        console.log("[ScraperPlayer] Video loaded. Duration: ", duration);

        // Shared with the offscreen processor. The loop that used to live here
        // abandoned each seek after 1500ms and then immediately issued the next
        // one, which supersedes the pending seek — so on a slow source the element
        // never settled (a 34-minute video that never got past ~2 minutes) and all
        // but one or two frames were captured from a stale or empty decoder.
        const capture = await captureFrames(video, { frameCount: 10 });
        console.log(
            `[ScraperPlayer] Capture: ${capture.frames.length}/${capture.attempted} usable` +
            ` (${capture.timedOut} seek timeouts, ${capture.blank} blank, ${capture.tainted} tainted)`
        );

        URL.revokeObjectURL(blobUrl);

        if (capture.frames.length < MIN_USABLE_FRAMES) {
            throw new Error(
                `Only ${capture.frames.length} usable frames captured (need ${MIN_USABLE_FRAMES}); refusing to store a broken preview`
            );
        }

        const frames = capture.frames;
        const payload = {
            isFrames: true,
            frames: frames
        };

        /* The btoa(unescape(encodeURIComponent(...))) pattern is a deprecated and  unsafe way to handle UTF-8 strings.
        A modern approach is to use TextEncoder to get a Uint8Array, then encode that.*/
        const jsonString = JSON.stringify(payload);
        const jsonBytes = new TextEncoder().encode(jsonString);
        const binaryString = Array.from(jsonBytes, byte => String.fromCharCode(byte)).join('');
        const base64Payload = btoa(binaryString);
        const framesDataUrl = `data:application/json;base64,${base64Payload}`;

        console.log(`[ScraperPlayer] WebP frames preview generated, size: ${framesDataUrl.length}`);
        const result = {
            src: videoUrl,
            metadata: {
                title: originTitle,
                thumbnail: framesDataUrl,
                duration: duration,
                author: new URL(videoUrl).hostname || 'Direct Link',
                views: "",
                tags: [],
                likes: "",
                date: new Date().toISOString()
            }
        };
        await browser.runtime.sendMessage({
            action: 'scraper_result',
            success: true,
            result
        });
    }
    catch (err: any) {
        console.error("[ScraperPlayer] Failed:", err);
        await browser.runtime.sendMessage({
            action: 'scraper_result',
            success: false,
            error: err.message || 'Unknown error'
        });
    }
}
run();
