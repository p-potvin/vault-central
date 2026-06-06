import React from 'react';
import { cn } from '../lib/utils';

interface SpeedMenuProps {
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  showSpeedMenu: boolean;
  setShowSpeedMenu: (show: boolean) => void;
}

export const SpeedMenu: React.FC<SpeedMenuProps> = ({
  playbackSpeed,
  setPlaybackSpeed,
  videoRef,
  showSpeedMenu,
  setShowSpeedMenu,
}) => {
  return (
    <div className="relative speed-menu-container">
      <button 
        onClick={() => setShowSpeedMenu(!showSpeedMenu)}
        className={cn("ctrl-btn", playbackSpeed !== 1.0 ? "active" : "")}
        title={`Playback speed: ${playbackSpeed}x`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
           <path d="M 4 17 A 8 8 0 0 1 18 7" /><path d="M 20 10 A 8 8 0 0 1 20 17" />
           <line x1="12" y1="15" x2="15" y2="10" />
        </svg>
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
  );
};
