import { test, expect } from './extension.fixture';
import {
  injectFirefoxContentScript,
  openFirefoxMockPage,
  readSavedVideos,
  sendRuntimeMessage,
  setPinSettings,
  setSavedVideos,
} from './firefox-utils';

test.describe('Vault Central Extension Tests', () => {
  test('extension scripts should mark saved links on the page', async ({ page, firefoxHarness }) => {
    const savedUrl = 'https://media.example.test/library/alpha.mp4';
    // Pre-seed storage on a temporary blank mock so the bridge is alive,
    // THEN navigate to the real test page so highlightVaultItems sees the saved url.
    const seedPage = firefoxHarness.registerMockPage('<html><body></body></html>');
    await page.goto(seedPage, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await setSavedVideos(page, [
      { url: savedUrl, title: 'Saved media', timestamp: Date.now(), type: 'video', domain: 'media.example.test', tags: [] },
    ]);

    await openFirefoxMockPage(
      page,
      firefoxHarness,
      `
        <main>
          <a id="saved-link" href="${savedUrl}">Saved media</a>
          <a href="https://media.example.test/library/beta.mp4">Other media</a>
        </main>
      `,
    );

    await expect(page.locator('#saved-link .vault-heart-indicator')).toBeVisible();
  });

  test('dashboard should open from the extension action', async ({ context, page, extensionBaseUrl, firefoxHarness, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox blocks external navigation to moz-extension:// — run on Chromium');
    // Seed pinSettings via the bridge on a mock page (extension pages don't auto-inject content scripts)
    const seedPage = firefoxHarness.registerMockPage('<html><body></body></html>');
    await page.goto(seedPage, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);
    await setPinSettings(page, { enabled: false, length: 4, lockTimeout: 3600000 });

    await page.goto(`${extensionBaseUrl}/pin-entry.html`, { waitUntil: 'domcontentloaded' });

    const dashboardPagePromise = context.waitForEvent('page');
    await page.getByRole('button', { name: /Open Dashboard/i }).click();
    const dashboardPage = await dashboardPagePromise;
    await dashboardPage.waitForLoadState('domcontentloaded');

    await expect(dashboardPage.locator('h1')).toContainText('Vault');
    await expect(dashboardPage.locator('h1')).toContainText('Central');
    await expect(dashboardPage.getByPlaceholder(/Search in title/i)).toBeVisible();
  });

  test('content script should capture a direct media target through runtime messaging', async ({ page, firefoxHarness }) => {
    test.setTimeout(60000);
    await openFirefoxMockPage(
      page,
      firefoxHarness,
      `
        <main>
          <a id="capture-link" href="https://cdn.example.test/streams/sample.m3u8">
            <img src="https://images.example.test/thumb.jpg" alt="Sample Stream" />
            Sample Stream
          </a>
        </main>
      `,
    );
    await page.locator('#capture-link').hover();

    await sendRuntimeMessage(page, { action: 'capture-video' });

    await expect(page.locator('.vault-notification-message')).toContainText('ADDED TO VAULT', { timeout: 5000 });
    await expect.poll(() => readSavedVideos(page), { timeout: 50000, intervals: [500, 2000, 5000] }).toHaveLength(1);
    const savedVideos = await readSavedVideos(page);
    expect(savedVideos[0].url).toContain('sample.m3u8');
  });
});
