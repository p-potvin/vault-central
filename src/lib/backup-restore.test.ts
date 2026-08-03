import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isFullVaultBackup, restoreAnyBackup } from './backup-vault';
import * as storageVault from './storage-vault';
import * as dexieStore from './dexie-store';

/**
 * Regression coverage for full-backup restore.
 *
 * `downloadFullVaultBackup` had been writing daily backups (videos + previews +
 * vault material) since before this test existed, but the only importer in the
 * UI required `Array.isArray(json)` — the metadata-only export shape. A real
 * full backup was rejected with "Backup must be a JSON array", so every daily
 * backup on disk was unrestorable.
 */

vi.mock('./storage-vault', () => ({
  getSavedVideos: vi.fn(),
  saveVideos: vi.fn(),
  getVaultMaterial: vi.fn(),
  saveVaultMaterial: vi.fn(),
  getBackupSettings: vi.fn(),
  getPinSettings: vi.fn(),
  recordBackupResult: vi.fn(),
}));

vi.mock('./dexie-store', () => ({
  getAllPreviewRecords: vi.fn(),
  savePreviewPlain: vi.fn(),
  savePreviewEnvelope: vi.fn(),
}));

const framesPayload = JSON.stringify({
  isFrames: true,
  frames: Array.from({ length: 10 }, (_, i) => `data:image/webp;base64,AAAA${i}`),
});
const framesBase64 = btoa(framesPayload);

function makeVideo(url: string) {
  return { url, title: `Title for ${url}`, timestamp: 1_750_000_000_000 };
}

/** Mirrors the real file: version 2, PIN disabled, plaintext frame previews. */
function makeFullBackup(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    app: 'vault-central',
    kind: 'full-vault-backup',
    source: 'automatic',
    createdAt: '2026-08-01T06:59:59.903Z',
    createdAtMs: 1_754_031_599_903,
    backupSettings: { folder: '', dailyEnabled: true },
    security: { pinEnabled: false, algorithm: null, encryptedPreviewsPreserved: true },
    vaultMaterial: null,
    videos: [makeVideo('https://example.test/a'), makeVideo('https://example.test/b')],
    previews: [
      { videoUrl: 'https://example.test/a', mimeType: 'application/json', timestamp: 1, encrypted: false, schemaVersion: 2, dataEncoding: 'base64', data: framesBase64 },
    ],
    ...overrides,
  };
}

describe('backup format detection', () => {
  it('recognises a full vault backup', () => {
    expect(isFullVaultBackup(makeFullBackup())).toBe(true);
  });

  it('rejects the metadata-only array, a bare object, and junk', () => {
    expect(isFullVaultBackup([makeVideo('https://example.test/a')])).toBe(false);
    expect(isFullVaultBackup({ videos: [] })).toBe(false);
    expect(isFullVaultBackup(null)).toBe(false);
  });
});

describe('restoreAnyBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageVault.getSavedVideos as any).mockResolvedValue([]);
    (storageVault.saveVideos as any).mockResolvedValue(undefined);
    (storageVault.getVaultMaterial as any).mockResolvedValue(null);
    (storageVault.saveVaultMaterial as any).mockResolvedValue(undefined);
    (dexieStore.savePreviewPlain as any).mockResolvedValue(undefined);
    (dexieStore.savePreviewEnvelope as any).mockResolvedValue(undefined);
  });

  it('restores videos and previews from a full backup', async () => {
    const result = await restoreAnyBackup(makeFullBackup());

    expect(result.format).toBe('full-vault-backup');
    expect(result.videosAdded).toBe(2);
    expect(result.previewsRestored).toBe(1);
    expect(storageVault.saveVideos).toHaveBeenCalledOnce();

    // PIN disabled → plaintext blob, not an envelope.
    expect(dexieStore.savePreviewPlain).toHaveBeenCalledOnce();
    expect(dexieStore.savePreviewEnvelope).not.toHaveBeenCalled();
    const [url, blob] = (dexieStore.savePreviewPlain as any).mock.calls[0];
    expect(url).toBe('https://example.test/a');
    expect(blob.type).toBe('application/json');
    expect(blob.size).toBe(framesPayload.length);
  });

  it('never clobbers an existing local item with a backup copy', async () => {
    (storageVault.getSavedVideos as any).mockResolvedValue([makeVideo('https://example.test/a')]);

    const result = await restoreAnyBackup(makeFullBackup());

    expect(result.videosAdded).toBe(1);
    expect(result.videosSkipped).toBe(1);
    const saved = (storageVault.saveVideos as any).mock.calls[0][0];
    expect(saved).toHaveLength(2);
  });

  it('stores encrypted previews as envelopes and restores vault material', async () => {
    const backup = makeFullBackup({
      security: { pinEnabled: true, algorithm: 'ml-kem-1024', encryptedPreviewsPreserved: true },
      vaultMaterial: { schemaVersion: 1, algorithm: 'ml-kem-1024', argonSalt: 'AAAA', pinVerifier: 'BBBB' },
    });

    const result = await restoreAnyBackup(backup);

    expect(result.vaultMaterialRestored).toBe(true);
    expect(storageVault.saveVaultMaterial).toHaveBeenCalledOnce();
    expect(dexieStore.savePreviewEnvelope).toHaveBeenCalledOnce();
    expect(dexieStore.savePreviewPlain).not.toHaveBeenCalled();
  });

  it('keeps existing vault material and warns instead of overwriting it', async () => {
    (storageVault.getVaultMaterial as any).mockResolvedValue({ schemaVersion: 1, algorithm: 'ml-kem-1024', argonSalt: 'ZZZZ', pinVerifier: 'YYYY' });
    const backup = makeFullBackup({
      vaultMaterial: { schemaVersion: 1, algorithm: 'ml-kem-1024', argonSalt: 'AAAA', pinVerifier: 'BBBB' },
    });

    const result = await restoreAnyBackup(backup);

    expect(result.vaultMaterialRestored).toBe(false);
    expect(storageVault.saveVaultMaterial).not.toHaveBeenCalled();
    expect(result.warnings.join(' ')).toMatch(/already has vault key material/i);
  });

  it('still accepts the metadata-only export array', async () => {
    const result = await restoreAnyBackup([makeVideo('https://example.test/a')]);

    expect(result.format).toBe('metadata-array');
    expect(result.videosAdded).toBe(1);
    expect(dexieStore.savePreviewPlain).not.toHaveBeenCalled();
  });

  it('skips corrupt preview records without aborting the restore', async () => {
    const backup = makeFullBackup({
      previews: [
        { videoUrl: 'https://example.test/a', mimeType: 'application/json', timestamp: 1, encrypted: false, dataEncoding: 'base64', data: framesBase64 },
        { videoUrl: '', mimeType: 'application/json', timestamp: 1, encrypted: false, dataEncoding: 'base64', data: framesBase64 },
        { videoUrl: 'https://example.test/b', mimeType: 'application/json', timestamp: 1, encrypted: false, dataEncoding: 'raw', data: 'nope' },
      ],
    });

    const result = await restoreAnyBackup(backup);

    expect(result.previewsRestored).toBe(1);
    expect(result.previewsSkipped).toBe(2);
  });

  it('rejects a file that is neither shape', async () => {
    await expect(restoreAnyBackup({ hello: 'world' })).rejects.toThrow(/Unrecognised backup file/);
  });
});
