import { test as base, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'path';
import os from 'node:os';

export interface ExtensionFixtures {
  extensionId: string;
  extensionBaseUrl: string;
}

interface FirefoxHarness {
  baseUrl: string;
  close: () => Promise<void>;
}

const extensionPath = path.resolve('./dist');

export const test = base.extend<ExtensionFixtures & { firefoxHarness: FirefoxHarness }>({
  firefoxHarness: [
    async ({}, use) => {
      const server = http.createServer(async (req, res) => {
        const requestPath = (req.url ?? '/').split('?')[0];
        const relativePath = requestPath === '/' ? '/dashboard-v2.html' : requestPath;
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
      const harness = {
        baseUrl: `http://127.0.0.1:${address.port}`,
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
        const context = await playwright[browserName].launchPersistentContext('', {});
        await use(context);
        await context.close();
      }
    },
    { scope: 'test' },
  ],

  extensionId: async ({ context, browserName }, use) => {
    if (browserName === 'chromium') {
      let [background] = context.serviceWorkers();
      if (!background) {
        // Trigger SW
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

  extensionBaseUrl: async ({ extensionId, browserName, firefoxHarness }, use) => {
    if (browserName === 'chromium') {
      await use(`chrome-extension://${extensionId}`);
    } else {
      await use(firefoxHarness.baseUrl);
    }
  },
});

export { expect };
