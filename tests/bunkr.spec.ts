import { test, expect } from './extension.fixture';

test.describe('Bunkr Video Capture', () => {
    test('should capture video source from bunkr', async ({ page, extensionId, context }) => {
        console.log('Navigating to bunkr.cr/a/ANmmWTVZ...');
        await page.goto('https://bunkr.cr/a/ANmmWTVZ', { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await page.waitForTimeout(2000);

        console.log("Locating an album item...");
        const firstItem = page.locator('a[href*="/f/"]').first();
        try {
            await firstItem.waitFor({ state: 'attached', timeout: 20000 });
            const href = await firstItem.getAttribute('href');
            console.log("Navigating to item URL:", href);
            if (href) {
                // Determine absolute URL
                const absoluteUrl = href.startsWith('http') ? href : new URL(href, page.url()).toString();
                await page.goto(absoluteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(3000);
            }
        } catch (e) {
            console.log("Failed to find or navigate to an item:", e);
        }

        console.log("Current URL after click:", page.url());
        
        const video = page.locator('video').first();
        const hasVideo = await video.isVisible().catch(() => false);
        
        console.log("Hovering over video?", hasVideo);
        if (hasVideo) {
            await video.hover({ force: true });
        } else {
            await page.mouse.move(500, 500);
        }

        console.log('Simulating Alt+X keyboard shortcut...');
        await page.keyboard.press('Alt+X');

        // Look for the vault ui notification showing success or failure
        try {
            const notification = page.locator('.vault-notification').first();
            await notification.waitFor({ state: 'visible', timeout: 10000 });
            console.log("Notification text:", await notification.textContent());
        } catch(e) {
            console.log("No UI notification seen.");
        }

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

        expect(savedUrl).not.toEqual('https://bunkr.cr/a/ANmmWTVZ');
        expect(savedUrl).toMatch(/\.(mp4|m3u8|webm)/i);
    });
});
