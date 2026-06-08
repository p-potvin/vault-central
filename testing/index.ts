/**
 * VaultWares Playwright extension testing utilities.
 *
 * Provides reusable fixtures and base config for testing browser extensions
 * across Firefox and Chromium with playwright-webextext.
 */
export { test, expect, createExtensionTest, type ExtensionFixtures } from './fixture';
export { baseConfig, firefoxProject, chromiumProject } from './config';
