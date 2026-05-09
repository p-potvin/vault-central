/**
 * Unlocked-vault state owner. Lives in the background script's memory only;
 * never persisted, never sent to other contexts. Other extension contexts
 * (dashboard, content) talk to the background via runtime messages declared
 * in background.ts: setup_vault / unlock_vault / lock_vault / vault_status /
 * encrypt_blob / decrypt_blob.
 *
 * Standard reference:
 *   vaultwares-docs/security/zero-knowledge-encryption-standard.mdx
 * Implementation:
 *   vault-themes/security/crypto-vault.ts
 */
import {
  setupVault as cryptoSetupVault,
  unlockVault as cryptoUnlockVault,
  encryptBlobWithUnlocked,
  decryptBlob,
  envelopeToBytes,
  envelopeFromBytes,
  type UnlockedVault,
  type VaultMaterial,
  type KemAlgorithm,
} from '../../vault-themes/security/crypto-vault';
import {
  bytesToBase64,
  base64ToBytes,
  getPinSettings,
  savePinSettings,
  getVaultMaterial,
  saveVaultMaterial,
  clearVaultMaterial,
} from './storage-vault';
import {
  savePreviewPlain,
  savePreviewEnvelope,
  getPreviewRecord,
  getLegacyEncryptedRecords,
  decryptLegacyRecord,
} from './dexie-store';
import { VaultMaterialPersisted } from '../types/schemas';

let unlocked: UnlockedVault | null = null;
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoLockTimer() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

async function startAutoLockTimer() {
  clearAutoLockTimer();
  const settings = await getPinSettings();
  if (settings.lockTimeout === -1) return; // never auto-lock
  autoLockTimer = setTimeout(() => {
    lockVault();
  }, settings.lockTimeout);
}

function persistedToRuntime(p: VaultMaterialPersisted): VaultMaterial {
  return {
    algorithm: p.algorithm,
    argonSalt: base64ToBytes(p.argonSalt),
    pinVerifier: base64ToBytes(p.pinVerifier),
    publicKey: p.publicKey ? base64ToBytes(p.publicKey) : undefined,
    wrappedPrivateKey: p.wrappedPrivateKey ? base64ToBytes(p.wrappedPrivateKey) : undefined,
    wrappedPrivateKeyIv: p.wrappedPrivateKeyIv ? base64ToBytes(p.wrappedPrivateKeyIv) : undefined,
  };
}

function runtimeToPersisted(m: VaultMaterial): VaultMaterialPersisted {
  return {
    schemaVersion: 1,
    algorithm: m.algorithm,
    argonSalt: bytesToBase64(m.argonSalt),
    pinVerifier: bytesToBase64(m.pinVerifier),
    publicKey: m.publicKey ? bytesToBase64(m.publicKey) : undefined,
    wrappedPrivateKey: m.wrappedPrivateKey ? bytesToBase64(m.wrappedPrivateKey) : undefined,
    wrappedPrivateKeyIv: m.wrappedPrivateKeyIv ? bytesToBase64(m.wrappedPrivateKeyIv) : undefined,
  };
}

export function isVaultUnlocked(): boolean {
  return unlocked !== null;
}

export function getUnlockedVault(): UnlockedVault | null {
  return unlocked;
}

export function lockVault(): void {
  unlocked = null;
  clearAutoLockTimer();
}

/** Provision a brand-new vault from a chosen PIN. Replaces any existing material. */
export async function setupVault(pin: string, algorithm: KemAlgorithm = 'ml-kem-1024'): Promise<void> {
  const material = await cryptoSetupVault(pin, algorithm);
  await saveVaultMaterial(runtimeToPersisted(material));
  unlocked = (await cryptoUnlockVault(pin, material))!;
  // Drop any legacy plaintext PIN, keep policy fields.
  const settings = await getPinSettings();
  await savePinSettings({ ...settings, enabled: true, pin: undefined, lastUnlocked: Date.now() });
  await startAutoLockTimer();
}

/**
 * Verify the PIN and unlock the vault. Handles migration from the legacy
 * plaintext-PIN system: if no VaultMaterial exists but pinSettings.pin
 * matches the entered PIN, set up new material on the fly with the same PIN
 * and trigger a one-time re-encryption pass for any legacy ciphertext.
 *
 * Returns true on success, false on wrong PIN.
 */
export async function unlockVault(pin: string): Promise<boolean> {
  const persisted = await getVaultMaterial();

  if (persisted) {
    const material = persistedToRuntime(persisted);
    const u = await cryptoUnlockVault(pin, material);
    if (!u) return false;
    unlocked = u;
    const settings = await getPinSettings();
    await savePinSettings({ ...settings, lastUnlocked: Date.now() });
    await startAutoLockTimer();
    return true;
  }

  // No new material — try legacy migration path.
  const settings = await getPinSettings();
  if (settings.enabled && settings.pin && settings.pin === pin) {
    const legacyRecords = await getLegacyEncryptedRecords();
    if (legacyRecords.length > 0) {
      // Need the old PIN in scope to decrypt — do migration before we
      // touch pinSettings or set up new material.
      await migrateLegacyPreviewsAndProvision(pin, legacyRecords);
    } else {
      // No legacy data to preserve — just provision fresh material.
      await setupVault(pin);
    }
    return true;
  }

  return false;
}

