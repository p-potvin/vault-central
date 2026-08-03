import { describe, it, expect, beforeEach, vi } from 'vitest';
import browser from 'webextension-polyfill';
import { savePreview, getPreview } from './vault-client';
import { base64ToBytes, bytesToBase64 } from './storage-vault';

/**
 * Regression coverage for the preview transport between the dashboard /
 * offscreen processor and the background script.
 *
 * chrome.runtime.sendMessage JSON-serializes its payload. Any binary sent as a
 * Uint8Array arrives on the other side as a numeric-key plain object, and
 * rebuilding it with `new Uint8Array(obj)` produces a ZERO-LENGTH array — which
 * is how every stored preview ended up as a 0-byte blob that could never play.
 */

/** Mimics the extension messaging boundary: everything is JSON-serialized. */
function overTheWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe('runtime message boundary', () => {
  it('destroys a Uint8Array payload (the original bug)', () => {
    const original = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]); // WebM/EBML magic
    const received = overTheWire({ bytes: original }).bytes;

    expect(Array.isArray(received)).toBe(false);
    expect(received).toEqual({ 0: 0x1a, 1: 0x45, 2: 0xdf, 3: 0xa3 });
    // This is the line that silently emptied every preview.
    expect(new Uint8Array(received as any).length).toBe(0);
  });

  it('preserves a base64 payload byte-for-byte', () => {
    const original = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0xff]);
    const received = overTheWire({ b64: bytesToBase64(original) }).b64;
    expect(base64ToBytes(received)).toEqual(original);
  });
});

describe('savePreview / getPreview round trip', () => {
  // Stands in for the background's Dexie-backed preview store.
  const store = new Map<string, { blobB64: string; mimeType: string }>();

  /** Mirrors the preview.* handlers in background/scripts/background.ts. */
  function backgroundHandler(request: any) {
    if (request.action === 'preview.save') {
      const bytes = base64ToBytes(request.blobB64 ?? '');
      if (bytes.length === 0) return { success: false, error: 'Preview payload was empty' };
      store.set(request.videoUrl, { blobB64: bytesToBase64(bytes), mimeType: request.mimeType });
      return { success: true };
    }
    if (request.action === 'preview.get') {
      const record = store.get(request.videoUrl);
      if (!record) return { success: true, found: false };
      return { success: true, found: true, blobB64: record.blobB64, mimeType: record.mimeType };
    }
    return { success: false, error: 'unhandled' };
  }

  beforeEach(() => {
    store.clear();
    (browser.runtime.sendMessage as any) = vi.fn(async (payload: any) =>
      overTheWire(backgroundHandler(overTheWire(payload))),
    );
  });

  it('returns the exact bytes that were saved, with the mime type intact', async () => {
    const payload = new Uint8Array(4096);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;
    const source = new Blob([payload], { type: 'video/webm' });

    await savePreview('https://example.test/clip', source);
    const restored = await getPreview('https://example.test/clip');

    expect(restored).not.toBeNull();
    expect(restored!.type).toBe('video/webm');
    expect(restored!.size).toBe(source.size);
    expect(new Uint8Array(await restored!.arrayBuffer())).toEqual(payload);
  });

  it('round trips the WebP-frames JSON preview format', async () => {
    const frames = { isFrames: true, frames: Array.from({ length: 10 }, (_, i) => `data:image/webp;base64,AAAA${i}`) };
    const source = new Blob([JSON.stringify(frames)], { type: 'application/json' });

    await savePreview('https://example.test/frames', source);
    const restored = await getPreview('https://example.test/frames');

    expect(restored!.type).toBe('application/json');
    expect(JSON.parse(await restored!.text())).toEqual(frames);
  });

  it('returns null for a video with no stored preview', async () => {
    expect(await getPreview('https://example.test/missing')).toBeNull();
  });

  it('rejects an empty payload instead of storing a 0-byte preview', async () => {
    await expect(savePreview('https://example.test/empty', new Blob([], { type: 'video/webm' })))
      .rejects.toThrow(/empty/i);
    expect(store.has('https://example.test/empty')).toBe(false);
  });
});
