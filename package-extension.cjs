const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const outputDir = path.join(__dirname, 'package');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
} else {
    // Clean old zip files
    const files = fs.readdirSync(outputDir);
    for (const file of files) {
        if (file.endsWith('.zip')) {
            fs.unlinkSync(path.join(outputDir, file));
        }
    }
}

function formatPackageTimestamp(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + '_' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('-');
}

const timestamp = formatPackageTimestamp(new Date());
const archiveName = `vault-central_${timestamp}.zip`;
const archivePath = path.join(outputDir, archiveName);
const output = fs.createWriteStream(archivePath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
    console.log(`\x1b[32mSuccess! Archive created: ${archive.pointer()} total bytes\x1b[0m`);
    console.log('\x1b[36mPath:\x1b[0m', archivePath);
});

archive.on('error', (err) => { throw err; });

archive.pipe(output);

// Append files from dist directory
const distPath = path.join(__dirname, 'dist');
archive.directory(distPath, false);

archive.finalize();
