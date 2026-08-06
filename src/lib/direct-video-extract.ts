/**
 * Extraction for URLs that are already a media file.
 *
 * There is nothing to scrape for a direct .mp4/.webm — the URL *is* the source.
 * All that is needed is to load it and sample frames, which is plain DOM work.
 *
 * It used to require a visible scraper window regardless: the background opened
 * scraper-player.html in its own window, that page did the capture, and posted
 * the result back. But scraper-player.html is our own extension page, so there
 * is no framing restriction forcing it into a window — any context with a DOM
 * can do the same work in place. On Firefox the background *is* such a context,
 * so direct-video extraction now happens silently.
 *
 * Site-page extraction still needs a real window: those pages set
 * X-Frame-Options / frame-ancestors, and Firefox gives extensions no hidden
 * window. Only this half can be made invisible.
 */
import { captureFrames } from './frame-capture';
import { DEFAULT_FRAME_COUNT, MIN_USABLE_FRAMES } from './preview-generator';

export interface DirectVideoExtraction {
  src: string;
  metadata: {
    title: string;
    thumbnail: string;
    duration: number;
    author: string;
    views: string;
    tags: string[];
    likes: string;
    date: string;
  };
}

/** True when this context can load a <video> and sample it. */
export function canExtractDirectVideoInPlace(): boolean {
  return typeof document !== 'undefined' && typeof HTMLVideoElement !== 'undefined';
}

/** UTF-8 safe base64. The old btoa(unescape(encodeURIComponent(x))) chain is deprecated. */
function toBase64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const chunks: string[] = [];
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]));
  }
  return btoa(chunks.join(''));
}

/**
 * Load a direct media URL, sample frames, and build the extraction result.
 *
 * `videoEl` lets the scraper page reuse its own on-page <video>; when omitted a
 * detached element is created, which is what the background does.
 *
 * Throws when the source cannot be fetched or yields too few usable frames —
 * storing a broken preview is worse than storing none, because nothing retries it.
 */
export async function extractDirectVideo(
  videoUrl: string,
  originTitle: string,
  videoEl?: HTMLVideoElement,
): Promise<DirectVideoExtraction> {
  // Fetch to a blob first: it bypasses CORS for the canvas (an unfetchable
  // cross-origin frame taints it and every capture then throws) and makes seeks
  // local instead of one range request each.
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  const video = videoEl ?? document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    video.src = blobUrl;
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('Video load error')); };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      video.load();
    });

    const duration = (video.duration && !isNaN(video.duration) && video.duration > 0) ? video.duration : 60;
    const capture = await captureFrames(video, { frameCount: DEFAULT_FRAME_COUNT });
    console.log(
      `[directVideo] Capture: ${capture.frames.length}/${capture.attempted} usable` +
      ` (${capture.timedOut} seek timeouts, ${capture.blank} blank, ${capture.tainted} tainted)`,
    );

    if (capture.frames.length < MIN_USABLE_FRAMES) {
      throw new Error(
        `Only ${capture.frames.length} usable frames captured (need ${MIN_USABLE_FRAMES}); refusing to store a broken preview`,
      );
    }

    const framesDataUrl = `data:application/json;base64,${toBase64Json({ isFrames: true, frames: capture.frames })}`;

    let author = 'Direct Link';
    try { author = new URL(videoUrl).hostname || author; } catch { /* keep the fallback */ }

    return {
      src: videoUrl,
      metadata: {
        title: originTitle,
        thumbnail: framesDataUrl,
        duration,
        author,
        views: '',
        tags: [],
        likes: '',
        date: new Date().toISOString(),
      },
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
    if (!videoEl) {
      // Detached element: drop the source so the decoder releases the blob.
      video.removeAttribute('src');
      video.load();
    }
  }
}
