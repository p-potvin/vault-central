import React from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { cn } from '../lib/utils';
import { VideoData } from '../types/schemas';
import { SpeedMenu } from './SpeedMenu';
import { SubtitlesMenu, UploadedTrack } from './SubtitlesMenu';

// CSP-safe Lucide icon wrapper
function createSafeIcon(IconComponent: React.ComponentType<LucideProps>) {
  return React.forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <IconComponent ref={ref} {...props} style={undefined} />
  ));
}

const PictureInPictureIcon = createSafeIcon(LucideIcons.PictureInPicture);

interface PlayerControlsProps {
  video: VideoData;
  controlsVisible: boolean;
  isPiP: boolean;
  triggerPrevVideo: () => void;
  triggerNextVideo: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  isPlaying: boolean;
  togglePlay: () => void;
  isMuted: boolean;
  toggleMute: () => void;
  volume: number;
  setVolume: (vol: number) => void;
  setIsMuted: (muted: boolean) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  seekAreaRef: React.RefObject<HTMLDivElement | null>;
  handleSeekClick: (e: React.MouseEvent<any>) => void;
  handleSeekMouseMove: (e: React.MouseEvent<any>) => void;
  handleSeekMouseLeave: () => void;
  currentTime: number;
  duration: number;
  formatTime: (seconds: number) => string;
  autoplayMode: string;
  setAutoplayMode: (mode: string) => void;
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  showSpeedMenu: boolean;
  setShowSpeedMenu: (show: boolean) => void;
  showSubtitlesMenu: boolean;
  setShowSubtitlesMenu: (show: boolean) => void;
  activeTrackId: string;
  selectTrack: (trackId: string, track?: UploadedTrack) => void;
  nativeTracks: { id: string; label: string; srclang?: string }[];
  uploadedTracks: UploadedTrack[];
  handleSubtitleUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  togglePiP: () => void;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({
  video,
  controlsVisible,
  isPiP,
  triggerPrevVideo,
  triggerNextVideo,
  hasPrev,
  hasNext,
  isPlaying,
  togglePlay,
  isMuted,
  toggleMute,
  volume,
  setVolume,
  setIsMuted,
  videoRef,
  seekAreaRef,
  handleSeekClick,
  handleSeekMouseMove,
  handleSeekMouseLeave,
  currentTime,
  duration,
  formatTime,
  autoplayMode,
  setAutoplayMode,
  playbackSpeed,
  setPlaybackSpeed,
  showSpeedMenu,
  setShowSpeedMenu,
  showSubtitlesMenu,
  setShowSubtitlesMenu,
  activeTrackId,
  selectTrack,
  nativeTracks,
  uploadedTracks,
  handleSubtitleUpload,
  togglePiP,
  isFullscreen,
  toggleFullscreen,
}) => {
  return (
    <div 
      className={cn(
        "absolute bottom-0 left-0 right-0 bg-[var(--console-surface)] px-4 py-1.5 border-t border-[var(--console-border)] select-none pointer-events-auto transition-opacity duration-300 ease-in-out z-30",
        (isPiP || controlsVisible) ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      )}
    >
      <div className="flex items-center gap-1.5 w-full">
        {/* Left buttons group */}
        <div className="flex items-center gap-1 flex-none">
          <button 
            onClick={triggerPrevVideo}
            disabled={!hasPrev}
            className="ctrl-btn disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous video"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
              <polygon points="19 20 9 12 19 4 19 20"></polygon>
              <line x1="5" y1="5" x2="5" y2="19"></line>
            </svg>
          </button>
          
          <button 
            onClick={togglePlay}
            className="ctrl-btn"
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            )}
          </button>

          <button 
            onClick={triggerNextVideo}
            disabled={!hasNext}
            className="ctrl-btn disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next video"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
              <polygon points="5 4 15 12 5 20 5 4"></polygon>
              <line x1="19" y1="5" x2="19" y2="19"></line>
            </svg>
          </button>

