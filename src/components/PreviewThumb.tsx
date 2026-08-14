import browser from 'webextension-polyfill';
import React, { useEffect, useState, useRef } from 'react';
import { getSavedVideos, saveVideos } from '../lib/storage-vault';
import { getPreviewForVideo, isDisplayableImageThumbnail } from '../lib/dashboard-utils';
import * as Icons from '../lib/icons';
import { type VideoData } from '../types/schemas';

interface PreviewThumbProps {
  video: VideoData;
}

/**
 * A stored preview is only usable if it actually carries payload. Truncated or
 * zero-byte records must be treated as a miss so the retry / regeneration path
 * runs, rather than being accepted and then silently dropped at render time.
 */
const MIN_PREVIEW_BYTES = 100;

/**
 * How long each sampled frame is held on hover.
 *
 * The frames are minutes apart in the source, so they are distinct scenes rather
 * than consecutive motion. Flipping them quickly (this was 150ms) reads as a
 * flicker; holding each one long enough to register turns the same ten stills
 * into a deliberate scrub through the video. 10 x 450ms is a ~4.5s loop.
 */
const PREVIEW_FRAME_MS = 450;
function isUsablePreview(blob: Blob | null): blob is Blob {
  if (!blob) return false;
  if (blob.size < MIN_PREVIEW_BYTES) {
    console.warn('[PreviewThumb] Discarding undersized preview blob:', blob.size, 'bytes');
    return false;
  }
  return true;
}

