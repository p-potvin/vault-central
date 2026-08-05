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
 * Ten points spread across the video, played back slowly (see PREVIEW_FRAME_MS
 * in PreviewThumb). Storage was never the constraint — a frame is ~4.5 KB raw,
 * ~6.7 KB once base64'd into the payload, so even 60 frames would be ~400 KB
 * against a multi-gigabyte quota. Ten simply looks better: sample points minutes
 * apart are different scenes, not motion, so more of them just makes the
 * slideshow faster, not smoother. Fewer frames held longer reads as a deliberate
 * scrub through the video.
 */
export const DEFAULT_FRAME_COUNT = 10;

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
