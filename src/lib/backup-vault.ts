import browser from 'webextension-polyfill';
import { getAllPreviewRecords, type PreviewBlob } from './dexie-store';
import {
  getBackupSettings,
  getPinSettings,
  getSavedVideos,
  getVaultMaterial,
  recordBackupResult,
  type BackupSettings
} from './storage-vault';
import type { VaultMaterialPersisted } from '../types/schemas';

export const DAILY_BACKUP_ALARM = 'vault-central-daily-backup';

type BackupSource = 'manual' | 'automatic';

type PreviewBackupRecord = {
  videoUrl: string;
  mimeType: string;
  timestamp: number;
  /** Legacy CryptoJS marker. v2 records use `schemaVersion: 2` instead. */
  encrypted: boolean;
  /** Present on v2+ records. Absent on legacy v1 records. */
  schemaVersion?: number;
  dataEncoding: 'base64';
  data: string;
};

type FullVaultBackup = {
  version: 1 | 2;
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
    /** v2: ML-KEM-1024 / ML-KEM-512 / aes-only / null (PIN disabled). */
    algorithm?: string | null;
    /** Whether this backup carries any encrypted previews. */
    encryptedPreviewsPreserved: boolean;
  };
  /**
   * VaultMaterial — included in v2 backups so users can restore on a new
   * device. Same Argon2id salt + same PIN re-derives the same KEK and
   * unwraps the private key. Omitted on v1 backups.
   */
  vaultMaterial?: VaultMaterialPersisted | null;
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

  // ⚡ BOLT OPTIMIZATION:
  // Using an array to collect string chunks and calling `.join('')` at the end
  // eliminates the O(N^2) memory reallocation overhead caused by repetitive string
  // concatenation (`binary += ...`) inside a loop, especially for large blob payloads.
  const binaryChunks: string[] = [];
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binaryChunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binaryChunks.join(''));
}

async function serializePreview(record: PreviewBlob): Promise<PreviewBackupRecord> {
  return {
    videoUrl: record.videoUrl,
    mimeType: record.mimeType,
    timestamp: record.timestamp,
    encrypted: Boolean(record.encrypted),
    schemaVersion: record.schemaVersion,
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
  const [settings, pinSettings, videos, previewRecords, vaultMaterial] = await Promise.all([
    getBackupSettings(),
    getPinSettings(),
    getSavedVideos(true),
    getAllPreviewRecords(),
    getVaultMaterial()
  ]);
  const previews = await Promise.all(previewRecords.map(serializePreview));
  const createdAt = new Date();

  // A v2 envelope is detected by any preview carrying schemaVersion === 2.
  // Legacy backups (v1) had only `encrypted` flags.
  const hasV2Previews = previews.some(p => p.schemaVersion === 2);
  const hasEncryptedAny = previews.some(p => p.encrypted) || hasV2Previews;

  return {
    version: 2,
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
      algorithm: vaultMaterial?.algorithm ?? null,
      encryptedPreviewsPreserved: hasEncryptedAny
    },
    vaultMaterial: vaultMaterial ?? null,
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
