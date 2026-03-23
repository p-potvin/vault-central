const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svg = `
<svg width="1024" height="1024" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="24" height="24" rx="4" fill="#050505"/>
    <path d="M12 22C12 22 20 18 20 12V5L12 2L4 5V12C4 18 12 22 12 22Z" stroke="#00f3ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M12 8V16" stroke="#00f3ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 12H16" stroke="#00f3ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const sizes = [16, 32, 48, 128];
const iconsDir = path.join(__dirname, 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir);
}

async function generateIcons() {
  for (const size of sizes) {
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, `icon${size}.png`));
    console.log(`Generated icon${size}.png`);
  }
}

generateIcons().catch(console.error);