          {/* Volume Controller */}
          <div className="volume-container relative flex items-center cursor-pointer h-[32px] flex-none">
            <button 
              onClick={toggleMute}
              className="ctrl-btn"
              title="Toggle Mute (M)"
            >
              {isMuted || volume === 0 ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <line x1="23" y1="9" x2="17" y2="15"></line>
                  <line x1="17" y1="9" x2="23" y2="15"></line>
                </svg>
              ) : volume < 0.5 ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                </svg>
              )}
            </button>
            {!isPiP && (
              <div 
                className="volume-slider-wrapper absolute bottom-[34px] left-1/2 -translate-x-1/2 bg-black/90 p-[12px] px-[8px] rounded z-[205] border border-[var(--console-border)]"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
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
                    width: '6px',
                    height: '70px',
                    accentColor: 'var(--console-active)'
                  } as any}
                  title="Volume (Up/Down)"
                />
              </div>
            )}
          </div>
        </div>

        {/* Center: Seek Bar taking full remaining space */}
        <div 
          ref={seekAreaRef}
          className="flex-1 h-8 flex items-center cursor-pointer group/seek mx-1.5"
          onClick={handleSeekClick}
          onMouseMove={handleSeekMouseMove}
          onMouseLeave={handleSeekMouseLeave}
        >
          <div className="w-full bg-[var(--console-raised)] h-1 rounded-full overflow-hidden group-hover/seek:h-1.5 transition-all relative">
            <div 
              className="bg-[var(--console-active-secondary)] h-full transition-all"
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Right buttons group */}
        <div className="flex items-center gap-1.5 flex-none">
          {/* Time display: elapsed / total */}
          <div className="text-[11px] text-[var(--console-text)] font-semibold font-mono tabular-nums select-none mr-1">
            <span>{formatTime(currentTime)}</span>
            <span className="mx-0.5 opacity-50">/</span>
            <span className="opacity-70">{formatTime(duration)}</span>
          </div>

          {/* Autoplay Mode */}
          {!isPiP && (
            <button
              onClick={() => {
                const nextMode = autoplayMode === 'off' ? '5s' : 'off';
                setAutoplayMode(nextMode);
                localStorage.setItem('vault-player-autoplay', nextMode);
              }}
              className={cn("ctrl-btn", autoplayMode !== 'off' ? "active" : "")}
              title={`Toggle Autoplay (Current: ${autoplayMode})`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
                <path d="M 9 7 L 17 7 C 19.8 7 22 9.2 22 12 C 22 14.8 19.8 17 17 17 L 7 17 C 4.2 17 2 14.8 2 12 C 2 9.8 3.7 8 6 7.1" />
                <circle cx={autoplayMode !== 'off' ? 16 : 8} cy="12" r="2.5" className="transition-all duration-200 ease-out" style={{ fill: 'currentColor' }} />
              </svg>
            </button>
          )}

          {/* Playback Speed Controller */}
          {!isPiP && (
            <SpeedMenu
              playbackSpeed={playbackSpeed}
              setPlaybackSpeed={setPlaybackSpeed}
              videoRef={videoRef}
              showSpeedMenu={showSpeedMenu}
              setShowSpeedMenu={setShowSpeedMenu}
            />
          )}

          {/* CC Subtitles Menu */}
          {!isPiP && (
            <SubtitlesMenu
              showSubtitlesMenu={showSubtitlesMenu}
              setShowSubtitlesMenu={setShowSubtitlesMenu}
              activeTrackId={activeTrackId}
              selectTrack={selectTrack}
              nativeTracks={nativeTracks}
              uploadedTracks={uploadedTracks}
              handleSubtitleUpload={handleSubtitleUpload}
            />
          )}

          {/* PiP Trigger */}
          <button 
            onClick={togglePiP}
            className={cn("ctrl-btn", isPiP ? "active" : "")}
            title="Toggle PiP Window"
          >
            <PictureInPictureIcon size={18} />
          </button>

          {/* Fullscreen Trigger */}
          {!isPiP && (
            <button 
              onClick={toggleFullscreen}
              className="ctrl-btn"
              title="Toggle Fullscreen (F)"
            >
              {isFullscreen ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
                  <path d="M 4 14 L 10 14 L 10 20" /><path d="M 20 14 L 14 14 L 14 20" /><path d="M 14 4 L 14 10 L 20 10" /><path d="M 10 4 L 10 10 L 4 10" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
                  <path d="M 5 9 L 5 5 L 9 5" /><path d="M 15 5 L 19 5 L 19 9" /><path d="M 19 15 L 19 19 L 15 19" /><path d="M 5 15 L 5 19 L 9 19" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
