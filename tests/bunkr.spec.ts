import { test, expect } from './extension.fixture';
import { injectFirefoxContentScript, openFirefoxMockPage, readSavedVideos } from './firefox-utils';

test.describe('Bunkr Video Capture', () => {
  test('should capture video source after navigating from an album page', async ({ page, firefoxHarness }) => {
    test.setTimeout(60000);
    await openFirefoxMockPage(
      page,
      firefoxHarness,
      `
        <main>
          <a id="album-item" href="https://vaultwares.test/__tests__/bunkr-item">Album Item</a>
        </main>
      `,
    );

    const href = await page.locator('#album-item').getAttribute('href');
    expect(href).toBeTruthy();

    await openFirefoxMockPage(
      page,
      firefoxHarness,
      `
        <main>
          <video id="bunkr-video" controls src="https://cdn.example.test/bunkr/final-video.webm"></video>
        </main>
      `,
    );

    await page.locator('#bunkr-video').hover();
    await page.keyboard.press('Alt+X');

    await expect(page.locator('.vault-notification-message')).toContainText('ADDED TO VAULT', { timeout: 5000 });
    await expect.poll(() => readSavedVideos(page), { timeout: 50000, intervals: [500, 2000, 5000] }).toHaveLength(1);
    const savedVideos = await readSavedVideos(page);
    expect(savedVideos[0].url).toBe('https://cdn.example.test/bunkr/final-video.webm');
  });
});
