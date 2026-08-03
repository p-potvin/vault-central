import browser from 'webextension-polyfill';
import {
  getAllPreviewRecords,
  savePreviewEnvelope,
  savePreviewPlain,
  type PreviewBlob
} from './dexie-store';
import {
  getBackupSettings,
  getPinSettings,
  getSavedVideos,
  getVaultMaterial,
  recordBackupResult,
  saveVaultMaterial,
  saveVideos,
  type BackupSettings
} from './storage-vault';
import { VideoDataSchema, type VaultMaterialPersisted } from '../types/schemas';

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

export type RestoreResult = {
  format: 'full-vault-backup' | 'metadata-array';
  videosAdded: number;
  videosSkipped: number;
  previewsRestored: number;
  previewsSkipped: number;
  vaultMaterialRestored: boolean;
  warnings: string[];
};

/** Narrow an unknown parsed JSON blob to a full backup without trusting it. */
export function isFullVaultBackup(json: unknown): json is FullVaultBackup {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  const candidate = json as Partial<FullVaultBackup>;
  return candidate.kind === 'full-vault-backup'
    && candidate.app === 'vault-central'
    && Array.isArray(candidate.videos);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Restore a full vault backup produced by createFullVaultBackup.
 *
 * This did not exist before Mon, 03 Aug 2026. `downloadFullVaultBackup` had been
 * writing daily backups containing videos, previews and vault material, but the
 * only importer in the UI required `Array.isArray(json)` — the metadata-only
 * "Export Vault JSON" shape. Feeding it a real full backup produced
 * "Backup must be a JSON array", so none of those backups were restorable.
 *
 * Videos merge by URL (existing entries win, so a restore never clobbers newer
 * local edits). Previews are written back in whatever form they were archived —
 * plaintext blob or encrypted envelope — since dexie-store records carry the
 * markers needed to interpret them later.
 *
 * `vaultMaterial` is only restored when the device has none. Overwriting live
 * material would strand every preview already encrypted under the current key,
 * so a conflict is reported as a warning instead.
 */
export async function restoreFullVaultBackup(json: unknown): Promise<RestoreResult> {
  const warnings: string[] = [];

  if (!isFullVaultBackup(json)) {
    throw new Error('Not a Vault Central full backup');
  }

  if (json.version !== 1 && json.version !== 2) {
    warnings.push(`Unrecognised backup version ${String(json.version)}; restoring on a best-effort basis.`);
  }

  // ---- videos ----
  const current = await getSavedVideos(true);
  const knownUrls = new Set(current.map(item => item.url));
  const additions: typeof current = [];
  let videosSkipped = 0;

  for (const raw of json.videos ?? []) {
    const parsed = VideoDataSchema.safeParse(raw);
    if (!parsed.success) { videosSkipped++; continue; }
    if (knownUrls.has(parsed.data.url)) { videosSkipped++; continue; }
    knownUrls.add(parsed.data.url);
    additions.push(parsed.data);
  }
  if (additions.length > 0) await saveVideos([...current, ...additions]);

  // ---- vault material ----
  let vaultMaterialRestored = false;
  if (json.vaultMaterial) {
    const existing = await getVaultMaterial();
    if (existing) {
      warnings.push('This device already has vault key material; kept it. Restoring the backup\'s keys would make previews encrypted under the current PIN unreadable.');
    } else {
      await saveVaultMaterial(json.vaultMaterial);
      vaultMaterialRestored = true;
    }
  }

  // ---- previews ----
  let previewsRestored = 0;
  let previewsSkipped = 0;

  for (const record of json.previews ?? []) {
    if (!record?.videoUrl || record.dataEncoding !== 'base64' || typeof record.data !== 'string') {
      previewsSkipped++;
      continue;
    }
    try {
      const bytes = base64ToUint8(record.data);
      if (bytes.length === 0) { previewsSkipped++; continue; }

      const isEnvelope = record.schemaVersion === 2 && !record.encrypted && json.security?.pinEnabled;
      if (record.encrypted || isEnvelope) {
        // Encrypted at rest — store the ciphertext untouched. It needs the
        // matching PIN/material to read, which is why material is restored first.
        await savePreviewEnvelope(record.videoUrl, bytes, record.mimeType);
      } else {
        await savePreviewPlain(record.videoUrl, new Blob([bytes as BlobPart], { type: record.mimeType }));
      }
      previewsRestored++;
    } catch (err) {
      console.warn('[backup-vault] Failed to restore preview for', record.videoUrl, err);
      previewsSkipped++;
    }
  }

  if (json.security?.encryptedPreviewsPreserved && !json.vaultMaterial && json.security?.pinEnabled) {
    warnings.push('Backup contains encrypted previews but no vault material. They can only be read on a device that still holds the original key.');
  }

  return {
    format: 'full-vault-backup',
    videosAdded: additions.length,
    videosSkipped,
    previewsRestored,
    previewsSkipped,
    vaultMaterialRestored,
    warnings,
  };
}

/** Restore the metadata-only array produced by "Export Vault JSON". */
export async function restoreMetadataArray(json: unknown): Promise<RestoreResult> {
  if (!Array.isArray(json)) throw new Error('Not a metadata backup array');

  const current = await getSavedVideos(true);
  const knownUrls = new Set(current.map(item => item.url));
  const additions: typeof current = [];
  let videosSkipped = 0;

  for (const raw of json) {
    const parsed = VideoDataSchema.safeParse(raw);
    if (!parsed.success) { videosSkipped++; continue; }
    if (knownUrls.has(parsed.data.url)) { videosSkipped++; continue; }
    knownUrls.add(parsed.data.url);
    additions.push(parsed.data);
  }
  if (additions.length > 0) await saveVideos([...current, ...additions]);

  return {
    format: 'metadata-array',
    videosAdded: additions.length,
    videosSkipped,
    previewsRestored: 0,
    previewsSkipped: 0,
    vaultMaterialRestored: false,
    warnings: [],
  };
}

/** Accepts either backup shape and dispatches to the right restorer. */
export async function restoreAnyBackup(json: unknown): Promise<RestoreResult> {
  if (Array.isArray(json)) return restoreMetadataArray(json);
  if (isFullVaultBackup(json)) return restoreFullVaultBackup(json);
  throw new Error('Unrecognised backup file');
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
    // Real error rethrows below for the caller to log; the persisted state
    // gets a generic message so it isn't surfaced through getBackupSettings.
    console.error('[backup-vault] downloadFullVaultBackup failed:', err);
    await recordBackupResult('error', 'Backup operation failed');
    throw err;
  }
}
