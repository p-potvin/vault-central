import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractDirectVideo, canExtractDirectVideoInPlace } from './direct-video-extract';
import * as frameCapture from './frame-capture';

/**
 * Direct media URLs used to require a visible scraper window purely because the
 * capture code lived in scraper-player.html. The page is ours, so any context
 * with a DOM can do the same work — which is what lets the background do it
 * silently. These tests pin the contract that both callers share.
 */

const VIDEO_URL = 'https://cdn.example.test/clip.mp4?token=abc';

function stubVideo() {
  const listeners: Record<string, Set<(e?: any) => void>> = {};
  const el: any = {
    duration: 600,
    muted: false,
    playsInline: false,
    preload: '',
    src: '',
    addEventListener: (t: string, fn: any) => { (listeners[t] ??= new Set()).add(fn); },
    removeEventListener: (t: string, fn: any) => { listeners[t]?.delete(fn); },
    removeAttribute: vi.fn(),
    load: vi.fn(() => {
      // Metadata arrives asynchronously, as it does in a real element.
      setTimeout(() => listeners['loadedmetadata']?.forEach(fn => fn()), 0);
    }),
  };
  return el as HTMLVideoElement;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob([new Uint8Array(4096)], { type: 'video/mp4' }),
  })));
  // Patch only the object-URL helpers; the URL constructor must keep working,
  // otherwise the hostname-derived `author` silently falls back and the
  // assertion below would pass for the wrong reason.
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('canExtractDirectVideoInPlace', () => {
  it('is true in a DOM context', () => {
    expect(canExtractDirectVideoInPlace()).toBe(true);
  });
});

describe('extractDirectVideo', () => {
  it('builds a frames payload the capture pipeline already understands', async () => {
    vi.spyOn(frameCapture, 'captureFrames').mockResolvedValue({
      frames: Array.from({ length: 10 }, (_, i) => `data:image/webp;base64,FRAME${i}`),
      attempted: 10, timedOut: 0, blank: 0, tainted: 0,
    });

    const result = await extractDirectVideo(VIDEO_URL, 'My Clip', stubVideo());

    expect(result.src).toBe(VIDEO_URL);
    expect(result.metadata.title).toBe('My Clip');
    expect(result.metadata.duration).toBe(600);
    expect(result.metadata.author).toBe('cdn.example.test');

    // The payload must stay a base64 application/json data URL: runCapturePipeline
    // detects a preview by exactly that prefix.
    expect(result.metadata.thumbnail.startsWith('data:application/json;base64,')).toBe(true);
    const decoded = JSON.parse(atob(result.metadata.thumbnail.split(',')[1]));
    expect(decoded.isFrames).toBe(true);
    expect(decoded.frames).toHaveLength(10);
  });

  it('survives non-ASCII titles that the old btoa chain would have mangled', async () => {
    vi.spyOn(frameCapture, 'captureFrames').mockResolvedValue({
      frames: Array.from({ length: 6 }, () => 'data:image/webp;base64,Ω≈ç√'),
      attempted: 6, timedOut: 0, blank: 0, tainted: 0,
    });

    const result = await extractDirectVideo(VIDEO_URL, 'Été — çà et là', stubVideo());
    const decoded = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(result.metadata.thumbnail.split(',')[1]), c => c.charCodeAt(0)),
    ));
    expect(decoded.frames[0]).toBe('data:image/webp;base64,Ω≈ç√');
    expect(result.metadata.title).toBe('Été — çà et là');
  });

  it('refuses to return a preview built from too few frames', async () => {
    vi.spyOn(frameCapture, 'captureFrames').mockResolvedValue({
      frames: ['data:image/webp;base64,A', 'data:image/webp;base64,B'],
      attempted: 10, timedOut: 8, blank: 0, tainted: 0,
    });

    await expect(extractDirectVideo(VIDEO_URL, 'Clip', stubVideo()))
      .rejects.toThrow(/refusing to store a broken preview/i);
  });

  it('propagates a failed fetch instead of storing an empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    await expect(extractDirectVideo(VIDEO_URL, 'Clip', stubVideo()))
      .rejects.toThrow(/Fetch failed: 403/);
  });
});
