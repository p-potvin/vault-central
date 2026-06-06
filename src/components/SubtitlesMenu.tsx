import React from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { cn } from '../lib/utils';

// CSP-safe Lucide icon wrapper
function createSafeIcon(IconComponent: React.ComponentType<LucideProps>) {
  return React.forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <IconComponent ref={ref} {...props} style={undefined} />
  ));
}

const FileUpIcon = createSafeIcon(LucideIcons.FileUp);

export interface UploadedTrack {
  id: number;
  label: string;
  src: string;
  kind: 'subtitles';
  srclang: string;
}

interface SubtitlesMenuProps {
  showSubtitlesMenu: boolean;
  setShowSubtitlesMenu: (show: boolean) => void;
  activeTrackId: string;
  selectTrack: (trackId: string, track?: UploadedTrack) => void;
  nativeTracks: { id: string; label: string; srclang?: string }[];
  uploadedTracks: UploadedTrack[];
  handleSubtitleUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const SubtitlesMenu: React.FC<SubtitlesMenuProps> = ({
  showSubtitlesMenu,
  setShowSubtitlesMenu,
  activeTrackId,
  selectTrack,
  nativeTracks,
  uploadedTracks,
  handleSubtitleUpload,
}) => {
  return (
    <div className="relative subtitles-menu-container">
      <button 
        onClick={() => setShowSubtitlesMenu(!showSubtitlesMenu)}
        className={cn("ctrl-btn font-black font-mono text-[10px]", activeTrackId !== 'off' ? "active" : "")}
        title="Subtitles & Closed Captions"
      >
        <span className="border border-current px-0.5 rounded tracking-tighter">CC</span>
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
  );
};
