import { test, expect } from './extension.fixture';

test.describe('WebM Preview Generation', () => {
  test('should generate a webm preview for a captured video in Chromium', async ({ page, context, extensionBaseUrl }) => {
    // FFmpeg WASM can be slow
    test.setTimeout(90000);

    // This test requires a real browser environment.
    // if (test.info().project.name !== 'chromium') {
    //   test.skip();
    // }

    const videoUrl = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';
    
    // 1. Open Dashboard
    console.log('Opening dashboard...');
    await page.goto(`${extensionBaseUrl}/dashboard-v2.html`);
    await page.waitForLoadState('networkidle');

    // 2. Trigger capture via sendMessage (works because dashboard is an extension page)
    console.log('Triggering capture from dashboard...');
    const captureResult = await page.evaluate(async (url) => {
      return await chrome.runtime.sendMessage({
        action: 'process_capture',
        data: {
          url: url,
          title: 'Test Video',
          thumbnail: '',
          duration: 10
        }
      });
    }, videoUrl);

    console.log('Capture response:', captureResult);
    expect(captureResult.success).toBe(true);

    // 3. Wait for the item to appear in the vault
    console.log('Waiting for item to appear in storage...');
    await expect.poll(async () => {
      const storage = await page.evaluate(() => chrome.storage.local.get('savedVideos') as Promise<{ savedVideos?: any[] }>);
      return (storage.savedVideos || []).length;
    }, { timeout: 10000 }).toBe(1);

    // 4. Now wait for the preview to be generated in Dexie
    console.log('Checking Dexie for preview blob...');
    // Preview generation might take some time (FFmpeg WASM)
    await expect.poll(async () => {
        return await page.evaluate(async (key) => {
            // @ts-ignore - db is global in dashboard
            const db = (window as any).db;
            if (!db) return false;
            const preview = await db.previews.get(key);
            return !!preview?.blob;
          }, videoUrl);
    }, {
        message: 'Wait for WebM preview blob to appear in Dexie',
        timeout: 60000, 
        intervals: [2000, 5000]
    }).toBe(true);

    console.log('WebM preview generation confirmed!');
  });
});
