/**
 * Preview generation, independent of which document it runs in.
 *
 * Chrome MV3 service workers have no DOM, so this runs inside an offscreen
 * document there. Firefox MV3 background scripts are an event page with a real
 * DOM, so the background calls it directly — no offscreen API, no iframe, no
 * message hop. Same code either way; only the host differs.
 */
import Hls from 'hls.js';
import { captureFrames, type FrameCaptureResult } from './frame-capture';

/**
 * Below this many usable frames the result is not worth storing: a stalling seek
 * loop reliably yields one or two good stills, and persisting that stops anything
 * from ever retrying the item.
 */
export const MIN_USABLE_FRAMES = 4;

/**
 * Frames sampled per preview.
 *
 * Measured from real captures at 426x240, WebP q0.5: a frame is ~4.5 KB raw and
 * ~6.7 KB once base64'd into the JSON payload (data URLs cost 4/3). Observed
 * 10-frame payloads were 47-92 KB.
 *
 *    30 frames ~ 200 KB per video
 *    60 frames ~ 400 KB per video
 *
 * At 60 frames and the 150ms hover cadence the loop runs ~9s, which is what
 * makes the preview read as motion rather than a slideshow. 400 KB x 1000 videos
 * is ~400 MB; the manifest holds "unlimitedStorage", so Firefox exempts the
 * extension from quota eviction and the practical ceiling is free disk.
 */
export const DEFAULT_FRAME_COUNT = 60;

const LOAD_TIMEOUT_MS = 90_000;

export interface PreviewGenerationResult {
  blob: Blob | null;
  capture?: FrameCaptureResult;
  reason?: string;
}

function isHlsUrl(mediaUrl: string): boolean {
  return mediaUrl.includes('.m3u8') || mediaUrl.includes('manifest');
}

/**
 * Produce the frames payload for a media URL, or null when the source could not
 * be captured well enough to be worth storing.
 */
export async function generatePreview(
  mediaUrl: string,
  frameCount: number = DEFAULT_FRAME_COUNT,
): Promise<PreviewGenerationResult> {
  const hls = isHlsUrl(mediaUrl);
  let objectUrl = '';

  if (!hls) {
    // Fetch to a blob first so seeks are local. Seeking a remote source directly
    // means a range request per seek, which is what made capture crawl.
    const response = await fetch(mediaUrl, { headers: { 'User-Agent': navigator.userAgent } });
    if (!response.ok) return { blob: null, reason: `fetch failed: ${response.status}` };

    const videoBlob = await response.blob();
    if (videoBlob.size < 1000) return { blob: null, reason: 'fetched body too small (blocked?)' };
    objectUrl = URL.createObjectURL(videoBlob);
  }

  return new Promise<PreviewGenerationResult>((resolve) => {
    let hlsInstance: Hls | null = null;
    let settled = false;

    const cleanup = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      hlsInstance?.destroy();
    };
    const finish = (result: PreviewGenerationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      cleanup();
      resolve(result);
    };

    const timeoutId = setTimeout(() => finish({ blob: null, reason: 'timed out' }), LOAD_TIMEOUT_MS);

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    if (hls) {
      if (Hls.isSupported()) {
        hlsInstance = new Hls({ enableWorker: false, maxBufferLength: 10, maxMaxBufferLength: 20 });
        hlsInstance.loadSource(mediaUrl);
        hlsInstance.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = mediaUrl;
      } else {
        return finish({ blob: null, reason: 'HLS unsupported' });
      }
    } else {
      video.src = objectUrl;
    }

    video.addEventListener('error', () => finish({ blob: null, reason: 'video load error' }));

    video.addEventListener('loadedmetadata', async () => {
      try {
        const capture = await captureFrames(video, { frameCount });
        if (capture.frames.length < MIN_USABLE_FRAMES) {
          return finish({
            blob: null,
            capture,
            reason: `only ${capture.frames.length}/${capture.attempted} usable frames`,
          });
        }
        const payload = { isFrames: true, frames: capture.frames };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        finish({ blob, capture });
      } catch (err: any) {
        finish({ blob: null, reason: 'capture threw' });
      }
    });

    video.load();
  });
}
