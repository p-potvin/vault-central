/**
 * scraper-player.ts — the page loaded when a captured URL is already a media file.
 *
 * Only used where the background has no DOM to do this itself (Chrome MV3
 * service workers). On Firefox the background calls extractDirectVideo directly
 * and this page never opens, which is what makes those refreshes invisible.
 *
 * The extraction logic lives in src/lib/direct-video-extract.ts so both paths
 * produce byte-identical results.
 */
import browser from 'webextension-polyfill';
import { extractDirectVideo } from '../lib/direct-video-extract';

async function run() {
    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('src');
    const originTitle = params.get('originTitle') || 'Captured Media';

    if (!videoUrl) {
        console.error("[ScraperPlayer] No video URL provided to scraper-player");
        return;
    }

    console.log("[ScraperPlayer] Loading video via blob fetch:", videoUrl);
    const video = document.querySelector('#player') as HTMLVideoElement;

    try {
        const result = await extractDirectVideo(videoUrl, originTitle, video);
        console.log("[ScraperPlayer] Preview generated, payload size:", result.metadata.thumbnail.length);
        await browser.runtime.sendMessage({ action: 'scraper_result', success: true, result });
    } catch (err: any) {
        console.error("[ScraperPlayer] Failed:", err);
        await browser.runtime.sendMessage({
            action: 'scraper_result',
            success: false,
            error: err?.message || 'Unknown error',
        });
    }
}

run();
