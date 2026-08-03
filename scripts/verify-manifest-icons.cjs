/**
 * Fails the build when manifest.json references an icon that did not make it
 * into dist/.
 *
 * vite.config.ts copies a *glob* of icons rather than the whole folder, to keep
 * the multi-megabyte brand masters out of the AMO upload. That means editing
 * manifest.json to point at a differently-named icon set can silently ship a
 * manifest whose icon paths 404 — which is exactly what happened when the icons
 * were switched to the -nobg variants. Cheap assertion, runs after the copy.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const manifestPath = path.join(distDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('\x1b[31m[verify-manifest-icons] dist/manifest.json is missing — did the build run?\x1b[0m');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const referenced = new Set([
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action || {}).default_icon || {}),
]);

const missing = [...referenced].filter((rel) => !fs.existsSync(path.join(distDir, rel)));

if (missing.length > 0) {
  console.error('\x1b[31m[verify-manifest-icons] manifest.json references icons that are not in dist:\x1b[0m');
  for (const rel of missing) console.error(`  - ${rel}`);
  console.error('\x1b[33mWiden the icons copy target in vite.config.ts, or point the manifest at icons that ship.\x1b[0m');
  process.exit(1);
}

console.log(`\x1b[32m[verify-manifest-icons] OK — all ${referenced.size} manifest icon references resolve in dist.\x1b[0m`);
