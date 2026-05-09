import Dexie, { Table } from 'dexie';
import CryptoJS from 'crypto-js';

/**
 * Preview-blob persistence.
 *
 * v1 (legacy): blob is either plaintext (PIN disabled) or CryptoJS-AES
 * encrypted with the raw PIN as the key. `encrypted: true` flagged the
 * encrypted variant.
 *
 * v2 (current): preview is an envelope-encrypted Uint8Array per the
 * zero-knowledge standard (vault-themes/security/crypto-vault.ts).
 * `schemaVersion: 2` flags the new format. The encryption itself is
 * performed by the background script's vault-runtime; dexie-store only
 * persists the envelope bytes.
 *
 * Legacy records are migrated on first new-flow PIN unlock by
 * vault-runtime, which decrypts with the old PIN and re-encrypts via
 * envelope encryption before clearing the legacy PIN field.
 */
export interface PreviewBlob {
  id?: number;
  videoUrl: string;
  blob: Blob | Uint8Array;
  mimeType: string;
  timestamp: number;
  /** legacy flag — only set on v1 records */
  encrypted?: boolean;
  /** v2+ records carry this. Absent on v1. */
  schemaVersion?: number;
}

export class VaultDexie extends Dexie {
  previews!: Table<PreviewBlob>;

  constructor() {
    super('VaultPreviews');
    this.version(1).stores({
      previews: '++id, videoUrl, timestamp'
    });
  }
}

export const db = new VaultDexie();

const enableLogging = true;
function dbLog(...args: any[]) {
  if (enableLogging) console.log('[VaultDexie]', ...args);
}

/**
 * Save a plain Blob preview. PIN-disabled vaults store plaintext;
 * PIN-enabled vaults must call savePreviewEnvelope (background-side).
 * This function exists so non-encrypted callers (no PIN, or test code)
 * can write directly without going through the background.
 */
export async function savePreviewPlain(videoUrl: string, blob: Blob): Promise<void> {
  await db.previews.where('videoUrl').equals(videoUrl).delete();
  await db.previews.add({
    videoUrl,
    blob,
    mimeType: blob.type,
    timestamp: Date.now(),
    schemaVersion: 2,
  });
}

/** Save an already-encrypted envelope produced by vault-runtime. */
export async function savePreviewEnvelope(videoUrl: string, envelope: Uint8Array, mimeType: string): Promise<void> {
  await db.previews.where('videoUrl').equals(videoUrl).delete();
  await db.previews.add({
    videoUrl,
    blob: envelope,
    mimeType,
    timestamp: Date.now(),
    schemaVersion: 2,
  });
}

export async function deletePreview(videoUrl: string): Promise<void> {
  dbLog(`deletePreview ${videoUrl}`);
  await db.previews.where('videoUrl').equals(videoUrl).delete();
}

export async function clearPreviews(): Promise<void> {
  dbLog('clearPreviews');
  await db.previews.clear();
}

export async function getAllPreviewRecords(): Promise<PreviewBlob[]> {
  return db.previews.toArray();
}

/**
 * Returns the raw record for a video URL. Caller decides how to interpret
 * (plaintext blob vs envelope vs legacy CryptoJS) using the schemaVersion
 * and `encrypted` markers.
 */
export async function getPreviewRecord(videoUrl: string): Promise<PreviewBlob | null> {
  const record = await db.previews.where('videoUrl').equals(videoUrl).first();
  return record ?? null;
}

/**
 * Read a plaintext preview if the record is unencrypted. Returns null for
 * encrypted records (caller must go through the background's get_preview
 * runtime message which handles envelope decryption).
 */
export async function getPlainPreview(videoUrl: string): Promise<Blob | null> {
  const record = await getPreviewRecord(videoUrl);
  if (!record) return null;
  if (record.encrypted) return null;     // legacy encrypted — needs migration via background
  if (record.schemaVersion === 2 && record.blob instanceof Uint8Array) {
    // v2 envelope without encryption marker still requires background to decrypt.
    // Plaintext v2 records store a Blob directly; envelopes store a Uint8Array.
    return null;
  }
  return record.blob as Blob;
}

/** Migration helper: list every record encrypted with the legacy CryptoJS scheme. */
export async function getLegacyEncryptedRecords(): Promise<PreviewBlob[]> {
  return db.previews.filter(r => r.encrypted === true).toArray();
}

/**
 * Migration helper: decrypt a single legacy CryptoJS record using the old PIN.
 * Returns the plaintext Blob, ready to be re-encrypted with the new envelope.
 * Throws on decryption failure (caller should log and skip).
 */
export async function decryptLegacyRecord(record: PreviewBlob, legacyPin: string): Promise<Blob> {
  const encryptedStr = new TextDecoder().decode(record.blob as Uint8Array);
  const decrypted = CryptoJS.AES.decrypt(encryptedStr, legacyPin);
  const sigBytes = decrypted.sigBytes;
  const words = decrypted.words;
  const out = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i++) {
    out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return new Blob([out], { type: record.mimeType });
}
