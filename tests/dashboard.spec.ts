import { test, expect } from './extension.fixture';

test.describe('Vault Central E2E Tests', () => {

  test('Dashboard should load with correct title and branding', async ({ context, extensionBaseUrl }) => {
    const page = await context.newPage();
    const dashboardUrl = `${extensionBaseUrl}/dashboard-v2.html`;
    // Extension module scripts are deferred; 'load' may not fire reliably via RDP.
    // Use 'domcontentloaded' and let individual assertions do the waiting.
    await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
    // Check main branding in header
    await expect(page.locator('h1')).toContainText('Vault');
    await expect(page.locator('h1')).toContainText('Central');
    // Check sub-header
    await expect(page.locator('p:has-text("Secure Media Vault")')).toBeVisible();
  });

  test('Search input should be visible and interactive', async ({ context, extensionBaseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${extensionBaseUrl}/dashboard-v2.html`, { waitUntil: 'domcontentloaded' });
    const searchInput = page.getByPlaceholder(/Search in title.../i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Test Search Query');
    await expect(searchInput).toHaveValue('Test Search Query');
  });

  test('Sidebar should toggle when clicking the toggle bar', async ({ context, extensionBaseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${extensionBaseUrl}/dashboard-v2.html`, { waitUntil: 'domcontentloaded' });
    // Sidebar should start open (w-64)
    const sidebar = page.locator('aside');
    await expect(sidebar).toHaveClass(/w-64/);
    // Click toggle button (div with title "Collapse Sidebar")
    const toggleButton = page.getByTitle(/Collapse Sidebar/i);
    await toggleButton.click();
    // Sidebar should now be closed (w-0)
    await expect(sidebar).toHaveClass(/w-0/);
  });

  test('Settings panel should open when clicking settings button', async ({ context, extensionBaseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${extensionBaseUrl}/dashboard-v2.html`, { waitUntil: 'domcontentloaded' });
    const settingsButton = page.getByTitle(/Vault Settings/i);
    await settingsButton.click();
    // Check for settings header in the modal/panel
    await expect(page.getByText(/Advanced Options & Export/i)).toBeVisible();
    await expect(page.getByText(/Data Portability/i)).toBeVisible();
  });

  test('Theme cycling should work', async ({ context, extensionBaseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${extensionBaseUrl}/dashboard-v2.html`, { waitUntil: 'domcontentloaded' });
    const themeButton = page.getByTitle(/Cycle Theme/i);
    await themeButton.click();
    // Verify that data-theme attribute on <html> changes or exists
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', /vault-theme-/);
  });
});