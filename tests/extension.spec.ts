import { test, expect } from './extension.fixture';
import {
  injectFirefoxContentScript,
  openFirefoxMockPage,
  readSavedVideos,
  setPinSettings,
  setSavedVideos,
} from './firefox-utils';

test.describe('Vault Central Extension Tests', () => {
  test('extension scripts should mark saved links on the page', async ({ page, extensionBaseUrl }) => {
    const savedUrl = 'https://media.example.test/library/alpha.mp4';
    await openFirefoxMockPage(
      page,
      extensionBaseUrl,
      `
        <main>
          <a id="saved-link" href="${savedUrl}">Saved media</a>
          <a href="https://media.example.test/library/beta.mp4">Other media</a>
        </main>
      `,
    );
    await setSavedVideos(page, [
      { url: savedUrl, title: 'Saved media', timestamp: Date.now(), type: 'video', domain: 'media.example.test', tags: [] },
    ]);

    await injectFirefoxContentScript(page, extensionBaseUrl);

    await expect(page.locator('#saved-link .vault-heart-indicator')).toBeVisible();
  });

  test('dashboard should open from the extension action', async ({ context, page, extensionBaseUrl }) => {
    await page.goto(`${extensionBaseUrl}/pin-entry.html`, { waitUntil: 'domcontentloaded' });
    await setPinSettings(page, { enabled: false, length: 4, lockTimeout: 3600000 });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const dashboardPagePromise = context.waitForEvent('page');
    await page.getByRole('button', { name: /Open Dashboard/i }).click();
    const dashboardPage = await dashboardPagePromise;
    await dashboardPage.waitForLoadState('domcontentloaded');

    await expect(dashboardPage.locator('h1')).toContainText('VaultCentral');
    await expect(dashboardPage.getByPlaceholder(/Search in title/i)).toBeVisible();
  });

  test('content script should capture a direct media target through runtime messaging', async ({ page, extensionBaseUrl }) => {
    await openFirefoxMockPage(
      page,
      extensionBaseUrl,
      `
        <main>
          <a id="capture-link" href="https://cdn.example.test/streams/sample.m3u8">
            <img src="https://images.example.test/thumb.jpg" alt="Sample Stream" />
            Sample Stream
          </a>
        </main>
      `,
    );
    await injectFirefoxContentScript(page, extensionBaseUrl);
    await page.locator('#capture-link').hover();

    await page.evaluate(async () => {
      await (globalThis as any).browser.runtime.sendMessage({ action: 'capture-video' });
    });

    await expect(page.locator('.vault-notification-message')).toContainText('ADDED TO VAULT');
    const savedVideos = await readSavedVideos(page);
    expect(savedVideos).toHaveLength(1);
    expect(savedVideos[0].url).toContain('sample.m3u8');
  });
});
