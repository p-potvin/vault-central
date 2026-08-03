/**
 * Worker-backed Argon2id runner for crypto-vault's KDF hook.
 *
 * Availability caveat: `Worker` is not exposed in a Chrome MV3 service worker
 * (ServiceWorkerGlobalScope has no Worker constructor). Firefox MV3 runs the
 * background as an event page, where it is available. So this probes for Worker
 * and reports whether it could install; when it cannot, crypto-vault keeps its
 * inline default and behaviour is exactly what it was before — correct, just on
 * the calling thread.
 */
import browser from 'webextension-polyfill';
import { setKdfRunner, type KdfRunner } from './crypto-vault';

const WORKER_URL_PATH = 'argon-worker.js';
/** Generous: a slow machine under load still finishes ~1.6s of Argon2id well inside this. */
const DERIVE_TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let seq = 0;

function workerSupported(): boolean {
  return typeof Worker === 'function';
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(browser.runtime.getURL(WORKER_URL_PATH));
  }
  return worker;
}

const workerKdfRunner: KdfRunner = (pin, salt, opts) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const id = `kdf_${++seq}`;
    const w = getWorker();

    const timeoutId = setTimeout(() => {
      w.removeEventListener('message', onMessage);
      reject(new Error('Key derivation timed out'));
    }, DERIVE_TIMEOUT_MS);

    const onMessage = (event: MessageEvent<any>) => {
      const data = event.data;
      if (!data || data.id !== id) return;
      clearTimeout(timeoutId);
      w.removeEventListener('message', onMessage);
      if (data.error) {
        reject(new Error(data.error));
        return;
      }
      resolve(data.key instanceof Uint8Array ? data.key : new Uint8Array(data.key));
    };

    w.addEventListener('message', onMessage);
    w.postMessage({ id, pin, salt, opts });
  });

/**
 * Install the worker-backed KDF when the environment supports it.
 * Returns true if installed, false if the caller is staying on the inline path.
 */
export function installWorkerKdf(): boolean {
  if (!workerSupported()) {
    console.info('[argon-kdf-host] Worker unavailable in this context; Argon2id stays inline.');
    return false;
  }
  try {
    setKdfRunner(workerKdfRunner);
    return true;
  } catch (err) {
    console.warn('[argon-kdf-host] Could not install worker KDF; staying inline.', err);
    setKdfRunner();
    return false;
  }
}

/** Drop the worker (and revert to inline derivation). Used when the vault is destroyed. */
export function disposeWorkerKdf(): void {
  setKdfRunner();
  worker?.terminate();
  worker = null;
}
