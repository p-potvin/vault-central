const fs = require('fs');
let code = fs.readFileSync('src/lib/themes.ts', 'utf8');
code = code.replace(/ault-theme-;/g, '\ault-theme-\\;');
fs.writeFileSync('src/lib/themes.ts', code);
