const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://topvid.tv/f/v5Mv5D', { waitUntil: 'networkidle' }).catch(()=>null);
  
  const iframes = await page.evaluate(() => {
     return Array.from(document.querySelectorAll('iframe')).map(i => i.src);
  });
  console.log("Iframes: ", iframes);

  const html = await page.evaluate(() => {
      const el = document.querySelector('iframe');
      return el ? el.outerHTML : 'no iframe';
  });
  console.log("Iframe HTML: ", html);

  await browser.close();
})();
