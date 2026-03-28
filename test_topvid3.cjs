const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://topvid.tv/f/v5Mv5D', { waitUntil: 'networkidle' }).catch(()=>null);
  
  const iframes = await page.evaluate(() => {
     return Array.from(document.querySelectorAll('iframe')).map(i => i.src);
  });
  console.log("Iframes: ", iframes);

  const videoSrc = await page.evaluate(() => {
     return Array.from(document.querySelectorAll('video')).map(i => i.src || i.querySelector('source')?.src);
  });
  console.log("Video source direct: ", videoSrc);

  await browser.close();
})();
