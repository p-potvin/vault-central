import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureFrames, seekTo } from './frame-capture';

/**
 * Reproduces the two capture failures seen in the wild:
 *
 *  - A 34-minute video whose seeks never settled inside the old 1500ms budget.
 *    The old loop abandoned each seek and immediately issued the next, which
 *    supersedes the pending one, so the element never advanced past ~2 minutes
 *    and nearly every frame was drawn from a stale decoder.
 *  - Frames drawn before the decoder painted, which come out solid black.
 */

/** Minimal fake <video> with controllable seek latency. */
function makeFakeVideo(opts: {
  duration?: number;
  /** ms each seek takes to fire `seeked`; Infinity = never settles. */
  seekLatency?: number;
  readyState?: number;
} = {}) {
  const { duration = 2040, seekLatency = 0, readyState = 4 } = opts;
  const listeners: Record<string, Set<(e?: any) => void>> = {};
  let currentTime = 0;
  let pendingTimer: any = null;
  const seekTargets: number[] = [];

  const video: any = {
    duration,
    readyState,
    muted: false,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    addEventListener: (type: string, fn: any) => {
      (listeners[type] ??= new Set()).add(fn);
    },
    removeEventListener: (type: string, fn: any) => {
      listeners[type]?.delete(fn);
    },
    get currentTime() { return currentTime; },
    set currentTime(value: number) {
      seekTargets.push(value);
      // A new assignment supersedes any in-flight seek — this is the browser
      // behaviour the old loop tripped over.
      if (pendingTimer) clearTimeout(pendingTimer);
      if (seekLatency === Infinity) return;
      pendingTimer = setTimeout(() => {
        currentTime = value;
        listeners['seeked']?.forEach(fn => fn());
      }, seekLatency);
    },
    __seekTargets: seekTargets,
  };
  return video as HTMLVideoElement & { __seekTargets: number[] };
}

/** Canvas stub whose pixels are either a flat fill or varied. */
function stubCanvas(mode: 'blank' | 'image') {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({
      data: mode === 'blank'
        ? new Uint8ClampedArray(426 * 240 * 4) // all zero → uniform black
        : Uint8ClampedArray.from({ length: 426 * 240 * 4 }, (_, i) => i % 251),
    })),
  };
  const canvas = {
    width: 426,
    height: 240,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:image/webp;base64,STUB'),
  };
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? canvas : ({} as any)) as any);
  return { canvas, ctx };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('requestAnimationFrame', (cb: any) => setTimeout(cb, 0) as any);
});

describe('seekTo', () => {
  it('resolves true once the seek settles', async () => {
    const video = makeFakeVideo({ seekLatency: 10 });
    await expect(seekTo(video, 120, 1000)).resolves.toBe(true);
    expect(video.currentTime).toBe(120);
  });

  it('resolves false when the seek never settles, rather than pretending it did', async () => {
    const video = makeFakeVideo({ seekLatency: Infinity });
    await expect(seekTo(video, 120, 50)).resolves.toBe(false);
    expect(video.currentTime).toBe(0);
  });

  it('short-circuits when already at the requested position', async () => {
    const video = makeFakeVideo({ seekLatency: Infinity });
    await expect(seekTo(video, 0, 50)).resolves.toBe(true);
  });
});

describe('captureFrames', () => {
  it('captures a frame per sample point across the sampling window', async () => {
    stubCanvas('image');
    const video = makeFakeVideo({ duration: 2040, seekLatency: 1 });

    const result = await captureFrames(video, { frameCount: 10, seekTimeoutMs: 500 });

    expect(result.frames).toHaveLength(10);
    expect(result.timedOut).toBe(0);
    expect(result.blank).toBe(0);

    // Sampling must actually span the video, not stall near the start — this is
    // the regression where a 34-minute video never got past ~2 minutes.
    const targets = video.__seekTargets;
    expect(targets[0]).toBeCloseTo(204, 0);
    expect(targets[targets.length - 1]).toBeCloseTo(1836, 0);
  });

  it('drops blank frames instead of storing a preview full of black stills', async () => {
    stubCanvas('blank');
    const video = makeFakeVideo({ duration: 600, seekLatency: 1 });

    const result = await captureFrames(video, { frameCount: 10, seekTimeoutMs: 500 });

    expect(result.frames).toHaveLength(0);
    expect(result.blank).toBe(10);
  });

  it('skips frames whose seek timed out rather than capturing a stale decoder', async () => {
    stubCanvas('image');
    const video = makeFakeVideo({ duration: 2040, seekLatency: Infinity });

    const result = await captureFrames(video, { frameCount: 5, seekTimeoutMs: 20 });

    expect(result.frames).toHaveLength(0);
    expect(result.timedOut).toBe(5);
    expect(result.attempted).toBe(5);
  });

  it('falls back to a nominal duration when the element reports none', async () => {
    stubCanvas('image');
    const video = makeFakeVideo({ duration: NaN, seekLatency: 1 });

    const result = await captureFrames(video, { frameCount: 4, seekTimeoutMs: 500, fallbackDuration: 60 });

    expect(result.frames).toHaveLength(4);
    expect(video.__seekTargets[0]).toBeCloseTo(6, 0);   // 60 * 0.1
    expect(video.__seekTargets[3]).toBeCloseTo(54, 0);  // 60 * 0.9
  });
});
