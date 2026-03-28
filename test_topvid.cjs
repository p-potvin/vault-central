const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://topvid.tv/f/v5Mv5D', { waitUntil: 'domcontentloaded' }).catch(()=>null);
  
  // Try to find a real video link
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => a.href).filter(href => href && href.length > 20 && href.includes('topvid.tv'));
  });
  console.log("Links found: ", links.slice(0, 5));

  for (let l of links) {
    if (l.match(/\/((video)|(embed)|(f)|(v)|(watch))\//)) {
        console.log("Navigating to video page: ", l);
        await page.goto(l, { waitUntil: 'networkidle' }).catch(()=>null);
        await page.waitForTimeout(3000);
        break;
    }
  }

  // Look for any evidence of m3u8 in the page context
  const hasJw = await page.evaluate(() => typeof window.jwplayer !== 'undefined');
  console.log("Has JWPlayer: ", hasJw);

  if (hasJw) {
      const playlist = await page.evaluate(() => {
          try {
              return window.jwplayer().getPlaylist();
          } catch(e) { return "err " + e.message; }
      });
      console.log("Playlist: ", JSON.stringify(playlist, null, 2));
  }

  await browser.close();
})();
