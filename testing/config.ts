import { devices, type PlaywrightTestConfig } from '@playwright/test';

/**
 * Base Playwright configuration for VaultWares browser extension projects.
 * Extend this in your project-level playwright.config.ts:
 *
 *   import { defineConfig } from '@playwright/test';
 *   import { baseConfig, firefoxProject } from './testing/config';
 *   export default defineConfig({ testDir: './tests', ...baseConfig, projects: [firefoxProject] });
 */
export const baseConfig: Partial<PlaywrightTestConfig> = {
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 2,
  workers: 1,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    headless: false,
  },
};

export const firefoxProject = {
  name: 'firefox',
  use: { ...devices['Desktop Firefox'] },
};

export const chromiumProject = {
  name: 'chromium',
  use: { ...devices['Desktop Chrome'] },
};
