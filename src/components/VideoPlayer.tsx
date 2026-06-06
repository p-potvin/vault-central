import React, { useEffect, useState, useRef } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { type VideoData } from '../types/schemas';
import { cn } from '../lib/utils';
import './VideoPlayer.css';

// CSP-safe Lucide icon wrapper
function createSafeIcon(IconComponent: React.ComponentType<LucideProps>) {
  return React.forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <IconComponent ref={ref} {...props} style={undefined} />
  ));
}

const PlayIcon = createSafeIcon(LucideIcons.Play);
const PauseIcon = createSafeIcon(LucideIcons.Pause);
const SkipBackIcon = createSafeIcon(LucideIcons.SkipBack);
const SkipForwardIcon = createSafeIcon(LucideIcons.SkipForward);
const Volume2Icon = createSafeIcon(LucideIcons.Volume2);
const Volume1Icon = createSafeIcon(LucideIcons.Volume1);
const VolumeXIcon = createSafeIcon(LucideIcons.VolumeX);
const SubtitlesIcon = createSafeIcon(LucideIcons.Subtitles);
const MaximizeIcon = createSafeIcon(LucideIcons.Maximize);
const MinimizeIcon = createSafeIcon(LucideIcons.Minimize);
const PictureInPictureIcon = createSafeIcon(LucideIcons.SquareStack);
const SettingsIcon = createSafeIcon(LucideIcons.Settings);
const FileUpIcon = createSafeIcon(LucideIcons.FileUp);
const XIcon = createSafeIcon(LucideIcons.X);
const LoaderIcon = createSafeIcon(LucideIcons.Loader2);
const RefreshIcon = createSafeIcon(LucideIcons.RefreshCw);
const TimerIcon = createSafeIcon(LucideIcons.Timer);
const ArrowUpDownIcon = createSafeIcon(LucideIcons.ArrowUpDown);

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

  const currentIdx = playlist.findIndex(v => v.url === video.url);
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx !== -1 && currentIdx < playlist.length - 1;

  // Restore Watch History Progress on Mount/Video Swap
  useEffect(() => {
    const progressMap = JSON.parse(localStorage.getItem('vault-video-progress') || '{}');
    const savedProgress = progressMap[video.url];
    
    setVideoError(false);
    setIsPlaying(false);
    setUploadedTracks([]);
    setActiveTrackId('off');
    setCountdown(null);
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    if (videoRef.current) {
      videoRef.current.load();
      if (savedProgress && typeof savedProgress === 'number') {
        videoRef.current.currentTime = savedProgress;
      }
    }
    if (scrubVideoRef.current) {
      scrubVideoRef.current.load();
    }
  }, [video.url]);

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
    if (isPlaying) {
      videoEl.pause();
      setIsPlaying(false);
    } else {
      videoEl.play().then(() => {
        setIsPlaying(true);
        setCountdown(null);
      }).catch(e => {
        console.error('Play failed:', e);
      });
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
    setScrubPreviewLeft(`${pct * 100}%`);

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
          "vw-console-shell bg-[var(--console-bg)] border border-[var(--console-border)] shadow-2xl flex flex-col overflow-hidden transition-all duration-300 pointer-events-auto",
          isPiP 
            ? "fixed bottom-6 right-6 w-[360px] h-[202px] rounded-lg z-[10000] aspect-video border-2 border-[var(--console-active)]"
            : "w-[90vw] max-w-5xl rounded-lg aspect-video"
        )}
        onClick={e => e.stopPropagation()}
        style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}
      >
        {/* Title Bar (Hidden in PiP) */}
        {!isPiP && (
          <div className="flex items-center justify-between px-4 py-2 bg-[var(--console-surface)] border-b border-[var(--console-border)] select-none">
            <div className="flex items-center gap-3">
              <span className="text-[10px] bg-[var(--console-raised)] border border-[var(--console-elevated)] px-2 py-0.5 rounded text-[var(--console-text)] font-semibold uppercase tracking-wider">
                CONSOLE
              </span>
              <span className="text-xs text-[var(--console-text)] font-medium line-clamp-1 max-w-[50vw]">
                {video.title || 'Untitled Stream'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={togglePiP}
                className="p-1 text-[var(--console-text)] hover:text-white hover:bg-[var(--console-raised)] rounded transition-colors"
                title="Picture-in-Picture (Ctrl+P)"
              >
                <PictureInPictureIcon size={16} />
              </button>
              <button 
                onClick={onClose}
                className="p-1 text-[var(--console-text)] hover:text-red-400 hover:bg-[var(--console-raised)] rounded transition-colors"
                title="Close"
              >
                <XIcon size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Video Surface Area */}
        <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden group/surface">
          {video.rawVideoSrc && !videoError ? (
            <video
              ref={videoRef}
              src={video.rawVideoSrc}
              autoPlay
              preload="auto"
              className="w-full h-full object-contain"
              playsInline
              onClick={togglePlay}
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
              className="absolute bottom-4 z-40 flex flex-col items-center pointer-events-none -translate-x-1/2 transition-all duration-75"
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
            src={video.rawVideoSrc}
            muted
            preload="auto"
            style={{ display: 'none' }}
            onSeeked={handleScrubSeeked}
          />
        )}

        {/* Custom Controller Deck */}
        <div 
          className={cn(
            "bg-[var(--console-surface)] px-4 py-3 border-t border-[var(--console-border)] select-none pointer-events-auto",
            isPiP ? "opacity-0 group-hover/surface:opacity-100 transition-opacity absolute bottom-0 left-0 right-0 z-50" : ""
          )}
        >
          <div className="flex items-center gap-3 w-full">
            {/* Left buttons group */}
            <div className="flex items-center gap-2 flex-none">
              <button 
                onClick={triggerPrevVideo}
                disabled={!hasPrev}
                className="ctrl-btn p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Previous video"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px', display: 'block' }}>
                  <polygon points="19 20 9 12 19 4 19 20"></polygon>
                  <line x1="5" y1="5" x2="5" y2="19"></line>
                </svg>
              </button>
              
              <button 
                onClick={togglePlay}
                className="ctrl-btn p-1.5"
                title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              >
                {isPlaying ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px', display: 'block' }}>
                    <rect x="6" y="4" width="4" height="16"></rect>
                    <rect x="14" y="4" width="4" height="16"></rect>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px', display: 'block' }}>
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                )}
              </button>

              <button 
                onClick={triggerNextVideo}
                disabled={!hasNext}
                className="ctrl-btn p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Next video"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px', display: 'block' }}>
                  <polygon points="5 4 15 12 5 20 5 4"></polygon>
                  <line x1="19" y1="5" x2="19" y2="19"></line>
                </svg>
              </button>

              {/* Volume Controller */}
              <div className="volume-container relative flex items-center cursor-pointer h-[30px] flex-none">
                <button 
                  onClick={toggleMute}
                  className="ctrl-btn p-1.5"
                  title="Toggle Mute (M)"
                >
                  {isMuted || volume === 0 ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '15px', height: '15px', display: 'block' }}>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                      <line x1="23" y1="9" x2="17" y2="15"></line>
                      <line x1="17" y1="9" x2="23" y2="15"></line>
                    </svg>
                  ) : volume < 0.5 ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '15px', height: '15px', display: 'block' }}>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '15px', height: '15px', display: 'block' }}>
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                    </svg>
                  )}
                </button>
                {!isPiP && (
                  <div className="volume-slider-wrapper absolute bottom-[32px] left-1/2 -translate-x-1/2 hidden bg-black/90 p-[15px] px-[10px] rounded z-[205] border border-[var(--console-border)]">
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.01"
                      value={isMuted ? 0 : volume}
                      onChange={(e) => {
                        const newVol = parseFloat(e.target.value);
                        setVolume(newVol);
                        localStorage.setItem('vault-player-volume', newVol.toString());
                        if (videoRef.current) videoRef.current.volume = newVol;
                        if (newVol > 0 && isMuted) {
                          setIsMuted(false);
                          localStorage.setItem('vault-player-muted', 'false');
                          if (videoRef.current) videoRef.current.muted = false;
                        }
                      }}
                      className="cursor-pointer"
                      style={{
                        writingMode: 'bt-lr',
                        WebkitAppearance: 'slider-vertical',
                        width: '8px',
                        height: '80px',
                        accentColor: 'var(--console-active)'
                      } as any}
                      title="Volume (Up/Down)"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Center: Seek Bar flanked by time-elapsed and time-total */}
            <div className="text-[11px] text-[var(--console-text)] font-semibold font-mono tabular-nums flex-none select-none">
              {formatTime(currentTime)}
            </div>

            <div 
              ref={seekAreaRef}
              className="flex-1 h-8 flex items-center cursor-pointer group/seek mx-3.5"
              onClick={handleSeekClick}
              onMouseMove={handleSeekMouseMove}
              onMouseLeave={handleSeekMouseLeave}
            >
              <div className="w-full bg-[var(--console-raised)] h-1.5 rounded-full overflow-hidden group-hover/seek:h-2 transition-all relative">
                <div 
                  className="bg-[var(--console-active)] h-full transition-all"
                  style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div className="text-[11px] text-[var(--console-text)] opacity-70 font-semibold font-mono tabular-nums flex-none select-none">
              {formatTime(duration)}
            </div>

            {/* Right buttons group */}
            <div className="flex items-center gap-2 flex-none">
              {/* Autoplay Mode */}
              {!isPiP && (
                <button
                  onClick={() => {
                    const nextMode = autoplayMode === 'off' ? '5s' : 'off';
                    setAutoplayMode(nextMode);
                    localStorage.setItem('vault-player-autoplay', nextMode);
                  }}
                  className={cn("ctrl-btn-sm", autoplayMode !== 'off' ? "active" : "")}
                  title={`Toggle Autoplay (Current: ${autoplayMode})`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px', display: 'block' }}>
                    <path d="M 9 7 L 17 7 C 19.8 7 22 9.2 22 12 C 22 14.8 19.8 17 17 17 L 7 17 C 4.2 17 2 14.8 2 12 C 2 9.8 3.7 8 6 7.1" />
                    <circle cx={autoplayMode !== 'off' ? 16 : 8} cy="12" r="3" className="transition-all duration-200 ease-out" style={{ fill: 'currentColor' }} />
                  </svg>
                </button>
              )}

              {/* Playback Speed Controller */}
              {!isPiP && (
                <div className="relative speed-menu-container">
                  <button 
                    onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                    className={cn("ctrl-btn-sm text-[10px] px-2 py-1 flex items-center gap-1 font-semibold", playbackSpeed !== 1.0 ? "active" : "")}
                    title="Playback speed"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px', display: 'block' }}>
                       <path d="M 4 17 A 8 8 0 0 1 18 7" /><path d="M 20 10 A 8 8 0 0 1 20 17" />
                       <line x1="12" y1="15" x2="15" y2="10" />
                    </svg>
                    <span>{playbackSpeed}x</span>
                  </button>
                  {showSpeedMenu && (
                    <div className="absolute bottom-9 right-0 bg-[var(--console-surface)] border border-[var(--console-border)] rounded shadow-xl py-1 z-50 w-20">
                      {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map(speed => (
                        <button
                          key={speed}
                          onClick={() => {
                            setPlaybackSpeed(speed);
                            localStorage.setItem('vault-player-speed', speed.toString());
                            if (videoRef.current) videoRef.current.playbackRate = speed;
                            setShowSpeedMenu(false);
                          }}
                          className={cn("w-full text-left px-3 py-1 text-[10px] hover:bg-[var(--console-bg)] hover:text-white block", playbackSpeed === speed ? "text-[var(--console-active)] font-bold" : "text-[var(--console-text)]")}
                        >
                          {speed}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* CC Subtitles Menu */}
              {!isPiP && (
                <div className="relative subtitles-menu-container">
                  <button 
                    onClick={() => setShowSubtitlesMenu(!showSubtitlesMenu)}
                    className={cn("ctrl-btn-sm px-2 py-1 flex items-center gap-1.5 text-[10px] font-semibold", activeTrackId !== 'off' ? "active" : "")}
                    title="Subtitles & Closed Captions"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px', display: 'block' }}>
                       <path d="M 21 9 L 21 17 C 21 18.1 20.1 19 19 19 L 5 19 C 3.9 19 3 18.1 3 17 L 3 7 C 3 5.9 3.9 5 5 5 L 15 5" /><line x1="18" y1="5" x2="19" y2="5" /><path d="M 7 10 L 13 10" /><path d="M 7 14 L 17 14" />
                    </svg>
                    <span>CC</span>
                  </button>
                  {showSubtitlesMenu && (
                    <div className="absolute bottom-9 right-0 bg-[var(--console-surface)] border border-[var(--console-border)] rounded shadow-xl py-1.5 z-50 w-44">
                      <div className="px-3 py-1 text-[9px] text-zinc-500 uppercase tracking-wider border-b border-[var(--console-border)] pb-1.5 mb-1.5">
                        Text Tracks
                      </div>
                      
                      <button
                        onClick={() => { selectTrack('off'); setShowSubtitlesMenu(false); }}
                        className={cn("w-full text-left px-3 py-1 text-[10px] hover:bg-[var(--console-bg)] hover:text-white block", activeTrackId === 'off' ? "text-[var(--console-active)] font-bold" : "text-[var(--console-text)]")}
                      >
                        OFF
                      </button>

                      {nativeTracks.map(t => (
                        <button
                          key={t.id}
                          onClick={() => { selectTrack(t.id); setShowSubtitlesMenu(false); }}
                          className={cn("w-full text-left px-3 py-1 text-[10px] truncate hover:bg-[var(--console-bg)] hover:text-white block", activeTrackId === t.id ? "text-[var(--console-active)] font-bold" : "text-[var(--console-text)]")}
                        >
                          {t.label.toUpperCase()} ({t.srclang?.toUpperCase() || 'CC'})
                        </button>
                      ))}

                      {uploadedTracks.map(t => (
                        <button
                          key={`uploaded-${t.id}`}
                          onClick={() => { selectTrack(`uploaded-${t.id}`, t); setShowSubtitlesMenu(false); }}
                          className={cn("w-full text-left px-3 py-1 text-[10px] truncate hover:bg-[var(--console-bg)] hover:text-white block", activeTrackId === `uploaded-${t.id}` ? "text-[var(--console-active)] font-bold" : "text-[var(--console-text)]")}
                        >
                          [FILE] {t.label.toUpperCase()}
                        </button>
                      ))}

                      <label className="w-full text-left px-3 py-1.5 text-[9px] text-[var(--console-text)] hover:bg-[var(--console-bg)] hover:text-white flex items-center gap-1.5 cursor-pointer mt-1 border-t border-[var(--console-border)] pt-1.5">
                        <FileUpIcon size={10} />
                        UPLOAD SRT/VTT
                        <input 
                          type="file" 
                          accept=".srt,.vtt" 
                          onChange={handleSubtitleUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* AI Button */}
              {!isPiP && (
                <button 
                  className="ctrl-btn-sm px-2 py-1 flex items-center gap-1.5 text-[10px] font-semibold opacity-50 cursor-not-allowed" 
                  disabled
                  title="AI Assistant (Preview)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px', display: 'block' }}>
                     <path d="M 12 20 V 14" /><path d="M 12 10 V 4" /><path d="M 7 9 L 12 4 L 17 9" /><path d="M 18 14 L 19 16 L 21 17 L 19 18 L 18 20 L 17 18 L 15 17 L 17 16 Z" />
                  </svg>
                  <span>AI</span>
                </button>
              )}

              {/* PiP Trigger */}
              <button 
                onClick={togglePiP}
                className={cn("ctrl-btn p-1.5", isPiP ? "active" : "")}
                title="Toggle PiP Window"
              >
                <PictureInPictureIcon size={15} />
              </button>

              {/* Fullscreen Trigger */}
              {!isPiP && (
                <button 
                  onClick={toggleFullscreen}
                  className="ctrl-btn p-1.5"
                  title="Toggle Fullscreen (F)"
                >
                  {isFullscreen ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px', display: 'block' }}>
                      <path d="M 4 14 L 10 14 L 10 20" /><path d="M 20 14 L 14 14 L 14 20" /><path d="M 14 4 L 14 10 L 20 10" /><path d="M 10 4 L 10 10 L 4 10" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '16px', height: '16px', display: 'block' }}>
                      <path d="M 5 9 L 5 5 L 9 5" /><path d="M 15 5 L 19 5 L 19 9" /><path d="M 19 15 L 19 19 L 15 19" /><path d="M 5 15 L 5 19 L 9 19" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
