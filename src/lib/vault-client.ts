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

export async function savePreview(videoUrl: string, blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const arr = new Array(bytes.length);
  for(let i=0; i<bytes.length; i++) arr[i] = bytes[i];
  const res = await send({
    action: 'preview.save',
    videoUrl,
    blobBytes: arr,
    mimeType: blob.type,
  });
  if (!res.success) throw new Error(res.error || 'preview save failed');
}

export async function getPreview(videoUrl: string): Promise<Blob | null> {
    console.debug('[vault-client] getPreview requested for:', videoUrl);
    const res = await send<{ found: boolean; bytes?: number[]; mimeType?: string }>({
      action: 'preview.get',
      videoUrl,
    });
    console.debug('[vault-client] getPreview response for:', videoUrl, 'success:', res.success, 'found:', res.found);
    if (!res.success || !res.found || !res.bytes) return null;
    return new Blob([new Uint8Array(res.bytes!)], { type: res.mimeType || 'application/octet-stream' });
}

export async function deletePreview(videoUrl: string) {
  return send({ action: 'preview.delete', videoUrl });
}

export async function clearPreviews() {
  return send({ action: 'preview.clear_all' });
}
