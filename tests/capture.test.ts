import { test, expect } from './extension.fixture';
import { injectFirefoxContentScript, openFirefoxMockPage, readSavedVideos } from './firefox-utils';

test.describe('Video Capture E2E', () => {
  test('should capture the current page video source via runtime command', async ({ page, extensionBaseUrl }) => {
    await openFirefoxMockPage(
      page,
      extensionBaseUrl,
      `
        <html>
          <head>
            <title>Topvid Demo</title>
            <meta name="author" content="VaultWares QA" />
          </head>
          <body>
            <video id="demo-video" controls src="https://cdn.example.test/video/topvid-demo.mp4"></video>
          </body>
        </html>
      `,
    );
    await injectFirefoxContentScript(page, extensionBaseUrl);

    await page.locator('#demo-video').hover();
    await page.evaluate(async () => {
      await (globalThis as any).browser.runtime.sendMessage({ type: 'capture-video' });
    });

    const savedVideos = await readSavedVideos(page);
    expect(savedVideos).toHaveLength(1);
    expect(savedVideos[0].url).toBe('https://cdn.example.test/video/topvid-demo.mp4');
    expect(savedVideos[0].author).toBe('VaultWares QA');
    await expect(page.locator('.vault-notification-message')).toContainText('ADDED TO VAULT');
  });
});
