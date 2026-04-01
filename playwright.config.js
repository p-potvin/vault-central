import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
    testDir: './tests',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 2,
    workers: 1,
    reporter: 'html',
    use: {
        trace: 'on-first-retry',
        headless: false, // Extensions don't work in headless mode for some browsers
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        // Commented out other browsers temporarily to focus on Chromium
        /*
        {
          name: 'firefox',
          use: { ...devices['Desktop Firefox'] },
        },
        {
          name: 'webkit',
          use: { ...devices['Desktop Safari'] },
        },
        */
    ],
});
