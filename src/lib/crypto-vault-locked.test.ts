import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  setupVault,
  unlockVault,
  encryptBlobWithPublicKey,
  encryptBlobWithUnlocked,
  decryptBlob,
  setKdfRunner,
  type KdfRunner,
} from './crypto-vault';

/**
 * Covers the two changes made on Mon, 03 Aug 2026:
 *   1. Encryption needs only the ML-KEM public key, so a locked vault can still
 *      accept writes.
 *   2. Argon2id derivation is behind a swappable runner so the host can move it
 *      off the calling thread.
 */

const PIN = '1234';
const SAMPLE = new TextEncoder().encode('preview payload written while locked');
const TEST_TIMEOUT = 60_000;

afterEach(() => setKdfRunner());

describe('encrypting without an unlocked vault', { timeout: TEST_TIMEOUT }, () => {
  it('encrypts with only the public key, and the PIN still decrypts it', async () => {
    const material = await setupVault(PIN, 'ml-kem-1024');

    // No unlocked vault in scope — exactly the locked-capture case.
    const env = await encryptBlobWithPublicKey(SAMPLE, material.algorithm, material.publicKey!);
    expect(env.kemCiphertext).toBeDefined();

    const vault = await unlockVault(PIN, material);
    const plain = await decryptBlob(env, vault!);
    expect(new TextDecoder().decode(plain)).toBe(new TextDecoder().decode(SAMPLE));
  });

  it('produces envelopes indistinguishable in shape from the unlocked path', async () => {
    const material = await setupVault(PIN, 'ml-kem-1024');
    const vault = (await unlockVault(PIN, material))!;

    const lockedEnv = await encryptBlobWithPublicKey(SAMPLE, material.algorithm, material.publicKey!);
    const unlockedEnv = await encryptBlobWithUnlocked(SAMPLE, vault);

    expect(lockedEnv.algorithm).toBe(unlockedEnv.algorithm);
    expect(lockedEnv.kemCiphertext!.length).toBe(unlockedEnv.kemCiphertext!.length);
    expect(lockedEnv.wrappedDek.length).toBe(unlockedEnv.wrappedDek.length);
    expect(lockedEnv.payload.length).toBe(unlockedEnv.payload.length);

    // Both must decrypt with the same vault.
    expect(new TextDecoder().decode(await decryptBlob(lockedEnv, vault))).toBe(new TextDecoder().decode(SAMPLE));
    expect(new TextDecoder().decode(await decryptBlob(unlockedEnv, vault))).toBe(new TextDecoder().decode(SAMPLE));
  });

  it('refuses for aes-only vaults, which have no asymmetric key', async () => {
    const material = await setupVault(PIN, 'aes-only');
    expect(material.publicKey).toBeUndefined();
    await expect(encryptBlobWithPublicKey(SAMPLE, 'aes-only', new Uint8Array(32)))
      .rejects.toThrow(/cannot encrypt while locked/i);
  });
});

describe('KDF runner hook', { timeout: TEST_TIMEOUT }, () => {
  it('routes derivation through an installed runner', async () => {
    const runner = vi.fn<KdfRunner>(async (pin, salt, opts) => {
      const { argon2id } = await import('@noble/hashes/argon2.js');
      return argon2id(pin, salt, opts);
    });
    setKdfRunner(runner);

    const material = await setupVault(PIN, 'aes-only');
    expect(runner).toHaveBeenCalled();
    // Options must be passed through untouched — a runner that weakened them
    // would silently downgrade every vault.
    expect(runner.mock.calls[0][2]).toEqual({ t: 3, m: 64 * 1024, p: 1, dkLen: 32 });

    const vault = await unlockVault(PIN, material);
    expect(vault).not.toBeNull();
  });

  it('rejects a runner that returns the wrong key length', async () => {
    setKdfRunner(async () => new Uint8Array(16));
    await expect(setupVault(PIN, 'aes-only')).rejects.toThrow(/wrong length/i);
  });

  it('restores the inline default when cleared', async () => {
    const runner = vi.fn<KdfRunner>(async () => new Uint8Array(32));
    setKdfRunner(runner);
    setKdfRunner();

    const material = await setupVault(PIN, 'aes-only');
    expect(runner).not.toHaveBeenCalled();
    expect(await unlockVault(PIN, material)).not.toBeNull();
  });
});