export const PreviewThumb: React.FC<PreviewThumbProps> = React.memo(({ video }) => {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewBlob, setPreviewBlob] = useState<string | null>(null);
  const [frameSequence, setFrameSequence] = useState<string[] | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const wasHovering = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Latest enter handler, so the card listener below never calls a stale closure. */
  const enterHandlerRef = useRef<() => void>(() => {});

  const markPreviewAsFailed = async (videoUrl: string) => {
    try {
      const saved = await getSavedVideos();
      const idx = saved.findIndex(v => v.url === videoUrl);
      if (idx !== -1) {
        saved[idx].previewStatus = 'failed';
        await saveVideos(saved);
        console.log(`[PreviewThumb] Marked preview as failed in storage for: ${videoUrl}`);
      }
    } catch (e) {
      console.error("[PreviewThumb] Failed to mark preview as failed:", e);
    }
  };

  useEffect(() => {
    if (video.previewStatus === 'failed') return;

    let active = true;
    let retryIndex = 0;
    const retryDelays = [2000, 5000, 15000, 30000];

    const attempt = () => {
      console.debug(`[PreviewThumb] attempt ${retryIndex + 1} for: ${video.url}`);
      getPreviewForVideo(video)
        .then(blob => {
          if (!active) return;
          if (isUsablePreview(blob)) {
            console.debug(`[PreviewThumb] blob found on attempt ${retryIndex + 1} for: ${video.url}`);
            setBlob(blob);
          } else if (retryIndex < retryDelays.length) {
            console.debug(`[PreviewThumb] no blob, scheduling retry ${retryIndex + 1} for: ${video.url}`);
            const delay = retryDelays[retryIndex++];
            setTimeout(attempt, delay);
          } else {
            console.debug(`[PreviewThumb] all polling attempts exhausted for: ${video.url}`);
            void markPreviewAsFailed(video.url);
          }
        })
        .catch((err) => {
          console.error(`[PreviewThumb] error during attempt for: ${video.url}`, err);
          if (!active || retryIndex >= retryDelays.length) return;
          const delay = retryDelays[retryIndex++];
          setTimeout(attempt, delay);
        });
    };

    attempt();
    return () => { active = false; };
  }, [video.url, video.rawVideoSrc, video.previewStatus]);

  // Control video play/pause based on hover state (for pre-generated WebM previews)
  useEffect(() => {
    if (!videoRef.current || !previewBlob) return;
    if (isHovering) {
      wasHovering.current = true;
      videoRef.current.play().catch(() => {});
    } else {
      if (wasHovering.current) {
        videoRef.current.pause();
        videoRef.current.load();
      }
      wasHovering.current = false;
    }
  }, [isHovering, previewBlob]);

  /**
   * There used to be a "native segment hop" fallback here: when an item had no
   * stored preview, hovering it streamed the *remote* source into a <video> and
   * seeked across the whole file (0s → 409s → 818s → 1227s → 1636s on a 34-minute
   * video), looping every 2s. Every one of those seeks is a fresh HTTP range
   * request against the origin, so hovering a card hammered the network and the
   * picture barely moved. Removed Mon, 03 Aug 2026.
   *
   * The generated preview *is* that idea done once, offscreen, and cached — so a
   * missing preview now asks for generation instead of improvising a slow one.
   */

  useEffect(() => {
    if (!blob) return;
    if (blob.type === 'application/json') {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = reader.result as string;
          const data = JSON.parse(text);
          if (data.isFrames && Array.isArray(data.frames)) {
             setFrameSequence(data.frames);
          }
        } catch(e) {
          console.error("Failed to parse frame JSON:", e);
        }
      };
      reader.readAsText(blob);
    } else {
      const url = URL.createObjectURL(blob);
      setPreviewBlob(url);
      return () => { URL.revokeObjectURL(url); };
    }
  }, [blob]);

  useEffect(() => {
    if (!frameSequence || !isHovering) {
        if (!isHovering) setCurrentFrame(0);
        return;
    }
    let frameIdx = 0;
    const interval = setInterval(() => {
       frameIdx = (frameIdx + 1) % frameSequence.length;
       setCurrentFrame(frameIdx);
     }, PREVIEW_FRAME_MS);
    return () => clearInterval(interval);
  }, [frameSequence, isHovering]);

  const handleMouseEnter = async () => {
    setIsHovering(true);
    
    // Check if we already have it in state
    if (previewBlob || frameSequence || video.previewStatus === 'failed') {
      return;
    }

    // Check if it exists in the database (may have been written since mount)
    const blob = await getPreviewForVideo(video);
    if (isUsablePreview(blob)) {
      setBlob(blob);
      return;
    }

    /**
     * Recovery: the preview is missing, so the capture-time job either never ran,
     * failed, or was interrupted. Ask the offscreen generator for it.
     *
     * This used to wait until 30s after the item was saved before it would try,
     * on the assumption that the native hover fallback was covering the gap. That
     * fallback is gone, so a hover with nothing to show should start generating
     * immediately — waiting only leaves the card blank for longer.
     */
    if (!isProcessing && video.rawVideoSrc) {
      setIsProcessing(true);
      let startedPolling = false;
      try {
        const response: any = await browser.runtime.sendMessage({
          action: 'generate_preview',
          data: { 
            previewKey: video.url,
            sourceUrl: video.rawVideoSrc || video.url,
            duration: typeof video.duration === 'number' ? video.duration : 60 
          }
        });
        
        if (response && response.success) {
            startedPolling = true;
            // Poll for the result until it appears in DB or timeout (20s)
            let attempts = 0;
            const poll = setInterval(async () => {
                const retryBlob = await getPreviewForVideo(video);
                if (isUsablePreview(retryBlob)) {
                    setBlob(retryBlob);
                    setIsProcessing(false);
                    clearInterval(poll);
                } else if (attempts++ >= 40) { // 40 * 500ms = 20s
                    setIsProcessing(false);
                    clearInterval(poll);
                    void markPreviewAsFailed(video.url);
                }
            }, 500);
        }
      } catch (e) {
        console.error("[PreviewThumb] Error sending generate_preview message:", e);
      } finally {
        if (!startedPolling) {
          setIsProcessing(false);
        }
      }
    }
  };

  enterHandlerRef.current = () => { void handleMouseEnter(); };

  /**
   * Follow the hover of the whole card, not just the thumbnail.
   *
   * The preview only used to animate while the pointer was over the image, so
   * the lower half of a card felt inert. Listening on the card ancestor keeps
   * that state here instead of lifting it into VideoGrid, where a per-card
   * hover flag would re-render every card in the grid on every pointer move.
   */
  useEffect(() => {
    const card = rootRef.current?.closest('.vault-card');
    if (!card) return;

    const onEnter = () => enterHandlerRef.current();
    const onLeave = () => setIsHovering(false);
    card.addEventListener('mouseenter', onEnter);
    card.addEventListener('mouseleave', onLeave);
    return () => {
      card.removeEventListener('mouseenter', onEnter);
      card.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-20 overflow-hidden bg-black"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setIsHovering(false)}
    >
      {frameSequence ? (
        <img 
          src={frameSequence[isHovering ? currentFrame : 0]} 
          alt={video.title}
          className="w-full h-full object-cover" 
          loading="eager" 
          onError={(e) => {
            const target = e.currentTarget;
            const fallbackSrc = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E';
            if (target.src !== fallbackSrc) {
              target.src = fallbackSrc;
            }
          }}
        />
      ) : previewBlob ? (
        // Only ever a locally stored preview blob — never the remote source.
        <video
          ref={videoRef}
          src={previewBlob}
          className="w-full h-full object-cover"
          preload="auto"
          muted
          loop
          playsInline
          onError={() => {
            console.warn(`[PreviewThumb] Stored preview failed to decode for: ${video.url}`);
            void markPreviewAsFailed(video.url);
            setPreviewBlob(null);
          }}
        />
      ) : (
        isDisplayableImageThumbnail(video.thumbnail) ? (
          <img 
            src={video.thumbnail} 
            alt={video.title} 
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              const target = e.currentTarget;
              const fallbackSrc = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E';
              if (target.src !== fallbackSrc) {
                target.src = fallbackSrc;
              }
            }}
          />
        ) : (
          <div className="w-full h-full bg-black" aria-label={video.title} />
        )
      )}
      
      {isProcessing ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <Icons.LoaderIcon className="text-vault-accent animate-spin" size={20} />
        </div>
      ) : (
        !previewBlob && !frameSequence && isHovering && (
          <div className="absolute bottom-2 left-2 bg-black/60 text-[8px] text-white px-1 rounded uppercase tracking-tighter z-10">
            {video.previewStatus === 'failed' ? 'Preview failed' : 'Generating preview…'}
          </div>
        )
      )}
    </div>
  );
});
