import { test, expect } from './extension.fixture';
import { openFirefoxMockPage, readSavedVideos, sendRuntimeMessage } from './firefox-utils';

test.describe('Video Capture E2E', () => {
  test('should capture the current page video source via runtime command', async ({ page, firefoxHarness }) => {
    test.setTimeout(60000);
    await openFirefoxMockPage(
      page,
      firefoxHarness,
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

    await page.locator('#demo-video').hover();
    await sendRuntimeMessage(page, { type: 'capture-video' });

    await expect(page.locator('.vault-notification-message')).toContainText('ADDED TO VAULT', { timeout: 5000 });
    await expect.poll(() => readSavedVideos(page), { timeout: 50000, intervals: [500, 2000, 5000] }).toHaveLength(1);
    const savedVideos = await readSavedVideos(page);
    expect(savedVideos[0].url).toBe('https://cdn.example.test/video/topvid-demo.mp4');
    expect(savedVideos[0].author).toBe('VaultWares QA');
  });
});
