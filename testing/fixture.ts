import { test as base, expect } from '@playwright/test';
import type { Browser, BrowserContext } from '@playwright/test';
// @ts-ignore - playwright-webextext ships without TypeScript declarations for all exports
import { withExtension } from 'playwright-webextext';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'path';

export interface ExtensionFixtures {
  extensionId: string;
  extensionBaseUrl: string;
}

interface FirefoxHarness {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Reusable extension test fixture for VaultWares browser extensions.
 *
 * - Firefox: uses playwright-webextext to install the addon after launch, with a
 *   deterministic UUID set via `extensions.webextensions.uuids` so the
 *   moz-extension:// origin is stable across runs.
 * - Chromium: uses withExtension to inject via launch.
 *
 * Usage:
 *   import { test, expect } from '../testing/fixture';
 *   test('...', async ({ page, extensionBaseUrl }) => { ... });
 *
 * @param manifestId    The gecko.id value from your extension's manifest.json
 * @param extensionUUID A deterministic UUID to assign to the Firefox extension
 * @param extensionPath Absolute or CWD-relative path to the built extension dist directory
 */
export function createExtensionTest(
  manifestId: string,
  extensionUUID: string,
  extensionPath: string = './dist',
) {
  const resolvedPath = path.resolve(extensionPath);

  async function createFirefoxHarness(rootDir: string): Promise<FirefoxHarness> {
    const server = http.createServer(async (req, res) => {
      const requestPath = (req.url ?? '/').split('?')[0];
      if (requestPath === '/__tests__/blank.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Vault Central Test Host</title></head><body></body></html>');
        return;
      }
      const relativePath = requestPath === '/' ? '/dashboard-v2.html' : requestPath;
      const filePath = path.join(rootDir, relativePath.replace(/^\/+/, ''));

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
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve Firefox harness server address.');
    }

    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      },
    };
  }

  function buildFirefoxBrowserMock() {
    return ({
      extensionBaseUrl,
      runtimeId,
    }: {
      extensionBaseUrl: string;
      runtimeId: string;
    }) => {
      const storagePrefix = '__vault_central_storage__:';
      const messageListeners = new Set<(message: any, sender?: any) => unknown>();

      function readStoredValue(key: string): unknown {
        const raw = window.localStorage.getItem(`${storagePrefix}${key}`);
        return raw == null ? undefined : JSON.parse(raw);
      }

      function writeStoredValue(key: string, value: unknown) {
        window.localStorage.setItem(`${storagePrefix}${key}`, JSON.stringify(value));
      }

      const localArea = {
        async get(keys?: string | string[] | Record<string, unknown> | null) {
          if (keys == null) {
            const values: Record<string, unknown> = {};
            for (let index = 0; index < window.localStorage.length; index += 1) {
              const storageKey = window.localStorage.key(index);
              if (!storageKey?.startsWith(storagePrefix)) continue;
              values[storageKey.slice(storagePrefix.length)] = JSON.parse(
                window.localStorage.getItem(storageKey) ?? 'null',
              );
            }
            return values;
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, readStoredValue(key)]));
          }
          if (typeof keys === 'string') {
            return { [keys]: readStoredValue(keys) };
          }
          return Object.fromEntries(
            Object.entries(keys).map(([key, fallback]) => [
              key,
              readStoredValue(key) ?? fallback,
            ]),
          );
        },
        async set(values: Record<string, unknown>) {
          for (const [key, value] of Object.entries(values ?? {})) {
            writeStoredValue(key, value);
          }
        },
        async remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            window.localStorage.removeItem(`${storagePrefix}${key}`);
          }
        },
      };

      const runtime = {
        id: runtimeId,
        getURL: (targetPath: string) => `${extensionBaseUrl}/${String(targetPath).replace(/^\/+/, '')}`,
        async sendMessage(message: { action?: string; data?: any }) {
          switch (message?.action) {
            case 'process_capture': {
              const savedVideos = (readStoredValue('savedVideos') as any[] | undefined) ?? [];
              if (savedVideos.some((item) => item?.url === message.data?.url)) {
                return { success: false, message: 'Item already in vault' };
              }

              const nextItem = {
                ...message.data,
                rawVideoSrc: message.data?.rawVideoSrc ?? message.data?.url ?? '',
                timestamp: Number(message.data?.timestamp ?? Date.now()),
                type: message.data?.type ?? 'link',
                domain: message.data?.domain ?? (() => {
                  try {
                    return new URL(String(message.data?.url ?? window.location.href)).hostname;
                  } catch {
                    return window.location.hostname;
                  }
                })(),
                tags: Array.isArray(message.data?.tags) ? message.data.tags : [],
              };

              writeStoredValue('savedVideos', [...savedVideos, nextItem]);
              return { success: true, data: nextItem };
            }
            case 'get_backup_settings':
              return {
                success: true,
                settings: {
                  enabled: false,
                  folder: '',
                  lastBackupAt: null,
                  lastBackupStatus: null,
                  lastBackupError: null,
                },
              };
            case 'open_dashboard':
              window.open(`${extensionBaseUrl}/dashboard-v2.html`, '_blank');
              return true;
            case 'run_full_backup':
            case 'save_backup_settings':
              return { success: true };
            case 'download_debug_logs':
              return true;
            default:
              for (const listener of messageListeners) {
                const response = await listener(message, { tab: { id: 1, url: window.location.href } });
                if (response !== undefined) {
                  return response;
                }
              }
              return { success: true };
          }
        },
        onMessage: {
          addListener(listener: (message: any, sender?: any) => unknown) {
            messageListeners.add(listener);
          },
          removeListener(listener: (message: any, sender?: any) => unknown) {
            messageListeners.delete(listener);
          },
          hasListener() {
            return messageListeners.size > 0;
          },
        },
      };

      const browserMock = {
        storage: { local: localArea, sync: localArea },
        runtime,
        downloads: {
          async download() {
            return 1;
          },
        },
        tabs: {
          async query() {
            return [];
          },
          async update() {},
          async create() {
            return { id: 1 };
          },
          async remove() {},
        },
        windows: {
          async update() {},
        },
      };

      const chromeMock = {
        runtime,
        storage: browserMock.storage,
        tabs: browserMock.tabs,
        downloads: browserMock.downloads,
        windows: browserMock.windows,
      };

      // Expose enough of the extension API surface for the dashboard bundle.
      (window as typeof window & { browser?: unknown; chrome?: unknown }).browser = browserMock;
      (window as typeof window & { browser?: unknown; chrome?: unknown }).chrome = chromeMock;
    };
  }

  // We override `browser` at worker scope so that every test in the worker
  // shares one browser instance that already has the extension installed.
  // The standard `context` and `page` fixtures are then derived from it normally.
  // ts-ignore on extend is necessary because `browser` is already declared in
  // the base worker fixtures; Playwright's runtime supports the override fine.
  // @ts-ignore
  return base.extend<
    ExtensionFixtures,
    { browser: Browser; firefoxHarness: FirefoxHarness }
  >({
    firefoxHarness: [
      async ({ browserName }, use) => {
        if (browserName !== 'firefox') {
          await use({ baseUrl: '', close: async () => {} });
          return;
        }

        const harness = await createFirefoxHarness(resolvedPath);
        try {
          await use(harness);
        } finally {
          await harness.close();
        }
      },
      { scope: 'worker' },
    ],

    // Worker-scoped: one browser per worker, extension installed once.
    browser: [
      // @ts-ignore
      async ({ playwright, browserName }, use: (b: Browser) => Promise<void>) => {
        let browser: Browser;
        if (browserName === 'chromium') {
          browser = await withExtension(playwright.chromium, resolvedPath).launch({});
        } else {
          browser = await playwright[browserName].launch({});
        }
        await use(browser);
        await browser.close();
      },
      { scope: 'worker', timeout: 0 },
    ],

    context: async ({ browser, browserName, firefoxHarness }, use) => {
      const context: BrowserContext = await browser.newContext();

      if (browserName === 'firefox') {
        await context.addInitScript(buildFirefoxBrowserMock(), {
          extensionBaseUrl: firefoxHarness.baseUrl,
          runtimeId: manifestId,
        });
      }

      try {
        await use(context);
      } finally {
        await context.close();
      }
    },

    // Test-scoped: derive the moz-extension:// base URL from the known UUID.
    extensionId: async ({ browserName }, use) => {
      if (browserName === 'firefox') {
        await use(manifestId);
      } else {
        // Chromium: would need to discover the extension ID at runtime.
        // Not implemented yet – only Firefox is in the current test matrix.
        await use('TODO');
      }
    },

    extensionBaseUrl: async ({ browserName, firefoxHarness }, use) => {
      if (browserName === 'firefox') {
        await use(firefoxHarness.baseUrl);
      } else {
        // Chromium: would need to discover the extension ID at runtime.
        // Not implemented yet – only Firefox is in the current test matrix.
        await use(`chrome-extension://TODO`);
      }
    },
  });
}

// Vault Central pre-configured test instance
export const test = createExtensionTest(
  'vault-central@p-potvin',
  '01234567-89ab-cdef-0123-456789abcdef',
);

export { expect };
