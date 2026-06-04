import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import browser from 'webextension-polyfill';
import React, { useEffect, useState, useRef } from 'react';
import { getSavedVideos, saveVideos } from '../lib/storage-vault';
import { getPreviewForVideo, isDisplayableImageThumbnail } from '../lib/dashboard-utils';
import * as Icons from '../lib/icons';
export const PreviewThumb = React.memo(({ video }) => {
    const [blob, setBlob] = useState(null);
    const [previewBlob, setPreviewBlob] = useState(null);
    const [frameSequence, setFrameSequence] = useState(null);
    const [currentFrame, setCurrentFrame] = useState(0);
    const [isHovering, setIsHovering] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const wasHovering = useRef(false);
    const videoRef = useRef(null);
    const hoverVideoRef = useRef(null);
    const [nativePlaybackFailed, setNativePlaybackFailed] = useState(false);
    const markPreviewAsFailed = async (videoUrl) => {
        try {
            const saved = await getSavedVideos();
            const idx = saved.findIndex(v => v.url === videoUrl);
            if (idx !== -1) {
                saved[idx].previewStatus = 'failed';
                await saveVideos(saved);
                console.log(`[PreviewThumb] Marked preview as failed in storage for: ${videoUrl}`);
            }
        }
        catch (e) {
            console.error("[PreviewThumb] Failed to mark preview as failed:", e);
        }
    };
    useEffect(() => {
        if (video.previewStatus === 'failed')
            return;
        let active = true;
        let retryIndex = 0;
        const retryDelays = [2000, 5000, 15000, 30000];
        const attempt = () => {
            console.debug(`[PreviewThumb] attempt ${retryIndex + 1} for: ${video.url}`);
            getPreviewForVideo(video)
                .then(blob => {
                if (!active)
                    return;
                if (blob) {
                    console.debug(`[PreviewThumb] blob found on attempt ${retryIndex + 1} for: ${video.url}`);
                    setBlob(blob);
                }
                else if (retryIndex < retryDelays.length) {
                    console.debug(`[PreviewThumb] no blob, scheduling retry ${retryIndex + 1} for: ${video.url}`);
                    const delay = retryDelays[retryIndex++];
                    setTimeout(attempt, delay);
                }
                else {
                    console.debug(`[PreviewThumb] all polling attempts exhausted for: ${video.url}`);
                    void markPreviewAsFailed(video.url);
                }
            })
                .catch((err) => {
                console.error(`[PreviewThumb] error during attempt for: ${video.url}`, err);
                if (!active || retryIndex >= retryDelays.length)
                    return;
                const delay = retryDelays[retryIndex++];
                setTimeout(attempt, delay);
            });
        };
        attempt();
        return () => { active = false; };
    }, [video.url, video.rawVideoSrc, video.previewStatus]);
    // Control video play/pause based on hover state (for pre-generated WebM previews)
    useEffect(() => {
        if (!videoRef.current || !previewBlob)
            return;
        if (isHovering) {
            wasHovering.current = true;
            videoRef.current.play().catch(() => { });
        }
        else {
            if (wasHovering.current) {
                videoRef.current.pause();
                videoRef.current.load();
            }
            wasHovering.current = false;
        }
    }, [isHovering, previewBlob]);
    // Native video preview segment-hopping logic (for videos without pre-generated previews)
    useEffect(() => {
        const videoEl = hoverVideoRef.current;
        if (!videoEl || !isHovering || !video.rawVideoSrc || previewBlob)
            return;
        let segmentTimer = null;
        let currentSegment = 0;
        const numSegments = 5;
        const segmentDuration = 2000; // 2 seconds per segment
        const playNextSegment = () => {
            if (!videoEl || videoEl.paused)
                return;
            const duration = videoEl.duration || (typeof video.duration === 'number' ? video.duration : parseFloat(video.duration) || 0) || 60;
            const interval = Math.max(2, (duration - 10) / (numSegments - 1));
            const targetTime = currentSegment * interval;
            console.log(`[PreviewThumb] Native segment hop: seeking to ${targetTime.toFixed(1)}s`);
            videoEl.currentTime = targetTime;
            segmentTimer = setTimeout(() => {
                currentSegment = (currentSegment + 1) % numSegments;
                playNextSegment();
            }, segmentDuration);
        };
        const onCanPlay = () => {
            videoEl.play().catch(() => { });
            if (!segmentTimer) {
                playNextSegment();
            }
        };
        videoEl.addEventListener('canplay', onCanPlay);
        if (videoEl.readyState >= 2) {
            onCanPlay();
        }
        return () => {
            if (segmentTimer)
                clearTimeout(segmentTimer);
            videoEl.removeEventListener('canplay', onCanPlay);
            videoEl.pause();
        };
    }, [isHovering, video.rawVideoSrc, video.duration, previewBlob]);
    useEffect(() => {
        if (!blob)
            return;
        if (blob.size < 100) {
            console.warn('[PreviewThumb] Loaded blob is abnormally small:', blob.size, 'bytes');
            return;
        }
        if (blob.type === 'application/json') {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const text = reader.result;
                    const data = JSON.parse(text);
                    if (data.isFrames && Array.isArray(data.frames)) {
                        setFrameSequence(data.frames);
                    }
                }
                catch (e) {
                    console.error("Failed to parse frame JSON:", e);
                }
            };
            reader.readAsText(blob);
        }
        else {
            const url = URL.createObjectURL(blob);
            setPreviewBlob(url);
            return () => { URL.revokeObjectURL(url); };
        }
    }, [blob]);
    useEffect(() => {
        if (!frameSequence || !isHovering) {
            if (!isHovering)
                setCurrentFrame(0);
            return;
        }
        let frameIdx = 0;
        const interval = setInterval(() => {
            frameIdx = (frameIdx + 1) % frameSequence.length;
            setCurrentFrame(frameIdx);
        }, 150); // ~7 fps
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
        if (blob) {
            setBlob(blob);
            return;
        }
        /**
         * Recovery Logic: If more than 30s have elapsed since save and the preview is
         * still missing, the background job likely failed or was interrupted. Re-trigger
         * generation via the offscreen generator.
         */
        const elapsed = Date.now() - (typeof video.timestamp === 'number' ? video.timestamp : Number(video.timestamp) || 0);
        if (elapsed > 30000 && !isProcessing && video.rawVideoSrc) {
            setIsProcessing(true);
            let startedPolling = false;
            try {
                const response = await browser.runtime.sendMessage({
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
                        if (retryBlob) {
                            setBlob(retryBlob);
                            setIsProcessing(false);
                            clearInterval(poll);
                        }
                        else if (attempts++ >= 40) { // 40 * 500ms = 20s
                            setIsProcessing(false);
                            clearInterval(poll);
                            void markPreviewAsFailed(video.url);
                        }
                    }, 500);
                }
            }
            catch (e) {
                console.error("[PreviewThumb] Error sending generate_preview message:", e);
            }
            finally {
                if (!startedPolling) {
                    setIsProcessing(false);
                }
            }
        }
    };
    return (_jsxs("div", { className: "absolute inset-0 z-20 overflow-hidden bg-black", onMouseEnter: handleMouseEnter, onMouseLeave: () => setIsHovering(false), children: [frameSequence ? (_jsx("img", { src: frameSequence[isHovering ? currentFrame : 0], alt: video.title, className: "w-full h-full object-cover", loading: "eager", onError: (e) => {
                    const target = e.currentTarget;
                    const fallbackSrc = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E';
                    if (target.src !== fallbackSrc) {
                        target.src = fallbackSrc;
                    }
                } })) : (previewBlob || (isHovering && video.rawVideoSrc && !nativePlaybackFailed)) ? (_jsx("video", { ref: previewBlob ? videoRef : hoverVideoRef, src: (previewBlob || video.rawVideoSrc) ?? undefined, className: "w-full h-full object-cover", preload: "auto", muted: true, loop: !!previewBlob, playsInline: true, onError: () => {
                    if (previewBlob) {
                        console.warn(`[PreviewThumb] WebM preview decoding failed for: ${video.url}. Falling back to native player.`);
                        void markPreviewAsFailed(video.url);
                        setPreviewBlob(null);
                    }
                    else {
                        console.warn(`[PreviewThumb] Native video preview playback failed for: ${video.rawVideoSrc}`);
                        setNativePlaybackFailed(true);
                    }
                } })) : (isDisplayableImageThumbnail(video.thumbnail) ? (_jsx("img", { src: video.thumbnail, alt: video.title, loading: "lazy", className: "w-full h-full object-cover", onError: (e) => {
                    const target = e.currentTarget;
                    const fallbackSrc = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E';
                    if (target.src !== fallbackSrc) {
                        target.src = fallbackSrc;
                    }
                } })) : (_jsx("div", { className: "w-full h-full bg-black", "aria-label": video.title }))), isProcessing ? (_jsx("div", { className: "absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm", children: _jsx(Icons.LoaderIcon, { className: "text-vault-accent animate-spin", size: 20 }) })) : (!previewBlob && !frameSequence && isHovering && !video.rawVideoSrc && (_jsx("div", { className: "absolute bottom-2 left-2 bg-black/60 text-[8px] text-white px-1 rounded uppercase tracking-tighter z-10", children: video.previewStatus === 'failed' ? 'Preview failed' : 'Generating preview…' })))] }));
});
