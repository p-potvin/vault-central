import { test, expect } from './extension.fixture';
import { injectFirefoxContentScript, openFirefoxMockPage, readSavedVideos } from './firefox-utils';

test.describe('Video Capture E2E', () => {
  test('should capture a linked stream via Alt+X', async ({ page, firefoxHarness }) => {
    test.setTimeout(60000);
    await openFirefoxMockPage(
      page,
      firefoxHarness,
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

    await page.locator('#video-link').hover();
    await page.keyboard.press('Alt+X');

    // Optimistic toast fires immediately after target lock — no need to wait for pipeline
    await expect(page.locator('.vault-notification-message')).toContainText('ADDED TO VAULT', { timeout: 5000 });
    // Storage populates after the detached pipeline (scraper tab) completes — wait up to 50s
    await expect.poll(() => readSavedVideos(page), { timeout: 50000, intervals: [500, 2000, 5000] }).toHaveLength(1);
    const savedVideos = await readSavedVideos(page);
    expect(savedVideos[0].url).toBe('https://cdn.example.test/hls/pornxp-stream.m3u8');
    expect(savedVideos[0].thumbnail).toBe('https://images.example.test/pornxp-thumb.jpg');
  });
});
