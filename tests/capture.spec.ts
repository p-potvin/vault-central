import { test, expect } from './extension.fixture';
import { injectFirefoxContentScript, openFirefoxMockPage, readSavedVideos } from './firefox-utils';

test.describe('Video Capture E2E', () => {
  test('should capture a linked stream via Alt+X', async ({ page, extensionBaseUrl }) => {
    await openFirefoxMockPage(
      page,
      extensionBaseUrl,
      `
        <main>
          <article class="video-card">
            <a id="video-link" href="https://cdn.example.test/hls/pornxp-stream.m3u8" aria-label="Featured Capture">
              <img src="https://images.example.test/pornxp-thumb.jpg" alt="Featured Capture" />
            </a>
          </article>
        </main>
      `,
    );
    await injectFirefoxContentScript(page, extensionBaseUrl);

    await page.locator('#video-link').hover();
    await page.keyboard.press('Alt+X');

    await expect(page.locator('.vault-notification-message')).toContainText('ADDED TO VAULT');
    const savedVideos = await readSavedVideos(page);
    expect(savedVideos).toHaveLength(1);
    expect(savedVideos[0].url).toBe('https://cdn.example.test/hls/pornxp-stream.m3u8');
    expect(savedVideos[0].thumbnail).toBe('https://images.example.test/pornxp-thumb.jpg');
  });
});
