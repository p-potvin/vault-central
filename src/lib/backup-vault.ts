import browser from 'webextension-polyfill';
import { getAllPreviewRecords, type PreviewBlob } from './dexie-store';
import {
  getBackupSettings,
  getPinSettings,
  getSavedVideos,
  recordBackupResult,
  type BackupSettings
} from './storage-vault';

export const DAILY_BACKUP_ALARM = 'vault-central-daily-backup';

type BackupSource = 'manual' | 'automatic';

type PreviewBackupRecord = {
  videoUrl: string;
  mimeType: string;
  timestamp: number;
  encrypted: boolean;
  dataEncoding: 'base64';
  data: string;
};

type FullVaultBackup = {
  version: 1;
  app: 'vault-central';
  kind: 'full-vault-backup';
  source: BackupSource;
  createdAt: string;
  createdAtMs: number;
  backupSettings: {
    folder: string;
    dailyEnabled: boolean;
  };
  security: {
    pinEnabled: boolean;
    encryptedPreviewsPreserved: boolean;
  };
  videos: Awaited<ReturnType<typeof getSavedVideos>>;
  previews: PreviewBackupRecord[];
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatBackupTimestamp(date = new Date()): string {
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

export function sanitizeDownloadFolder(folder: string): string {
  return folder
    .split(/[\\/]+/)
    .map(part => part.trim().replace(/[<>:"|?*\x00-\x1F]/g, '-'))
    .filter(part => part && part !== '.' && part !== '..')
    .join('/');
}

export function buildBackupFilename(settings: BackupSettings, date = new Date()): string {
  const filename = `vault-central-full-backup_${formatBackupTimestamp(date)}.json`;
  const folder = sanitizeDownloadFolder(settings.folder || '');
  return folder ? `${folder}/${filename}` : filename;
}

async function blobLikeToBase64(blobLike: PreviewBlob['blob']): Promise<string> {
  const bytes = blobLike instanceof Blob
    ? new Uint8Array(await blobLike.arrayBuffer())
    : new Uint8Array(blobLike as Uint8Array);

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function serializePreview(record: PreviewBlob): Promise<PreviewBackupRecord> {
  return {
    videoUrl: record.videoUrl,
    mimeType: record.mimeType,
    timestamp: record.timestamp,
    encrypted: Boolean(record.encrypted),
    dataEncoding: 'base64',
    data: await blobLikeToBase64(record.blob)
  };
}

async function downloadTextFile(filename: string, contents: string): Promise<number> {
  let objectUrl: string | null = null;
  let url: string;

  if (typeof URL.createObjectURL === 'function') {
    const blob = new Blob([contents], { type: 'application/json' });
    objectUrl = URL.createObjectURL(blob);
    url = objectUrl;
  } else {
    url = `data:application/json;charset=utf-8,${encodeURIComponent(contents)}`;
  }

  try {
    return await browser.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false
    });
  } finally {
    if (objectUrl) {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }
  }
}

export async function createFullVaultBackup(source: BackupSource): Promise<FullVaultBackup> {
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

export async function downloadFullVaultBackup(source: BackupSource) {
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
  } catch (err) {
    await recordBackupResult('error', err instanceof Error ? err.message : String(err));
    throw err;
  }
}
