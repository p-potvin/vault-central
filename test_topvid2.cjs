const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://topvid.tv/f/v5Mv5D', { waitUntil: 'networkidle' }).catch(()=>null);
  
  const playlist = await page.evaluate(() => {
      try {
          if(typeof jwplayer === 'undefined') return "no jwplayer";
          const players = document.querySelectorAll('.jwplayer');
          if (players.length > 0) {
              const pId = players[0].id;
              return jwplayer(pId).getPlaylist();
          }
          return "no .jwplayer elements";
      } catch(e) { return "err " + e.message; }
  });
  console.log("Playlist: ", JSON.stringify(playlist, null, 2));

  // Let's also check for any m3u8 in the html or network
  const html = await page.content();
  const m3u8Links = html.match(/https?:\/\/[^\s"'<>]+\.m3u8/g);
  console.log("m3u8 in HTML: ", m3u8Links ? m3u8Links.slice(0,3) : "none");

  await browser.close();
})();
