import React, { useEffect, useState, useRef } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { type VideoData } from '../types/schemas';
import { cn } from '../lib/utils';
import './VideoPlayer.css';
import Hls from 'hls.js';
import { PlayerControls } from './PlayerControls';

// CSP-safe Lucide icon wrapper
function createSafeIcon(IconComponent: React.ComponentType<LucideProps>) {
  return React.forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <IconComponent ref={ref} {...props} style={undefined} />
  ));
}

const MaximizeIcon = createSafeIcon(LucideIcons.Maximize);
const XIcon = createSafeIcon(LucideIcons.X);
const LoaderIcon = createSafeIcon(LucideIcons.Loader2);
const RefreshIcon = createSafeIcon(LucideIcons.RefreshCw);
const TimerIcon = createSafeIcon(LucideIcons.Timer);

interface VideoPlayerProps {
  video: VideoData;
  playlist?: VideoData[];
  onClose: () => void;
  onSelectVideo?: (video: VideoData) => void;
  onRefresh?: () => Promise<void>;
  isRefreshing?: boolean;
}

interface UploadedTrack {
  id: number;
  label: string;
  src: string;
  kind: 'subtitles';
  srclang: string;
}

export function VideoPlayer({
  video,
  playlist = [],
  onClose,
  onSelectVideo,
  onRefresh,
  isRefreshing = false
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrubVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seekAreaRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const scrubHlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('vault-player-volume');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('vault-player-muted') === 'true';
  });
  const [playbackSpeed, setPlaybackSpeed] = useState(() => {
    const saved = localStorage.getItem('vault-player-speed');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [autoplayMode, setAutoplayMode] = useState<'off' | 'instant' | '3s' | '5s'>(() => {
    return (localStorage.getItem('vault-player-autoplay') as any) || '5s';
  });

  const [nativeTracks, setNativeTracks] = useState<any[]>([]);
  const [uploadedTracks, setUploadedTracks] = useState<UploadedTrack[]>([]);
  const [activeTrackId, setActiveTrackId] = useState<string>('off');

  const [isPiP, setIsPiP] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSubtitlesMenu, setShowSubtitlesMenu] = useState(false);
  const [showAutoplayMenu, setShowAutoplayMenu] = useState(false);
  
  const [scrubPreviewTime, setScrubPreviewTime] = useState<number | null>(null);
  const [scrubPreviewLeft, setScrubPreviewLeft] = useState<string>('0%');
  const [videoError, setVideoError] = useState(false);

  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownIntervalRef = useRef<any>(null);

  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<any>(null);

  const resetControlsTimeout = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    const shouldFade = isPlaying && !showSpeedMenu && !showSubtitlesMenu && !showAutoplayMenu;
    if (shouldFade) {
      controlsTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 1500);
    }
  };

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying, showSpeedMenu, showSubtitlesMenu, showAutoplayMenu]);

  const handleMouseMove = () => {
    resetControlsTimeout();
  };

  const handleMouseLeave = () => {
    const shouldFade = isPlaying && !showSpeedMenu && !showSubtitlesMenu && !showAutoplayMenu;
    if (shouldFade) {
      setControlsVisible(false);
    }
  };

  // Synchronize volume and muted properties of the video element
  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl) {
      videoEl.volume = volume;
      videoEl.muted = isMuted;
    }
  }, [volume, isMuted, video.rawVideoSrc]);

  const currentIdx = playlist.findIndex(v => v.url === video.url);
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx !== -1 && currentIdx < playlist.length - 1;

  // Restore Watch History Progress on Mount/Video Swap & dynamic source loading with HLS support
  useEffect(() => {
    const videoEl = videoRef.current;
    const scrubEl = scrubVideoRef.current;

    // Cleanup previous instances
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (scrubHlsRef.current) {
      scrubHlsRef.current.destroy();
      scrubHlsRef.current = null;
    }

    setVideoError(false);
    setIsPlaying(false);
    setUploadedTracks([]);
    setActiveTrackId('off');
    setCountdown(null);
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    if (!video.rawVideoSrc) return;

    const progressMap = JSON.parse(localStorage.getItem('vault-video-progress') || '{}');
    const savedProgress = progressMap[video.url] || 0;

    const isHls = video.rawVideoSrc.toLowerCase().includes('.m3u8') || video.rawVideoSrc.toLowerCase().includes('manifest');

    if (isHls) {
      if (Hls.isSupported()) {
        if (videoEl) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
          });
          hlsRef.current = hls;
          hls.loadSource(video.rawVideoSrc);
          hls.attachMedia(videoEl);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (savedProgress > 0) {
              videoEl.currentTime = savedProgress;
            }
          });
          hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
              console.error('Fatal HLS error:', data);
              setVideoError(true);
            }
          });
        }
        if (scrubEl) {
          const scrubHls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
          });
          scrubHlsRef.current = scrubHls;
          scrubHls.loadSource(video.rawVideoSrc);
          scrubHls.attachMedia(scrubEl);
        }
      } else {
        if (videoEl && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
          videoEl.src = video.rawVideoSrc;
          if (savedProgress > 0) {
            videoEl.currentTime = savedProgress;
          }
        } else {
          setVideoError(true);
        }
        if (scrubEl && scrubEl.canPlayType('application/vnd.apple.mpegurl')) {
          scrubEl.src = video.rawVideoSrc;
        }
      }
    } else {
      if (videoEl) {
        videoEl.src = video.rawVideoSrc;
        videoEl.load();
        if (savedProgress > 0) {
          videoEl.currentTime = savedProgress;
        }
      }
      if (scrubEl) {
        scrubEl.src = video.rawVideoSrc;
        scrubEl.load();
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (scrubHlsRef.current) {
        scrubHlsRef.current.destroy();
        scrubHlsRef.current = null;
      }
    };
  }, [video.rawVideoSrc, video.url]);

  // Save Progress periodically
  useEffect(() => {
    if (!isPlaying || duration === 0) return;

    const interval = setInterval(() => {
      if (videoRef.current) {
        const time = videoRef.current.currentTime;
        // Don't save if we are at the very end
        if (time / duration < 0.95) {
          const progressMap = JSON.parse(localStorage.getItem('vault-video-progress') || '{}');
          progressMap[video.url] = time;
          localStorage.setItem('vault-video-progress', JSON.stringify(progressMap));
        } else {
          // Clear progress if nearly done
          const progressMap = JSON.parse(localStorage.getItem('vault-video-progress') || '{}');
          delete progressMap[video.url];
          localStorage.setItem('vault-video-progress', JSON.stringify(progressMap));
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isPlaying, duration, video.url]);

  // Native tracks listener
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const handleTracksChange = () => {
      const tracks: any[] = [];
      for (let i = 0; i < videoEl.textTracks.length; i++) {
        const t = videoEl.textTracks[i];
        tracks.push({
          id: `native-${i}`,
          label: t.label || t.language || `Track ${i + 1}`,
          srclang: t.language,
          kind: t.kind,
          mode: t.mode,
          trackIndex: i
        });
      }
      setNativeTracks(tracks);
    };

    const textTracks = videoEl.textTracks;
    textTracks.addEventListener('addtrack', handleTracksChange);
    textTracks.addEventListener('removetrack', handleTracksChange);
    handleTracksChange();

    return () => {
      textTracks.removeEventListener('addtrack', handleTracksChange);
      textTracks.removeEventListener('removetrack', handleTracksChange);
    };
  }, [video.url]);

  // Fullscreen event listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.tagName === 'SELECT' ||
        activeEl.getAttribute('contenteditable') === 'true'
      )) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowleft':
          e.preventDefault();
          seekRelative(-5);
          break;
        case 'arrowright':
          e.preventDefault();
          seekRelative(5);
          break;
        case 'arrowup':
          e.preventDefault();
          adjustVolume(0.1);
          break;
        case 'arrowdown':
          e.preventDefault();
          adjustVolume(-0.1);
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'p':
          e.preventDefault();
          togglePiP();
          break;
        case 'escape':
          if (!document.fullscreenElement) {
            e.preventDefault();
            onClose();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isPlaying, duration, isMuted, volume]);

  const togglePlay = () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (videoEl.paused) {
      videoEl.play().then(() => {
        setCountdown(null);
      }).catch(e => {
        console.error('Play failed:', e);
      });
    } else {
      videoEl.pause();
    }
  };

  const seekRelative = (seconds: number) => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    let target = videoEl.currentTime + seconds;
    if (target < 0) target = 0;
    if (target > duration) target = duration;
    videoEl.currentTime = target;
    setCurrentTime(target);
  };

  const adjustVolume = (delta: number) => {
    let nextVol = volume + delta;
    if (nextVol < 0) nextVol = 0;
    if (nextVol > 1) nextVol = 1;
    setVolume(nextVol);
    localStorage.setItem('vault-player-volume', nextVol.toString());
    
    if (videoRef.current) {
      videoRef.current.volume = nextVol;
    }
    if (nextVol > 0 && isMuted) {
      setIsMuted(false);
      localStorage.setItem('vault-player-muted', 'false');
      if (videoRef.current) videoRef.current.muted = false;
    }
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    localStorage.setItem('vault-player-muted', nextMuted ? 'true' : 'false');
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(err => {
        console.error('Fullscreen request failed:', err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const togglePiP = () => {
    setIsPiP(prev => !prev);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
    if (!hasNext || autoplayMode === 'off') return;

    if (autoplayMode === 'instant') {
      triggerNextVideo();
    } else {
      const startCount = autoplayMode === '3s' ? 3 : 5;
      setCountdown(startCount);
      
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      let currentVal = startCount;
      countdownIntervalRef.current = setInterval(() => {
        currentVal -= 1;
        setCountdown(currentVal);
        if (currentVal <= 0) {
          clearInterval(countdownIntervalRef.current);
          setCountdown(null);
          triggerNextVideo();
        }
      }, 1000);
    }
  };

  const triggerNextVideo = () => {
    if (onSelectVideo && hasNext) {
      onSelectVideo(playlist[currentIdx + 1]);
    }
  };

  const triggerPrevVideo = () => {
    if (onSelectVideo && hasPrev) {
      onSelectVideo(playlist[currentIdx - 1]);
    }
  };

  const cancelCountdown = () => {
    setCountdown(null);
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }
  };

  // Progress Bar Seek
  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = seekAreaRef.current?.getBoundingClientRect();
    if (!rect || duration === 0) return;
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    if (videoRef.current) {
      videoRef.current.currentTime = pct * duration;
      setCurrentTime(pct * duration);
    }
  };

  // Scrubber canvas drawing
  const handleSeekMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = seekAreaRef.current?.getBoundingClientRect();
    if (!rect || duration === 0) return;
    const hoverX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, hoverX / rect.width));
    const targetTime = pct * duration;

    setScrubPreviewTime(targetTime);

    // Calculate left position relative to player client container
    const playerRect = containerRef.current?.getBoundingClientRect();
    if (playerRect) {
      const leftPx = e.clientX - playerRect.left;
      setScrubPreviewLeft(`${leftPx}px`);
    } else {
      setScrubPreviewLeft(`${pct * 100}%`);
    }

    // Seek the hidden video element for canvas update
    const scrubVideo = scrubVideoRef.current;
    if (scrubVideo) {
      scrubVideo.currentTime = targetTime;
    }
  };

  const handleSeekMouseLeave = () => {
    setScrubPreviewTime(null);
  };

  const handleScrubSeeked = () => {
    const scrubVideo = scrubVideoRef.current;
    const canvas = canvasRef.current;
    if (!scrubVideo || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    try {
      ctx.drawImage(scrubVideo, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      console.debug('Failed to draw scrub frame:', e);
    }
  };

  // Sidecar subtitles conversion SRT -> VTT
  const srtToVttBlob = (srtText: string): string => {
    let vtt = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!vtt.startsWith('WEBVTT')) {
      vtt = vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      vtt = 'WEBVTT\n\n' + vtt;
    }
    const blob = new Blob([vtt], { type: 'text/vtt' });
    return URL.createObjectURL(blob);
  };

  const handleSubtitleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      let trackUrl = '';
      if (file.name.endsWith('.srt')) {
        trackUrl = srtToVttBlob(text);
      } else {
        const blob = new Blob([text], { type: 'text/vtt' });
        trackUrl = URL.createObjectURL(blob);
      }
      
      const newTrackId = `uploaded-${Date.now()}`;
      const newTrack: UploadedTrack = {
        id: Date.now(),
        label: file.name,
        src: trackUrl,
        kind: 'subtitles',
        srclang: 'custom'
      };
      
      setUploadedTracks(prev => [...prev, newTrack]);
      selectTrack(newTrackId, newTrack);
      setShowSubtitlesMenu(false);
    };
    reader.readAsText(file);
  };

  const selectTrack = (trackId: string, customTrackInfo?: UploadedTrack) => {
    setActiveTrackId(trackId);
    const videoEl = videoRef.current;
    if (!videoEl) return;

    // Disable all native tracks
    for (let i = 0; i < videoEl.textTracks.length; i++) {
      videoEl.textTracks[i].mode = 'disabled';
    }

    if (trackId === 'off') {
      return;
    }

    if (trackId.startsWith('native-')) {
      const idx = parseInt(trackId.replace('native-', ''), 10);
      if (videoEl.textTracks[idx]) {
        videoEl.textTracks[idx].mode = 'showing';
      }
    }
  };

  // Format helper: seconds -> HH:MM:SS
  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const sStr = s < 10 ? `0${s}` : `${s}`;
    if (h > 0) {
      const mStr = m < 10 ? `0${m}` : `${m}`;
      return `${h}:${mStr}:${sStr}`;
    }
    return `${m}:${sStr}`;
  };

  // Close menus on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.speed-menu-container')) setShowSpeedMenu(false);
      if (!target.closest('.subtitles-menu-container')) setShowSubtitlesMenu(false);
      if (!target.closest('.autoplay-menu-container')) setShowAutoplayMenu(false);
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  const currentUploadedTrack = uploadedTracks.find(t => `uploaded-${t.id}` === activeTrackId);

  return (
    <div 
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center transition-all duration-300",
        isPiP ? "pointer-events-none" : "bg-black/80 backdrop-blur-sm"
      )}
      onClick={() => { if (!isPiP) onClose(); }}
    >
      <div 
        ref={containerRef}
        className={cn(
          "vw-console-shell bg-[var(--console-bg)] border border-[var(--console-border)] shadow-2xl flex flex-col overflow-hidden transition-all duration-300 pointer-events-auto relative",
          isPiP 
            ? "fixed bottom-6 right-6 w-[360px] h-[202px] rounded-lg z-[10000] aspect-video border-2 border-[var(--console-active)]"
            : "w-[90vw] max-w-5xl rounded-lg aspect-video"
        )}
        onClick={e => e.stopPropagation()}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ 
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          cursor: (controlsVisible || !isPlaying || isPiP) ? 'default' : 'none'
        }}
      >
        {/* Title Bar (Hidden in PiP) */}
        {!isPiP && (
          <div className={cn(
            "absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-1.5 bg-[var(--console-surface)]/90 backdrop-blur-sm border-b border-[var(--console-border)] select-none transition-opacity duration-300 ease-in-out z-30",
            controlsVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          )}>
            <span className="text-[11px] text-[var(--console-text)] font-mono uppercase tracking-wider line-clamp-1 max-w-[80vw]">
              {(video.title || 'Untitled Stream').toUpperCase()}
            </span>
            <div className="flex items-center gap-2">
              <button 
                onClick={onClose}
                className="p-1 text-[var(--console-text)] hover:text-white transition-colors"
                title="Close"
              >
                <XIcon size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Video Surface Area */}
        <div 
          className="w-full h-full bg-black flex items-center justify-center overflow-hidden group/surface"
          onClick={() => {
            if (isPiP) {
              setIsPiP(false);
            }
          }}
        >
          {video.rawVideoSrc && !videoError ? (
            <video
              ref={videoRef}
              autoPlay
              preload="auto"
              className="w-full h-full object-contain"
              playsInline
              onClick={togglePlay}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={handleVideoEnded}
              onError={() => setVideoError(true)}
              style={{ pointerEvents: 'auto' }}
            >
              {/* Custom Uploaded Track Rendering */}
              {currentUploadedTrack && (
                <track
                  kind="subtitles"
                  label={currentUploadedTrack.label}
                  src={currentUploadedTrack.src}
                  srcLang={currentUploadedTrack.srclang}
                  default
                />
              )}
            </video>
          ) : videoError ? (
            <div className="text-center space-y-4 p-6 pointer-events-auto">
              <div className="w-12 h-12 bg-red-950/40 border border-red-500/30 rounded-full flex items-center justify-center mx-auto text-red-500 animate-pulse">
                <XIcon size={24} />
              </div>
              <div>
                <h4 className="text-[var(--console-text)] font-bold text-sm uppercase tracking-wider mb-1">Link Broken or Blocked</h4>
                <p className="text-zinc-500 text-xs font-sans">The vault media token has expired or requires CORS authorization.</p>
              </div>
              <div className="flex justify-center gap-3 mt-4">
                {onRefresh && (
                  <button 
                    className="ctrl-btn-sm text-xs px-3 py-1.5 flex items-center gap-2"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? <LoaderIcon className="animate-spin" size={12} /> : <RefreshIcon size={12} />}
                    {isRefreshing ? 'REFRESHING...' : 'REFRESH DECRYPT LINK'}
                  </button>
                )}
                <a 
                  href={video.url} 
                  target="_blank" 
                  rel="noreferrer"
                  className="ctrl-btn-sm ctrl-btn-active text-xs px-3 py-1.5 text-white"
                >
                  OPEN ORIGIN SITE
                </a>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <LoaderIcon className="animate-spin text-[var(--console-active)]" size={32} />
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Awaiting Media Feed</span>
            </div>
          )}

          {/* Autoplay Next countdown overlay */}
          {countdown !== null && (
            <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center z-30 select-none pointer-events-auto">
              <div className="bg-[var(--console-surface)] border border-[var(--console-border)] p-6 rounded-lg text-center space-y-4 max-w-sm">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">AUTOPLAY TRIGGER</span>
                <h4 className="text-white font-semibold text-sm">Next video starts in {countdown}s...</h4>
                <div className="flex justify-center gap-3">
                  <button 
                    onClick={triggerNextVideo} 
                    className="ctrl-btn-sm text-xs"
                  >
                    PLAY NOW
                  </button>
                  <button 
                    onClick={cancelCountdown} 
                    className="ctrl-btn-sm text-xs border-zinc-700 text-zinc-400 hover:text-white"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Hover Scrub Preview Canvas and Tooltip */}
          {scrubPreviewTime !== null && duration > 0 && (
            <div 
              className="absolute bottom-[52px] z-40 flex flex-col items-center pointer-events-none -translate-x-1/2 transition-all duration-75"
              style={{ left: scrubPreviewLeft }}
            >
              <div className="bg-[var(--console-surface)] border border-[var(--console-border)] rounded shadow-xl overflow-hidden mb-1.5 p-0.5">
                <canvas 
                  ref={canvasRef}
                  width="160" 
                  height="90" 
                  className="bg-black w-[160px] h-[90px] block"
                />
              </div>
              <span className="bg-black/90 border border-[var(--console-border)] text-white text-[10px] px-2 py-0.5 rounded font-mono shadow-md">
                {formatTime(scrubPreviewTime)}
              </span>
            </div>
          )}

          {/* Mini Float Controls for PiP Mode */}
          {isPiP && (
            <div className="absolute top-2 right-2 z-50 flex items-center gap-1.5 opacity-0 group-hover/surface:opacity-100 transition-opacity">
              <button
                onClick={togglePiP}
                className="p-1 bg-black/80 text-[var(--console-text)] hover:text-white border border-[var(--console-border)] rounded"
                title="Restore Window"
              >
                <MaximizeIcon size={12} />
              </button>
              <button
                onClick={onClose}
                className="p-1 bg-black/80 text-red-400 hover:text-red-300 border border-[var(--console-border)] rounded"
                title="Close"
              >
                <XIcon size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Hidden scrub video for trickplay seeking */}
        {video.rawVideoSrc && !videoError && (
          <video
            ref={scrubVideoRef}
            muted
            preload="auto"
            style={{ display: 'none' }}
            onSeeked={handleScrubSeeked}
          />
        )}

        {/* Custom Controller Deck */}
        <PlayerControls
          video={video}
          controlsVisible={controlsVisible}
          isPiP={isPiP}
          triggerPrevVideo={triggerPrevVideo}
          triggerNextVideo={triggerNextVideo}
          hasPrev={hasPrev}
          hasNext={hasNext}
          isPlaying={isPlaying}
          togglePlay={togglePlay}
          isMuted={isMuted}
          toggleMute={toggleMute}
          volume={volume}
          setVolume={setVolume}
          setIsMuted={setIsMuted}
          videoRef={videoRef}
          seekAreaRef={seekAreaRef}
          handleSeekClick={handleSeekClick}
          handleSeekMouseMove={handleSeekMouseMove}
          handleSeekMouseLeave={handleSeekMouseLeave}
          currentTime={currentTime}
          duration={duration}
          formatTime={formatTime}
          autoplayMode={autoplayMode}
          setAutoplayMode={setAutoplayMode as any}
          playbackSpeed={playbackSpeed}
          setPlaybackSpeed={setPlaybackSpeed}
          showSpeedMenu={showSpeedMenu}
          setShowSpeedMenu={setShowSpeedMenu}
          showSubtitlesMenu={showSubtitlesMenu}
          setShowSubtitlesMenu={setShowSubtitlesMenu}
          activeTrackId={activeTrackId}
          selectTrack={selectTrack}
          nativeTracks={nativeTracks}
          uploadedTracks={uploadedTracks}
          handleSubtitleUpload={handleSubtitleUpload}
          togglePiP={togglePiP}
          isFullscreen={isFullscreen}
          toggleFullscreen={toggleFullscreen}
        />
      </div>
    </div>
  );
}
