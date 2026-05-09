import { test as base, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'path';
import os from 'node:os';
import { withExtension } from 'playwright-webextext';

export interface FirefoxHarness {
  baseUrl: string;
  registerMockPage: (html: string) => string; // returns URL with ?__vaultTest=1
  close: () => Promise<void>;
}

export interface ExtensionFixtures {
  extensionId: string;
  extensionBaseUrl: string;
  firefoxHarness: FirefoxHarness;
}

const extensionPath = path.resolve('./dist');
// playwright-webextext expects unpacked extension directories. The .xpi is
// unzipped during repo setup (or by the build script) into ./tests/fixtures/ublock-origin/.
const ublockPath = path.resolve('./tests/fixtures/ublock-origin');

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export const test = base.extend<ExtensionFixtures>({
  firefoxHarness: [
    async ({}, use) => {
      const mockPages = new Map<string, string>();

      const server = http.createServer(async (req, res) => {
        const requestPath = (req.url ?? '/').split('?')[0];
        const relativePath = requestPath === '/' ? '/dashboard-v2.html' : requestPath;

        // Synthetic blank fixture page for content-script tests.
        if (relativePath === '/__tests__/blank.html') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<!doctype html><html><head><meta charset="utf-8"><title>vault-test</title></head><body></body></html>');
          return;
        }

        // Dynamic mock pages registered by tests via registerMockPage().
        // Each registration gets a unique path so the content script re-injects
        // on real navigation (setContent does not retrigger content_scripts).
        if (relativePath.startsWith('/__tests__/mock/')) {
          const id = relativePath.replace('/__tests__/mock/', '');
          const html = mockPages.get(id);
          if (html !== undefined) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
            return;
          }
          res.writeHead(404);
          res.end('Mock not found');
          return;
        }

        const filePath = path.join(extensionPath, relativePath.replace(/^\/+/, ''));

        try {
          const content = await fs.readFile(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const contentType =
            ext === '.html' ? 'text/html' :
            ext === '.js' ? 'text/javascript' :
            ext === '.css' ? 'text/css' :
            ext === '.json' ? 'application/json' :
            ext === '.png' ? 'image/png' :
            ext === '.wasm' ? 'application/wasm' :
            'application/octet-stream';

          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as any;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const harness: FirefoxHarness = {
        baseUrl,
        registerMockPage: (html: string) => {
          const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
          mockPages.set(id, html);
          return `${baseUrl}/__tests__/mock/${id}?__vaultTest=1`;
        },
        close: async () => {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        },
      };

      await use(harness);
      await harness.close();
    },
    { scope: 'test' },
  ],

  context: [
    async ({ playwright, browserName, firefoxHarness }, use) => {
      if (browserName === 'chromium') {
        const userDataDir = path.join(os.tmpdir(), `vault-pw-${Date.now()}`);
        const context = await playwright.chromium.launchPersistentContext(userDataDir, {
          headless: true,
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ],
        });
        await use(context);
        await context.close();
      } else {
        // Firefox: load the built extension from dist/ as a temporary add-on.
        // uBlock Origin is loaded alongside when the .xpi is present, mirroring the
        // user's actual browsing environment (Firefox + uBlock).
        const ublockAvailable = await pathExists(ublockPath);
        const addonPaths = ublockAvailable ? [extensionPath, ublockPath] : [extensionPath];
        const firefoxWithExt = withExtension(playwright.firefox, addonPaths);
        const userDataDir = path.join(os.tmpdir(), `vault-pw-fx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await fs.mkdir(userDataDir, { recursive: true });
        const context = await firefoxWithExt.launchPersistentContext(userDataDir, {
          headless: false,
        });
        await use(context);
        await context.close();
        await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    { scope: 'test' },
  ],

  extensionId: async ({ context, browserName }, use) => {
    if (browserName === 'chromium') {
      let [background] = context.serviceWorkers();
      if (!background) {
        const page = await context.newPage();
        await page.goto('chrome://extensions').catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
        [background] = context.serviceWorkers();
      }
      const id = background ? background.url().split('/')[2] : 'oobconomdmfmgfadlchaailjbhooimgo';
      await use(id);
    } else {
      await use('vault-central@p-potvin');
    }
  },

  extensionBaseUrl: async ({ extensionId, browserName, firefoxHarness, context }, use) => {
    if (browserName === 'chromium') {
      await use(`chrome-extension://${extensionId}`);
    } else {
      // Discover the real moz-extension:// URL by navigating a page to a mock
      // page (which auto-injects content.js with the test bridge), then
      // calling browser.runtime.getURL('') via the bridge. UUIDs Firefox assigns
      // to temporary add-ons are random, so we discover instead of pin.
      const probePage = await context.newPage();
      const probeUrl = firefoxHarness.registerMockPage('<html><body>probe</body></html>');
      await probePage.goto(probeUrl, { waitUntil: 'domcontentloaded' });
      await probePage.waitForTimeout(400);
      const extUrl = await probePage.evaluate(async () => {
        return new Promise<string>((resolve, reject) => {
          const id = 'probe-' + Math.random();
          const t = setTimeout(() => reject(new Error('bridge timeout')), 5000);
          const handler = (e: MessageEvent) => {
            if (e.data?.__vaultTest === 'response' && e.data.id === id) {
              clearTimeout(t);
              window.removeEventListener('message', handler);
              resolve(e.data.payload);
            }
          };
          window.addEventListener('message', handler);
          window.postMessage({ __vaultTest: 'request', id, action: 'runtime.getURL', path: '' }, '*');
        });
      });
      await probePage.close();
      // Strip trailing slash so callers can do `${extensionBaseUrl}/dashboard-v2.html`
      const baseUrl = extUrl.replace(/\/$/, '');
      await use(baseUrl);
    }
  },
});

export { expect };
