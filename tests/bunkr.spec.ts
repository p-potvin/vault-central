import { test, expect } from './extension.fixture';
import { injectFirefoxContentScript, openFirefoxMockPage, readSavedVideos } from './firefox-utils';

test.describe('Bunkr Video Capture', () => {
  test('should capture video source after navigating from an album page', async ({ page, extensionBaseUrl }) => {
    await openFirefoxMockPage(
      page,
      extensionBaseUrl,
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
      extensionBaseUrl,
      `
        <main>
          <video id="bunkr-video" controls src="https://cdn.example.test/bunkr/final-video.webm"></video>
        </main>
      `,
    );
    await injectFirefoxContentScript(page, extensionBaseUrl);

    await page.locator('#bunkr-video').hover();
    await page.keyboard.press('Alt+X');

    const savedVideos = await readSavedVideos(page);
    expect(savedVideos).toHaveLength(1);
    expect(savedVideos[0].url).toBe('https://cdn.example.test/bunkr/final-video.webm');
    await expect(page.locator('.vault-notification-message')).toContainText('ADDED TO VAULT');
  });
});
