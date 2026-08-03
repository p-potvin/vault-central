/**
 * Shared hover-preview frame capture.
 *
 * Both capture sites (the offscreen processor and the scraper tab) had their own
 * copy of this loop, and both were wrong in the same way:
 *
 *   video.currentTime = target;
 *   await (seeked event OR 1500ms timeout);
 *   ctx.drawImage(video, ...);
 *
 * Two defects compound there.
 *
 * 1. Abandoning a seek after 1500ms does not cancel it. The next loop iteration
 *    assigns currentTime again, which supersedes the still-pending seek. When
 *    seeks take longer than the timeout — remote sources, HLS, large files — the
 *    element is perpetually re-seeking and never settles, so the position barely
 *    advances (observed: a 34-minute video that never got past ~2 minutes) and
 *    almost every frame is captured from a stale or empty decoder.
 *
 * 2. `seeked` fires when the seek lands, not when the decoder has painted. Draw
 *    at that moment and you get solid black.
 *
 * So: wait for the seek to genuinely complete, confirm the element is actually
 * sitting at the requested position with data, wait for a real paint, and skip
 * the frame rather than recording a stale one when any of that fails. Uniform
 * frames are dropped too — a preview full of black stills looks captured, so
 * nothing ever retries it.
 */

export interface FrameCaptureOptions {
  /** How many stills to sample. */
  frameCount?: number;
  /** Sampling window as a fraction of duration; avoids intros and credits. */
  startFraction?: number;
  endFraction?: number;
  width?: number;
  height?: number;
  /** Per-seek budget. Generous: an abandoned seek is what broke capture before. */
  seekTimeoutMs?: number;
  /** WebP quality for each still. */
  quality?: number;
  /** Fallback when the element reports no usable duration. */
  fallbackDuration?: number;
}

export interface FrameCaptureResult {
  /** Data URLs for frames that carried real imagery, in time order. */
  frames: string[];
  attempted: number;
  /** Seeks that never settled inside the budget. */
  timedOut: number;
  /** Frames that decoded to a single flat colour. */
  blank: number;
  /** Frames skipped because the canvas was tainted by a cross-origin source. */
  tainted: number;
}

const DEFAULTS = {
  frameCount: 10,
  startFraction: 0.1,
  endFraction: 0.9,
  width: 426,
  height: 240,
  seekTimeoutMs: 8000,
  quality: 0.5,
  fallbackDuration: 60,
} satisfies Required<FrameCaptureOptions>;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

/**
 * Resolve once the element has painted a frame for the current position.
 * requestVideoFrameCallback is the precise signal; elsewhere two animation
 * frames give a paint a chance to land. Both capped so a stalled decoder cannot
 * hang generation.
 */
export function waitForFramePaint(video: HTMLVideoElement, timeoutMs = 600): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    setTimeout(done, timeoutMs);

    const withCallback = video as VideoWithFrameCallback;
    if (typeof withCallback.requestVideoFrameCallback === 'function') {
      withCallback.requestVideoFrameCallback(done);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(done));
  });
}

/**
 * Seek and wait for it to complete. Resolves true when the element is sitting at
 * (approximately) the requested time with decodable data, false on timeout.
 *
 * The listener is attached before currentTime is assigned so a seek that
 * completes synchronously cannot be missed.
 */
export function seekTo(video: HTMLVideoElement, time: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
      resolve(ok);
    };

    const onSeeked = () => finish(true);
    const onError = () => finish(false);
    const timeoutId = setTimeout(() => finish(false), timeoutMs);

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);

    // Already there (within a frame's worth of tolerance) with data available.
    if (Math.abs(video.currentTime - time) < 0.05 && video.readyState >= 2) {
      finish(true);
      return;
    }

    try {
      video.currentTime = time;
    } catch {
      finish(false);
    }
  });
}

/**
 * True when every sampled pixel matches the first — a flat fill rather than real
 * imagery. Uses a prime stride so the sampling grid never aligns with the image;
 * a real frame diverges within the first few samples.
 */
export function isUniformCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): boolean {
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const stride = 4 * 97;
  const r0 = data[0], g0 = data[1], b0 = data[2];
  for (let i = stride; i < data.length; i += stride) {
    if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) return false;
  }
  return true;
}

/**
 * Sample stills across a loaded <video>. The element must already have metadata.
 * Returns only frames that carried real imagery, plus counts describing what was
 * dropped so callers can decide whether the result is worth storing.
 */
export async function captureFrames(
  video: HTMLVideoElement,
  options: FrameCaptureOptions = {},
): Promise<FrameCaptureResult> {
  const opts = { ...DEFAULTS, ...options };

  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { frames: [], attempted: 0, timedOut: 0, blank: 0, tainted: 0 };
  }

  const duration = (video.duration && isFinite(video.duration) && video.duration > 0)
    ? video.duration
    : opts.fallbackDuration;

  const start = duration * opts.startFraction;
  const end = duration * opts.endFraction;
  const step = opts.frameCount > 1 ? (end - start) / (opts.frameCount - 1) : 0;

  video.muted = true;
  // A brief play primes the decoder; without it the first seek often paints black.
  await video.play().catch(() => {});
  video.pause();

  const result: FrameCaptureResult = { frames: [], attempted: 0, timedOut: 0, blank: 0, tainted: 0 };

  for (let i = 0; i < opts.frameCount; i++) {
    const target = start + (i * step);
    result.attempted++;

    const settled = await seekTo(video, target, opts.seekTimeoutMs);
    if (!settled) {
      // Do not draw: the element is somewhere else entirely, and capturing here
      // is exactly how previews ended up full of duplicate stale frames.
      result.timedOut++;
      continue;
    }

    await waitForFramePaint(video);
    if (video.readyState < 2) { result.timedOut++; continue; }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      if (isUniformCanvas(ctx, canvas)) { result.blank++; continue; }
      result.frames.push(canvas.toDataURL('image/webp', opts.quality));
    } catch {
      // getImageData / toDataURL throw on a canvas tainted by a cross-origin
      // frame. Nothing recoverable per-frame; the whole run will be tainted.
      result.tainted++;
    }
  }

  return result;
}