/**
 * One-time legacy migration: provision new material AND re-encrypt every
 * legacy CryptoJS preview using the old PIN (still in scope from the unlock
 * call). Failed records are logged and dropped. After this returns, the
 * vault is unlocked with the new material and the legacy PIN field is
 * cleared.
 */
async function migrateLegacyPreviewsAndProvision(legacyPin: string, legacyRecords: { videoUrl: string; mimeType: string; blob: Blob | Uint8Array }[]): Promise<void> {
  console.log(`[vault-runtime] Migrating ${legacyRecords.length} legacy-encrypted previews...`);
  const newMaterial = await cryptoSetupVault(legacyPin, 'ml-kem-1024');
  const newVault = (await cryptoUnlockVault(legacyPin, newMaterial))!;

  let migrated = 0;
  for (const record of legacyRecords) {
    try {
      const plain = await decryptLegacyRecord(record as any, legacyPin);
      const plainBytes = new Uint8Array(await plain.arrayBuffer());
      const env = await encryptBlobWithUnlocked(plainBytes, newVault);
      await savePreviewEnvelope(record.videoUrl, envelopeToBytes(env), plain.type);
      migrated++;
    } catch (e) {
      console.warn(`[vault-runtime] Failed to migrate preview ${record.videoUrl}; dropping.`, e);
    }
  }

  await saveVaultMaterial(runtimeToPersisted(newMaterial));
  unlocked = newVault;
  const settings = await getPinSettings();
  await savePinSettings({ ...settings, enabled: true, pin: undefined, lastUnlocked: Date.now() });
  await startAutoLockTimer();
  console.log(`[vault-runtime] Migration complete: ${migrated}/${legacyRecords.length} previews re-encrypted.`);
}

/** Encrypt a blob and return a Uint8Array envelope ready for storage. */
export async function encryptForStorage(plain: Uint8Array): Promise<Uint8Array> {
  if (!unlocked) throw new Error('Vault is locked');
  const env = await encryptBlobWithUnlocked(plain, unlocked);
  return envelopeToBytes(env);
}

/** Decrypt a stored envelope back to plaintext. */
export async function decryptFromStorage(envelopeBytes: Uint8Array): Promise<Uint8Array> {
  if (!unlocked) throw new Error('Vault is locked');
  const env = envelopeFromBytes(envelopeBytes);
  return decryptBlob(env, unlocked);
}

export async function vaultStatus(): Promise<{
  enabled: boolean;
  locked: boolean;
  algorithm: KemAlgorithm | null;
  hasMaterial: boolean;
}> {
  const settings = await getPinSettings();
  const material = await getVaultMaterial();
  return {
    enabled: settings.enabled,
    locked: !unlocked,
    algorithm: material?.algorithm ?? null,
    hasMaterial: !!material,
  };
}

/**
 * Save a preview blob. Encrypts via the unlocked envelope when PIN is
 * enabled; stores plaintext when PIN is disabled. Throws when PIN is
 * enabled but the vault is locked — caller must unlock first.
 */
export async function savePreviewBlob(videoUrl: string, blob: Blob): Promise<void> {
  const settings = await getPinSettings();
  if (!settings.enabled) {
    await savePreviewPlain(videoUrl, blob);
    return;
  }
  if (!unlocked) throw new Error('Vault is locked');
  const plainBytes = new Uint8Array(await blob.arrayBuffer());
  const envelopeBytes = await encryptForStorage(plainBytes);
  await savePreviewEnvelope(videoUrl, envelopeBytes, blob.type);
}

/**
 * Read a preview blob. Decrypts envelope when needed; returns plaintext
 * directly otherwise. Returns null when the record is missing OR the vault
 * is locked OR the record is a legacy CryptoJS record awaiting migration.
 */
export async function getPreviewBlob(videoUrl: string): Promise<Blob | null> {
  const record = await getPreviewRecord(videoUrl);
  if (!record) return null;
  if (record.encrypted) return null; // legacy — migration runs on next unlock
  if (record.blob instanceof Blob) return record.blob; // plaintext v2
  // Uint8Array → envelope
  if (!unlocked) return null;
  const plain = await decryptFromStorage(record.blob as Uint8Array);
  return new Blob([plain as BlobPart], { type: record.mimeType });
}

/** Tear down vault entirely (used by Wipe Vault). */
export async function destroyVault(): Promise<void> {
  lockVault();
  await clearVaultMaterial();
  const settings = await getPinSettings();
  await savePinSettings({ ...settings, enabled: false, pin: undefined, lastUnlocked: undefined });
}
