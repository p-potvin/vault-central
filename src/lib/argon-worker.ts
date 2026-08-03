/**
 * argon-worker.ts — runs the Argon2id KEK derivation off the main thread.
 *
 * Derivation takes ~1.6s by design (it is the only thing standing between a
 * 4-digit PIN and an offline sweep of all 10,000 candidates). @noble's argon2id
 * is synchronous, so calling it directly stalls whichever thread the caller is
 * on — for the extension that is the background worker, which also serves every
 * preview.get, capture and vault message. A dedicated Worker keeps that thread
 * responsive while the cost is paid.
 *
 * The PIN crosses into this worker. That is the same trust boundary as the
 * caller — same extension, same origin — and neither the PIN nor the derived key
 * is retained here after the response is posted.
 *
 * Bundled to dist/argon-worker.js by the esbuild step in package.json.
 */
import { argon2id } from '@noble/hashes/argon2.js';

type DeriveRequest = {
  id: string;
  pin: string;
  salt: Uint8Array;
  opts: { t: number; m: number; p: number; dkLen: number };
};

self.addEventListener('message', (event: MessageEvent<DeriveRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg.id !== 'string') return;

  try {
    // Structured clone can hand us a plain object for the salt depending on the
    // sender; normalise before it reaches the KDF.
    const salt = msg.salt instanceof Uint8Array ? msg.salt : new Uint8Array(Object.values(msg.salt ?? {}) as number[]);
    const key = argon2id(msg.pin, salt, msg.opts);
    (self as unknown as Worker).postMessage({ id: msg.id, key }, [key.buffer as ArrayBuffer]);
  } catch (err: any) {
    // Never echo the PIN or partial key material back in an error.
    (self as unknown as Worker).postMessage({ id: msg.id, error: 'Key derivation failed' });
  }
});
