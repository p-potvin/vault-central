import type { Page } from '@playwright/test';

export async function openFirefoxMockPage(
  page: Page,
  extensionBaseUrl: string,
  html: string,
) {
  await page.goto(`${extensionBaseUrl}/__tests__/blank.html`, { waitUntil: 'domcontentloaded' });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
}

export async function injectFirefoxContentScript(page: Page, extensionBaseUrl: string) {
  await page.addScriptTag({ url: `${extensionBaseUrl}/content.js` });
}

export async function readSavedVideos(page: Page) {
  return page.evaluate(async () => {
    const result = await (globalThis as any).browser.storage.local.get('savedVideos');
    return (result.savedVideos ?? []) as any[];
  });
}

export async function setSavedVideos(page: Page, videos: unknown[]) {
  await page.evaluate(async (entries) => {
    await (globalThis as any).browser.storage.local.set({ savedVideos: entries });
  }, videos);
}

export async function setPinSettings(page: Page, settings: Record<string, unknown>) {
  await page.evaluate(async (value) => {
    await (globalThis as any).browser.storage.local.set({ pinSettings: value });
  }, settings);
}
