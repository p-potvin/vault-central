const fetch = require('node-fetch');
fetch('https://bunkr.cr/a/ANmmWTVZ').then(r=>r.text()).then(t=>{
    const links = [...t.matchAll(/href=\"(.*?)\"/g)].map(m => m[1]);
    console.log(links.filter(l => l.includes('bunkr.cr') || l.startsWith('/')));
});
