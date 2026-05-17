import Dexie from 'dexie';
import CryptoJS from 'crypto-js';
export class VaultDexie extends Dexie {
    previews;
    constructor() {
        super('VaultPreviews');
        this.version(1).stores({
            previews: '++id, videoUrl, timestamp'
        });
    }
}
export const db = new VaultDexie();
const enableLogging = true;
function dbLog(...args) {
    if (enableLogging)
        console.log('[VaultDexie]', ...args);
}
/**
 * Save a plain Blob preview. PIN-disabled vaults store plaintext;
 * PIN-enabled vaults must call savePreviewEnvelope (background-side).
 * This function exists so non-encrypted callers (no PIN, or test code)
 * can write directly without going through the background.
 */
export async function savePreviewPlain(videoUrl, blob) {
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
export async function savePreviewEnvelope(videoUrl, envelope, mimeType) {
    await db.previews.where('videoUrl').equals(videoUrl).delete();
    await db.previews.add({
        videoUrl,
        blob: envelope,
        mimeType,
        timestamp: Date.now(),
        schemaVersion: 2,
    });
}
export async function deletePreview(videoUrl) {
    dbLog(`deletePreview ${videoUrl}`);
    await db.previews.where('videoUrl').equals(videoUrl).delete();
}
export async function clearPreviews() {
    dbLog('clearPreviews');
    await db.previews.clear();
}
export async function getAllPreviewRecords() {
    return db.previews.toArray();
}
/**
 * Returns the raw record for a video URL. Caller decides how to interpret
 * (plaintext blob vs envelope vs legacy CryptoJS) using the schemaVersion
 * and `encrypted` markers.
 */
export async function getPreviewRecord(videoUrl) {
    const record = await db.previews.where('videoUrl').equals(videoUrl).first();
    return record ?? null;
}
/**
 * Read a plaintext preview if the record is unencrypted. Returns null for
 * encrypted records (caller must go through the background's get_preview
 * runtime message which handles envelope decryption).
 */
export async function getPlainPreview(videoUrl) {
    const record = await getPreviewRecord(videoUrl);
    if (!record)
        return null;
    if (record.encrypted)
        return null; // legacy encrypted — needs migration via background
    if (record.schemaVersion === 2 && record.blob instanceof Uint8Array) {
        // v2 envelope without encryption marker still requires background to decrypt.
        // Plaintext v2 records store a Blob directly; envelopes store a Uint8Array.
        return null;
    }
    return record.blob;
}
/** Migration helper: list every record encrypted with the legacy CryptoJS scheme. */
export async function getLegacyEncryptedRecords() {
    return db.previews.filter(r => r.encrypted === true).toArray();
}
/**
 * Migration helper: decrypt a single legacy CryptoJS record using the old PIN.
 * Returns the plaintext Blob, ready to be re-encrypted with the new envelope.
 * Throws on decryption failure (caller should log and skip).
 */
export async function decryptLegacyRecord(record, legacyPin) {
    const encryptedStr = new TextDecoder().decode(record.blob);
    const decrypted = CryptoJS.AES.decrypt(encryptedStr, legacyPin);
    const sigBytes = decrypted.sigBytes;
    const words = decrypted.words;
    const out = new Uint8Array(sigBytes);
    for (let i = 0; i < sigBytes; i++) {
        out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    }
    return new Blob([out], { type: record.mimeType });
}
