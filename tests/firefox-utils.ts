import type { Page } from '@playwright/test';

// Test pages are served from the harness HTTP server with the `?__vaultTest=1`
// marker, which arms the postMessage bridge inside content.ts. Each mock page
// gets a unique URL so the content script re-injects on real navigation —
// page.setContent does NOT retrigger content_scripts auto-injection.

export interface MockPageRegistry {
  registerMockPage: (html: string) => string;
}

export async function openFirefoxMockPage(
  page: Page,
  registryOrBaseUrl: MockPageRegistry | string,
  html: string,
) {
  // Backwards-compat: legacy call sites pass extensionBaseUrl as the second arg.
  // We can no longer satisfy them with setContent (the content script bridge
  // doesn't survive setContent). The registry path is the supported one.
  if (typeof registryOrBaseUrl === 'string') {
    throw new Error(
      'openFirefoxMockPage now requires a MockPageRegistry (firefoxHarness). ' +
      'Update the test to destructure { firefoxHarness } from the fixture and pass it here.'
    );
  }
  const url = registryOrBaseUrl.registerMockPage(html);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Give the content script's run_at: document_idle a moment to inject.
  await page.waitForTimeout(300);
}

export async function injectFirefoxContentScript(_page: Page, _extensionBaseUrl: string) {
  // No-op. Content script auto-injects via manifest.content_scripts.
  // Kept for call-site compatibility.
}

async function bridgeRequest<T = any>(page: Page, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  return page.evaluate(async ({ action, extra }) => {
    return new Promise<T>((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error(`Test bridge timeout for action ${action}`));
      }, 8000);
      const handler = (event: MessageEvent) => {
        const data = event.data;
        if (!data || data.__vaultTest !== 'response' || data.id !== id) return;
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        if (data.error) reject(new Error(data.error));
        else resolve(data.payload);
      };
      window.addEventListener('message', handler);
      window.postMessage({ __vaultTest: 'request', id, action, ...extra }, '*');
    });
  }, { action, extra });
}

export async function readSavedVideos(page: Page) {
  const result = await bridgeRequest<any[] | undefined>(page, 'storage.get', { key: 'savedVideos' });
  return Array.isArray(result) ? result : [];
}

export async function setSavedVideos(page: Page, videos: unknown[]) {
  await bridgeRequest(page, 'storage.set', { key: 'savedVideos', value: videos });
}

export async function setPinSettings(page: Page, settings: Record<string, unknown>) {
  await bridgeRequest(page, 'storage.set', { key: 'pinSettings', value: settings });
}

export async function sendRuntimeMessage(page: Page, payload: Record<string, unknown>) {
  return bridgeRequest(page, 'runtime.send', { payload });
}
