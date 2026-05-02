import browser from 'webextension-polyfill';
import { getAllPreviewRecords } from './dexie-store';
import { getBackupSettings, getPinSettings, getSavedVideos, recordBackupResult } from './storage-vault';
export const DAILY_BACKUP_ALARM = 'vault-central-daily-backup';
function pad(value) {
    return String(value).padStart(2, '0');
}
export function formatBackupTimestamp(date = new Date()) {
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
export function sanitizeDownloadFolder(folder) {
    return folder
        .split(/[\\/]+/)
        .map(part => part.trim().replace(/[<>:"|?*\x00-\x1F]/g, '-'))
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
}
export function buildBackupFilename(settings, date = new Date()) {
    const filename = `vault-central-full-backup_${formatBackupTimestamp(date)}.json`;
    const folder = sanitizeDownloadFolder(settings.folder || '');
    return folder ? `${folder}/${filename}` : filename;
}
async function blobLikeToBase64(blobLike) {
    const bytes = blobLike instanceof Blob
        ? new Uint8Array(await blobLike.arrayBuffer())
        : new Uint8Array(blobLike);
    // ⚡ BOLT OPTIMIZATION:
    // Using an array to collect string chunks and calling `.join('')` at the end
    // eliminates the O(N^2) memory reallocation overhead caused by repetitive string
    // concatenation (`binary += ...`) inside a loop, especially for large blob payloads.
    const binaryChunks = [];
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binaryChunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
    }
    return btoa(binaryChunks.join(''));
}
async function serializePreview(record) {
    return {
        videoUrl: record.videoUrl,
        mimeType: record.mimeType,
        timestamp: record.timestamp,
        encrypted: Boolean(record.encrypted),
        dataEncoding: 'base64',
        data: await blobLikeToBase64(record.blob)
    };
}
async function downloadTextFile(filename, contents) {
    let objectUrl = null;
    let url;
    if (typeof URL.createObjectURL === 'function') {
        const blob = new Blob([contents], { type: 'application/json' });
        objectUrl = URL.createObjectURL(blob);
        url = objectUrl;
    }
    else {
        url = `data:application/json;charset=utf-8,${encodeURIComponent(contents)}`;
    }
    try {
        return await browser.downloads.download({
            url,
            filename,
            conflictAction: 'uniquify',
            saveAs: false
        });
    }
    finally {
        if (objectUrl) {
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        }
    }
}
export async function createFullVaultBackup(source) {
    const [settings, pinSettings, videos, previewRecords] = await Promise.all([
        getBackupSettings(),
        getPinSettings(),
        getSavedVideos(true),
        getAllPreviewRecords()
    ]);
    const previews = await Promise.all(previewRecords.map(serializePreview));
    const createdAt = new Date();
    return {
        version: 1,
        app: 'vault-central',
        kind: 'full-vault-backup',
        source,
        createdAt: createdAt.toISOString(),
        createdAtMs: createdAt.getTime(),
        backupSettings: {
            folder: settings.folder,
            dailyEnabled: settings.enabled
        },
        security: {
            pinEnabled: Boolean(pinSettings.enabled),
            encryptedPreviewsPreserved: previews.some(preview => preview.encrypted)
        },
        videos,
        previews
    };
}
export async function downloadFullVaultBackup(source) {
    const settings = await getBackupSettings();
    const filename = buildBackupFilename(settings);
    try {
        const backup = await createFullVaultBackup(source);
        const downloadId = await downloadTextFile(filename, JSON.stringify(backup, null, 2));
        await recordBackupResult('success');
        return {
            success: true,
            downloadId,
            filename,
            videos: backup.videos.length,
            previews: backup.previews.length
        };
    }
    catch (err) {
        await recordBackupResult('error', err instanceof Error ? err.message : String(err));
        throw err;
    }
}
