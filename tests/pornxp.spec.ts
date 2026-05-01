import { test, expect } from './extension.fixture';
import { injectFirefoxContentScript, openFirefoxMockPage, readSavedVideos } from './firefox-utils';

test.describe('pornxp Video Capture', () => {
  test('should capture the direct player stream and preserve page metadata', async ({ page, extensionBaseUrl }) => {
    await openFirefoxMockPage(
      page,
      extensionBaseUrl,
      `
        <html>
          <head>
            <title>PornXP Demo Scene</title>
            <meta property="og:title" content="PornXP Demo Scene" />
            <meta name="author" content="PornXP QA" />
            <meta property="og:site_name" content="PornXP QA" />
          </head>
          <body>
            <div class="jwplayer">
              <video id="scene-video" src="https://cdn.example.test/pornxp/demo-scene.m3u8"></video>
            </div>
          </body>
        </html>
      `,
    );
    await injectFirefoxContentScript(page, extensionBaseUrl);

    await page.locator('#scene-video').hover();
    await page.keyboard.press('Alt+X');

    const savedVideos = await readSavedVideos(page);
    expect(savedVideos).toHaveLength(1);
    expect(savedVideos[0].url).toBe('https://cdn.example.test/pornxp/demo-scene.m3u8');
    expect(savedVideos[0].title).toBe('PornXP Demo Scene');
    expect(savedVideos[0].author).toBe('PornXP QA');
  });
});
