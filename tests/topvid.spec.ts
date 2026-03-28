import { test, expect } from './extension.fixture';

test.describe('Topvid Video Capture', () => {
    test.setTimeout(90000);
    test('should capture m3u8 source from topvid', async ({ page, extensionId, context }) => {
        console.log('Navigating directly to a video page on topvid.tv...');
        await page.goto('https://topvid.tv/f/v5Mv5D', { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await page.waitForTimeout(2000);

        console.log("Looking for player / clicking to trigger JWPlayer...");
        // Many video players need you to click to load the actual iframe or trigger the video
        // Try clicking around center, or specifically looking for jwplayer/video
        const iframe = page.locator('iframe').first();
        if (await iframe.isVisible().catch(() => false)) {
            console.log("Found an iframe. Video could be embedded here.");
        }
        
        // Let's just click on anything that looks like a play button or video to trigger it.
        const playButtonOrVideo = page.locator('video, .jwplayer, .play-button, .vjs-big-play-button').first();
        if (await playButtonOrVideo.isVisible().catch(() => false)) {
            console.log("Found player element, clicking it...");
            await playButtonOrVideo.click();
            await page.waitForTimeout(3000);
        } else {
            console.log("Clicking center of screen to see if player triggers...");
            await page.mouse.click(500, 400);
            await page.waitForTimeout(3000);
        }

        const video = page.locator('video').first();
        const hasVideo = await video.isVisible().catch(() => false);
        
        console.log("Hovering over video?", hasVideo);
        if (hasVideo) {
            // hover is problematic since it might hit overlays.
            await video.hover({ force: true });
        } else {
            await page.mouse.move(500, 400); // Hover near center
        }

        console.log('Simulating Alt+X keyboard shortcut...');
        await page.keyboard.press('Alt+X');

        // Check extension storage
        let savedUrl = '';
        
        // Open the extension's background context or dashboard to have extension privileges to read storage
        const extPage = await context.newPage();
        await extPage.goto(`chrome-extension://${extensionId}/pin-entry.html`);

        for (let i = 0; i < 15; i++) {
            const storageData = await extPage.evaluate(async () => {
                return new Promise<any[]>((resolve) => {
                    // @ts-ignore
                    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                        // @ts-ignore
                        chrome.storage.local.get('savedVideos', (data: any) => resolve(data.savedVideos || []));
                    } else { resolve([]); }
                });
            }) as any[];

            if (storageData.length > 0) {
                const latest = storageData[storageData.length - 1];
                console.log(`Found item in extension storage. Saved URL: ${latest.url}`);
                savedUrl = latest.url;
                break;
            }
            
            await page.waitForTimeout(1000);
        }

        await extPage.close();

        // Should not be the topvid url itself
        expect(savedUrl).not.toContain('topvid.tv'); 
        // Expect an m3u8 or mp4
        expect(savedUrl).toMatch(/\.(mp4|m3u8|webm)/i);
    });
});
