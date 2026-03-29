const fs = require('fs');
let css = fs.readFileSync('src/styles/globals.css', 'utf8');
const startRoot = \  :root {
    /* Default: Theme 2 - Cyberpunk Cinder */
    --vault-bg: #073642;
    --vault-text: #F3F4F6;
    --vault-border: #1b4a56;
    --vault-card-bg: rgba(0,0,0,0.5);
    --vault-muted: #A0AEC0;
    --vault-accent: #CB4B16;
    --vault-accent-hover: #df5f2a;
    --vault-font: 'Segoe UI Semilight', 'Segoe UI', system-ui, sans-serif;
  }\;

const vaultThemesCss = fs.readFileSync('src/styles/vault-themes.css', 'utf8');
const linesRoot = css.indexOf(':root {');
const linesBody = css.indexOf('  body {');

const before = css.substring(0, linesRoot);
const after = css.substring(linesBody);

fs.writeFileSync('src/styles/globals.css', before + startRoot + '\n\n' + vaultThemesCss + '\n' + after);
