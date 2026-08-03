/**
 * Client-side helpers for the vault runtime. Non-background extension
 * contexts (dashboard, offscreen processor) use these to talk to the
 * background's vault-runtime via runtime.sendMessage. The background
 * never trusts these helpers — it just exposes a typed surface.
 *
 * Background context should import from vault-runtime.ts directly, not
 * via these helpers (saves a round trip).
 */
import browser from 'webextension-polyfill';
import { bytesToBase64, base64ToBytes } from './storage-vault';

interface RuntimeResponse<T = unknown> {
  success: boolean;
  error?: string;
}
type WithFields<T> = RuntimeResponse & T;

async function send<T>(payload: any): Promise<WithFields<T>> {
  const res = (await browser.runtime.sendMessage(payload)) as any;
  return res as WithFields<T>;
}

export async function vaultSetup(pin: string, algorithm: 'ml-kem-1024' | 'ml-kem-512' | 'aes-only' = 'ml-kem-1024') {
  return send({ action: 'vault.setup', pin, algorithm });
}

export async function vaultUnlock(pin: string) {
  return send<{ success: boolean }>({ action: 'vault.unlock', pin });
}

export async function vaultLock() {
  return send({ action: 'vault.lock' });
}

export async function vaultDestroy() {
  return send({ action: 'vault.destroy' });
}

export async function vaultStatus() {
  return send<{ enabled: boolean; locked: boolean; algorithm: string | null; hasMaterial: boolean }>({ action: 'vault.status' });
}

/**
 * Binary payloads MUST cross the runtime-message boundary as base64 strings.
 * chrome.runtime.sendMessage JSON-serializes its argument: a Uint8Array arrives
 * as a numeric-key plain object ({"0":12,"1":34,…}), and `new Uint8Array(obj)`
 * on that object yields a ZERO-LENGTH array — silently destroying the preview.
 * Same reasoning as the base64 codec used for VaultMaterial in storage-vault.ts.
 */
export async function savePreview(videoUrl: string, blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const res = await send({
    action: 'preview.save',
    videoUrl,
    blobB64: bytesToBase64(bytes),
    mimeType: blob.type,
  });
  if (!res.success) throw new Error(res.error || 'preview save failed');
}

export async function getPreview(videoUrl: string): Promise<Blob | null> {
    console.debug('[vault-client] getPreview requested for:', videoUrl);
    const res = await send<{ found: boolean; blobB64?: string; mimeType?: string }>({
      action: 'preview.get',
      videoUrl,
    });
    console.debug('[vault-client] getPreview response for:', videoUrl, 'success:', res.success, 'found:', res.found);
    if (!res.success || !res.found || !res.blobB64) return null;
    const bytes = base64ToBytes(res.blobB64);
    if (bytes.length === 0) {
      console.warn('[vault-client] getPreview decoded an empty payload for:', videoUrl);
      return null;
    }
    return new Blob([bytes as BlobPart], { type: res.mimeType || 'application/octet-stream' });
}

export async function deletePreview(videoUrl: string) {
  return send({ action: 'preview.delete', videoUrl });
}

export async function clearPreviews() {
  return send({ action: 'preview.clear_all' });
}
