import browser from 'webextension-polyfill';

import {
  clearSyncedVideos,
  DEFAULT_BACKUP_SETTINGS,
  getPinSettings,
  getSavedVideos,
  getSyncEnabled,
  getSyncedVideos,
  savePinSettings,
  saveSyncedVideos,
  saveVideos,
  setSyncEnabled,
  type BackupSettings
} from '../lib/storage-vault';
import { clearPreviews, deletePreview, getPreview, vaultSetup, vaultStatus, vaultUnlock, vaultLock } from '../lib/vault-client';
import { VAULT_THEMES, getThemeClass } from '../lib/themes'; // Added for binary previews
import { type VideoData, VideoDataSchema } from '../types/schemas';
import { STORAGE_KEYS } from '../lib/constants';
import * as Icons from '../lib/icons';
import { cn } from '../lib/utils';
import React, { useEffect, useState, useMemo, useRef, useDeferredValue } from 'react';

// ⚡ BOLT OPTIMIZATION:
// Instantiating `new URL()` synchronously within loops (like render loops or useMemo mapping)
// creates O(N) performance bottlenecks. This cache prevents redundant URL parsing
// and gracefully handles invalid URLs without crashing the React tree.
const domainCache = new Map<string, string>();

// ⚡ BOLT OPTIMIZATION:
// `new Date().toLocaleDateString()` and `.toLocaleString()` inside render loops
// create an enormous performance bottleneck because V8 must re-parse and instantiate
// the locale formatter on every call. Using `Intl.DateTimeFormat` prevents this overhead.
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });

// ⚡ BOLT OPTIMIZATION:
// `String.prototype.localeCompare` is notoriously slow when called repeatedly inside `.sort()`.
// Instantiating `Intl.Collator` once outside the render/sort loops and reusing `.compare` provides
// massive performance gains when sorting strings, and avoids the heavy V8 instantiation cost
// on every re-render or search filter update.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Pagination row count keyed by viewSize. Picked to match the largest
// Tailwind breakpoint defined in viewClasses for the same viewSize. Slightly
// undersells small viewports (one fewer row of items per page than visually
// fits) but never overshoots, and avoids the previous substring-match bug
// where "grid-cols-4" matched before "grid-cols-5".
const PER_ROW_BY_VIEW_SIZE: Record<number, number> = {
  1: 1, // Details (flex column, single line per item; pagination uses items-per-page directly)
  2: 2, // List
  3: 5, // Small
  4: 4, // Medium
  5: 3, // Large
  6: 2, // Biggest
};
function computePerRow(viewSize: number): number {
  return PER_ROW_BY_VIEW_SIZE[viewSize] ?? 1;
}

// Duration display: integer seconds, 2-digit padded; H:MM:SS when ≥1h.
// Accepts either a number of seconds or a pre-formatted string (passed through).
function formatDuration(d: number | string): string {
  if (typeof d !== 'number' || !isFinite(d)) return String(d ?? '');
  const total = Math.max(0, Math.floor(d));
  const s = (total % 60).toString().padStart(2, '0');
  const m = (Math.floor(total / 60) % 60).toString();
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${m.padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Prompt dialog: keeps the input value in a ref instead of walking the DOM
// from the Submit button (the previous version did
// `e.currentTarget.parentElement?.previousElementSibling.value` which breaks
// the moment any element is added between the input and the button row).
const PromptDialog: React.FC<{
  message: string;
  type?: 'password' | 'text';
  onCancel: () => void;
  onConfirm: (value: string) => void;
}> = ({ message, type, onCancel, onConfirm }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => onConfirm(inputRef.current?.value ?? '');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-vault-cardBg border border-vault-border rounded-lg shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95">
        <h3 className="text-vault-text font-bold mb-4 flex items-center gap-2"><Icons.DebugIcon size={20} className="text-vault-accent" /> Input Required</h3>
        <p className="text-vault-muted text-sm mb-3">{message}</p>
        <input
          ref={inputRef}
          autoFocus
          type={type === 'password' ? 'password' : 'text'}
          className="w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:outline-none focus:border-vault-accent focus:ring-1 focus:ring-vault-accent/30"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} className="px-4 py-1.5 text-xs font-bold text-vault-muted hover:text-vault-text transition-colors">Cancel</button>
          <button onClick={submit} className="px-4 py-1.5 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all shadow-lg">Submit</button>
        </div>
      </div>
    </div>
  );
};

// LockedBanner — surfaces when the auto-lock timer fires while the user is on
// the dashboard. Inline PIN entry returns the user to a working state without
// having to navigate to the popup. Renders nothing when the vault is unlocked
// or PIN is disabled.
const LockedBanner: React.FC<{
  visible: boolean;
  pinLength: number;
  onUnlocked: () => void;
}> = ({ visible, pinLength, onUnlocked }) => {
  const [pin, setPin] = useState<string[]>(() => new Array(pinLength).fill(''));
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (visible) {
      setPin(new Array(pinLength).fill(''));
      setError(false);
      // Defer focus so the transition completes first
      const t = setTimeout(() => inputs.current[0]?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [visible, pinLength]);

  const verify = async (full: string) => {
    setBusy(true);
    const res = await vaultUnlock(full);
    setBusy(false);
    if (res.success) {
      onUnlocked();
    } else {
      setError(true);
      setPin(new Array(pinLength).fill(''));
      inputs.current[0]?.focus();
    }
  };

  const onChange = (idx: number, v: string) => {
    if (!/^\d*$/.test(v)) return;
    const next = [...pin];
    next[idx] = v.slice(-1);
    setPin(next);
    setError(false);
    if (v && idx < pinLength - 1) inputs.current[idx + 1]?.focus();
    const full = next.join('');
    if (full.length === pinLength) verify(full);
  };

  const onKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[idx] && idx > 0) inputs.current[idx - 1]?.focus();
  };

  if (!visible) return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'fixed inset-x-0 top-0 z-[120] flex justify-center pointer-events-none transition-all duration-300',
      )}
    >
      <div className="pointer-events-auto mt-4 max-w-lg w-full mx-4 bg-vault-cardBg border border-vault-border rounded-xl shadow-2xl backdrop-blur-md p-5 flex items-center gap-4 animate-in slide-in-from-top-4 fade-in duration-300">
        <Icons.PinIcon size={24} className={cn('shrink-0', error ? 'text-red-400' : 'text-vault-accent')} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-vault-text tracking-tight">Vault locked</h3>
          <p className="text-[11px] text-vault-muted mt-0.5">
            {error ? 'Wrong PIN — try again' : `Auto-lock fired. Enter your ${pinLength}-digit PIN to continue.`}
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {pin.map((digit, i) => (
            <input
              key={i}
              ref={el => { inputs.current[i] = el; }}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={digit}
              disabled={busy}
              onChange={e => onChange(i, e.target.value)}
              onKeyDown={e => onKeyDown(i, e)}
              className={cn(
                'w-7 h-9 text-center text-sm font-mono font-bold rounded-md border outline-none transition-all duration-150',
                'bg-vault-bg/60 text-vault-text',
                error
                  ? 'border-red-400/60 text-red-400'
                  : digit
                    ? 'border-vault-accent/60'
                    : 'border-vault-border focus:border-vault-accent',
                busy && 'opacity-50',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

async function getPreviewForVideo(video: VideoData): Promise<Blob | null> {
  console.debug('[getPreviewForVideo] Fetching primary for:', video.url);
  const primary = await getPreview(video.url);
  if (primary || !video.rawVideoSrc || video.rawVideoSrc === video.url) {
    console.debug('[getPreviewForVideo] Returning primary / no fallback needed. Found primary?', !!primary);
    return primary;
  }
  console.debug('[getPreviewForVideo] Primary not found, fetching fallback for:', video.rawVideoSrc);
  return getPreview(video.rawVideoSrc);
}

function isDisplayableImageThumbnail(thumbnail?: string): thumbnail is string {
  return Boolean(thumbnail && !thumbnail.startsWith('data:video'));
}

function mergeSyncedMetadata(localItems: VideoData[], syncedItems: VideoData[]) {
  const seen = new Set(localItems.map(item => item.url));
  const additions = syncedItems.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
  return {
    merged: [...localItems, ...additions],
    addedCount: additions.length
  };
}

function getDomainFromUrl(url: string, removeWww = false): string {
  if (!url) return 'Unknown';
  const cacheKey = `${url}-${removeWww}`;
  if (domainCache.has(cacheKey)) {
    return domainCache.get(cacheKey)!;
  }
  try {
    const urlObj = new URL(url);
    const hostname = removeWww ? urlObj.hostname.replace(/^www\./, '') : urlObj.hostname;
    const domain = hostname || 'Unknown';
    domainCache.set(cacheKey, domain);
    return domain;
  } catch (e) {
    domainCache.set(cacheKey, 'Unknown');
    return 'Unknown';
  }
}

/**
 * Preview Player Component
 * Handles the "YouTube-style" 10x2s hover preview
 */
// ⚡ BOLT OPTIMIZATION:
// Wrapping `PreviewThumb` in `React.memo` prevents unnecessary and costly re-renders
// when parent components update state (e.g., when opening a video modal or changing themes).
const PreviewThumb: React.FC<{ video: VideoData }> = React.memo(({ video }) => {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewBlob, setPreviewBlob] = useState<string | null>(null);
  const [frameSequence, setFrameSequence] = useState<string[] | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wasHovering = useRef(false);

  useEffect(() => {
    let active = true;
    let retryIndex = 0;
    const retryDelays = [2000, 5000, 15000, 30000];

    const attempt = () => {
      console.debug(`[PreviewThumb] attempt ${retryIndex + 1} for: ${video.url}`);
      getPreviewForVideo(video)
        .then(blob => {
          if (!active) return;
          if (blob) {
            console.debug(`[PreviewThumb] blob found on attempt ${retryIndex + 1} for: ${video.url}`);
            setBlob(blob);
          } else if (retryIndex < retryDelays.length) {
            console.debug(`[PreviewThumb] no blob, scheduling retry ${retryIndex + 1} for: ${video.url}`);
            const delay = retryDelays[retryIndex++];
            setTimeout(attempt, delay);
          } else {
            console.debug(`[PreviewThumb] all polling attempts exhausted for: ${video.url}`);
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
  }, [video.url, video.rawVideoSrc]);

  // Control video play/pause based on hover state
  useEffect(() => {
    if (!videoRef.current || !previewBlob) return;
    if (isHovering) {
      wasHovering.current = true;
      videoRef.current.play().catch(() => {});
    } else {
      if (wasHovering.current) {
        videoRef.current.pause();
        // Firefox cannot seek WebM created by MediaRecorder (missing Cues). 
        // Using .load() resets the stream without throwing NS_ERROR_DOM_MEDIA_METADATA_ERR.
        videoRef.current.load();
      }
      wasHovering.current = false;
    }
  }, [isHovering, previewBlob]);

  useEffect(() => {
    if (!blob) return;
    if (blob.size < 100) {
      console.warn('[PreviewThumb] Loaded blob is abnormally small:', blob.size, 'bytes');
      return;
    }
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
    }, 150); // ~7 fps
    return () => clearInterval(interval);
  }, [frameSequence, isHovering]);

  const handleMouseEnter = async () => {
    setIsHovering(true);
    
    // Check if we already have it in state
    if (previewBlob || frameSequence) {
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
     * generation via the offscreen FFmpeg processor.
     */
    const elapsed = Date.now() - video.timestamp;
    if (elapsed > 30000 && !isProcessing && video.rawVideoSrc) {
      setIsProcessing(true);
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
            // Poll for the result until it appears in DB or timeout (10s)
            let attempts = 0;
            const poll = setInterval(async () => {
                const retryBlob = await getPreviewForVideo(video);
                if (retryBlob) {
                    setBlob(retryBlob);
                    setIsProcessing(false);
                    clearInterval(poll);
                }
                if (attempts++ > 20) {
                    setIsProcessing(false);
                    clearInterval(poll);
                }
            }, 500);
            return;
        }
      } catch (e) {
        console.error("[PreviewThumb] Error sending generate_preview message:", e);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return (
    <div 
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
        />
      ) : previewBlob ? (
        // Show as a static first-frame when not hovering; play on hover.
        // The play/pause is driven by the isHovering useEffect above.
        <video
          ref={videoRef}
          src={previewBlob}
          className="w-full h-full object-cover"
          preload="none"
          muted
          loop
          playsInline
        />
      ) : (
        isDisplayableImageThumbnail(video.thumbnail) ? (
          // ⚡ BOLT OPTIMIZATION:
          // Adding `loading="lazy"` defers the loading of off-screen thumbnails,
          // significantly reducing initial network payload and memory footprint for large lists.
          <img 
            src={video.thumbnail} 
            alt={video.title} 
            loading="lazy"
            className="w-full h-full object-cover"
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
            Generating preview…
          </div>
        )
      )}
    </div>
  );
});

export const VaultDashboard: React.FC = () => {
  const [items, setItems] = useState<VideoData[]>([]);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  // When search is cleared, use the immediate value so the list resets instantly.
  const effectiveSearch = search === '' ? search : deferredSearch;
  const [searchField, setSearchField] = useState<keyof VideoData>('title');
  const [currentTheme, setCurrentTheme] = useState<number>(3);
  
  // Sidebar states
  const [isSidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('vault-sidebar-open');
    return saved !== 'false';
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Custom Dialog States
  const [toastMessage, setToastMessage] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);
  const [promptDialog, setPromptDialog] = useState<{message: string, type?: 'password' | 'text', onConfirm: (val: string) => void} | null>(null);
  const [editingItem, setEditingItem] = useState<{current: VideoData, original: VideoData} | null>(null);

  // PIN Setup Modal States
  const [pinSetupOpen, setPinSetupOpen] = useState(false);
  const [pinSetupBoxes, setPinSetupBoxes] = useState<string[]>([]);
  const [pinSetupLength, setPinSetupLength] = useState<4 | 6>(4);
  const [pinSetupError, setPinSetupError] = useState(false);
  const pinSetupRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handleExportVault = async () => {
    try {
      const data = await getSavedVideos();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vault-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export vault backup", err);
      setToastMessage({ msg: "Failed to export vault backup.", type: "error" });
    }
  };

  const handleImportVault = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          const current = await getSavedVideos(true);
          const knownUrls = new Set(current.map(item => item.url));
          const validImports = json
            .map(item => VideoDataSchema.safeParse(item))
            .filter((result): result is { success: true; data: VideoData } => result.success)
            .map(result => result.data);
          const additions = validImports.filter(item => {
            if (knownUrls.has(item.url)) return false;
            knownUrls.add(item.url);
            return true;
          });
          const next = [...current, ...additions];
          await saveVideos(next);
          setItems(next);
          setToastMessage({msg: `Imported ${additions.length} items. Skipped ${json.length - additions.length}.`, type: "success"});
        } else {
          setToastMessage({msg: "Failed to import. Backup must be a JSON array.", type: "error"});
        }
      } catch (err) {
        setToastMessage({msg: "Failed to import. Invalid JSON backup.", type: "error"});
      }
    };
    reader.readAsText(file);
  };

  const handleDelete = async (url: string) => {
    setConfirmDialog({
      message: "Are you sure you want to delete this item?",
      onConfirm: async () => {
        const all = await getSavedVideos();
        const next = all.filter(v => v.url !== url);
        await deletePreview(url);
        await saveVideos(next);
        setItems(next);
        setConfirmDialog(null);
      }
    });
  };

  const handleEdit = (video: VideoData) => {
    setEditingItem({current: JSON.parse(JSON.stringify(video)), original: video});
  };

  const saveEditedItem = async (updatedVideo: VideoData, originalVideo: VideoData) => {
    const all = await getSavedVideos();
    const idx = all.findIndex(v => v.url === originalVideo.url);
    if (idx !== -1) {
      all[idx] = updatedVideo;
      if (updatedVideo.url !== originalVideo.url) {
        await deletePreview(originalVideo.url);
      }
      await saveVideos(all);
      setItems(all);
      
      // If URL or rawVideoSrc was changed, trigger a rescan
      if ((updatedVideo.url !== originalVideo.url || updatedVideo.rawVideoSrc !== originalVideo.rawVideoSrc) && updatedVideo.type === 'video') {
        browser.runtime.sendMessage({
          action: "generate_preview",
          data: { 
            previewKey: updatedVideo.url,
            sourceUrl: updatedVideo.rawVideoSrc || updatedVideo.url,
            duration: typeof updatedVideo.duration === 'number' ? updatedVideo.duration : 60
          }
        });
      }
    }
    setEditingItem(null);
  };

  const handleWipeVault = async () => {
    setConfirmDialog({
      message: "Are you sure you want to completely wipe your vault? This cannot be undone.",
      onConfirm: async () => {
        await clearPreviews();
        try {
          await clearSyncedVideos();
        } catch (err) {
          console.warn("[VaultDashboard] Browser Sync clear failed during wipe:", err);
        }
        await saveVideos([]);
        setItems([]);
        setIsSettingsOpen(false);
        setConfirmDialog(null);
      }
    });
  };
  const [groupBy, setGroupBy] = useState(() => localStorage.getItem('vault-group-by') || 'Hostname');
  // Sort model: sortBy is the field, sortOrder is the direction. Old localStorage
  // values 'DateDesc' / 'DateAsc' encoded direction in the field name and
  // contradicted sortOrder when the toggle button was clicked. Migrate on read.
  const [sortBy, setSortBy] = useState<keyof VideoData>(() => {
    const raw = localStorage.getItem('vault-sort-by');
    if (raw === 'DateDesc' || raw === 'DateAsc' || !raw) return 'timestamp';
    return raw as keyof VideoData;
  });
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    const raw = localStorage.getItem('vault-sort-order');
    if (raw === 'asc' || raw === 'desc') return raw;
    // If old DateAsc was the saved field, the user wanted ascending dates.
    return localStorage.getItem('vault-sort-by') === 'DateAsc' ? 'asc' : 'desc';
  });
  const [viewSize, setViewSize] = useState<number>(() => {
    const saved = localStorage.getItem('vault-view-size');
    return saved ? parseInt(saved, 10) : 3;
  }); // 1: Details, 2: list, 3: Small, 4: Medium, 5: Large, 6: Biggest

  useEffect(() => {
    localStorage.setItem('vault-group-by', groupBy);
  }, [groupBy]);

  useEffect(() => {
    localStorage.setItem('vault-sort-by', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('vault-sort-order', sortOrder);
  }, [sortOrder]);

  useEffect(() => {
    localStorage.setItem('vault-view-size', viewSize.toString());
  }, [viewSize]);

  const [isDimmed, setIsDimmed] = useState(false); // Player Dimmer State

  // Layout & Pagination states
  const [isolatedGroup, setIsolatedGroup] = useState<string | null>(null);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [sectionLimit, setSectionLimit] = useState(50);
  const mainRef = useRef<HTMLElement>(null);
  const scrollThrottle = useRef(false);

  // Video Player Modal states
  const [playingVideo, setPlayingVideo] = useState<VideoData | null>(null);
  const [videoError, setVideoError] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // PIN Settings
  const [pinSettings, setPinSettings] = useState<any>(null);
  // Vault lock state — polled from background. The banner appears whenever
  // the vault is enabled but locked (auto-lock fired while dashboard open).
  const [vaultLocked, setVaultLocked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await vaultStatus();
        if (cancelled) return;
        setVaultLocked(s.success && s.enabled && s.locked);
      } catch { /* background may be cycling — ignore one tick */ }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Browser Sync State
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncBusy, setIsSyncBusy] = useState(false);
  const syncEnabledRef = useRef(false);
  const [isFirefox] = useState(() => navigator.userAgent.toLowerCase().includes('firefox'));

  // Local Backup State
  const [backupSettings, setBackupSettings] = useState<BackupSettings>(DEFAULT_BACKUP_SETTINGS);
  const [backupFolderDraft, setBackupFolderDraft] = useState(DEFAULT_BACKUP_SETTINGS.folder);
  const [isBackupBusy, setIsBackupBusy] = useState(false);

  useEffect(() => {
    syncEnabledRef.current = isSyncing;
    localStorage.setItem('vault-sync-enabled', isSyncing.toString());
  }, [isSyncing]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('vault-theme');
    if (savedTheme) {
      const themeNum = parseInt(savedTheme, 10);
      setCurrentTheme(themeNum);
      const mode = VAULT_THEMES[themeNum]?.mode || 'dark';
      document.documentElement.setAttribute('data-theme', getThemeClass(themeNum));
      document.documentElement.classList.toggle('dark', mode === 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', getThemeClass(3));
      document.documentElement.classList.add('dark');
    }

    const savedSidebar = localStorage.getItem('vault-sidebar-open');
    if (savedSidebar !== null) {
      setSidebarOpen(savedSidebar === 'true');
    }

    const savedViewSize = localStorage.getItem('vault-view-size');
    if (savedViewSize) setViewSize(parseInt(savedViewSize, 10));

    const savedGroupBy = localStorage.getItem('vault-group-by');
    if (savedGroupBy) setGroupBy(savedGroupBy);

    const savedSortBy = localStorage.getItem('vault-sort-by');
    if (savedSortBy) setSortBy(savedSortBy as any);

    const savedSortOrder = localStorage.getItem('vault-sort-order');
    if (savedSortOrder) setSortOrder(savedSortOrder as 'asc' | 'desc');

    const load = async () => {
      console.log("[VaultDashboard] Loading vault data...");
      const settings = await getPinSettings();
      setPinSettings(settings);
      console.log("[VaultDashboard] PIN settings loaded. enabled:", settings.enabled);

      let syncEnabled = await getSyncEnabled();
      const legacySyncEnabled = localStorage.getItem('vault-sync-enabled') === 'true';
      if (!syncEnabled && legacySyncEnabled) {
        await setSyncEnabled(true);
        syncEnabled = true;
      }
      setIsSyncing(syncEnabled);

      try {
        const backupResponse = await browser.runtime.sendMessage({ action: "get_backup_settings" }) as any;
        if (backupResponse?.success && backupResponse.settings) {
          setBackupSettings(backupResponse.settings);
          setBackupFolderDraft(backupResponse.settings.folder || '');
        }
      } catch (err) {
        console.warn("[VaultDashboard] Failed to load backup settings:", err);
      }

      let all = await getSavedVideos();
      if (syncEnabled) {
        try {
          const synced = await getSyncedVideos();
          const { merged, addedCount } = mergeSyncedMetadata(all, synced);
          if (addedCount > 0) {
            await saveVideos(merged);
            all = merged;
          } else {
            await saveSyncedVideos(all);
          }
        } catch (err) {
          console.error("[VaultDashboard] Browser Sync load failed:", err);
          setToastMessage({ msg: "Browser Sync metadata could not be loaded.", type: "error" });
        }
      }
      console.log("[VaultDashboard] Vault loaded.", all?.length ?? 0, "items.");
      setItems(all || []);
    };
    load();
    
    // Listen for browser sync updates
    const handleStorageChange = (changes: any, areaName: string) => {
      console.log("[VaultDashboard] storage.onChanged fired. areaName:", areaName, "| changed keys:", Object.keys(changes).join(', '));
      // BUG FIX: was checking changes.vault_videos but the actual key is STORAGE_KEYS.SAVED_VIDEOS ('savedVideos').
      // This listener was never firing when vault items were saved.
      if (areaName === 'local' && changes[STORAGE_KEYS.SAVED_VIDEOS]) {
        const newValue = changes[STORAGE_KEYS.SAVED_VIDEOS].newValue || [];
        console.log("[VaultDashboard] savedVideos storage change detected. New count:", newValue.length);
        setItems(newValue);
      }
      if (areaName === 'sync' && syncEnabledRef.current) {
        const keys = Object.keys(changes);
        const syncChanged = keys.some(key =>
          key === 'savedVideosSyncMeta' ||
          key === STORAGE_KEYS.SAVED_VIDEOS ||
          key.startsWith('savedVideosSyncChunk:')
        );
        if (!syncChanged) return;

        void (async () => {
          try {
            const localItems = await getSavedVideos(true);
            const syncedItems = await getSyncedVideos();
            const { merged, addedCount } = mergeSyncedMetadata(localItems, syncedItems);
            if (addedCount > 0) {
              await saveVideos(merged);
              setItems(merged);
            }
          } catch (err) {
            console.error("[VaultDashboard] Browser Sync change handling failed:", err);
          }
        })();
      }
    };
    if (browser.storage && browser.storage.onChanged) {
      browser.storage.onChanged.addListener(handleStorageChange);
    }
    return () => {
      if (browser.storage && browser.storage.onChanged) {
        browser.storage.onChanged.removeListener(handleStorageChange);
      }
    };
  }, []);

  const enableBrowserSync = async () => {
    setIsSyncBusy(true);
    try {
      const localItems = await getSavedVideos(true);
      const syncedItems = await getSyncedVideos();
      const { merged, addedCount } = mergeSyncedMetadata(localItems, syncedItems);
      await saveSyncedVideos(merged);
      await setSyncEnabled(true);
      if (addedCount > 0) {
        await saveVideos(merged);
        setItems(merged);
      }
      setIsSyncing(true);
      setToastMessage({
        msg: addedCount > 0
          ? `Browser Sync enabled. Restored ${addedCount} synced items.`
          : "Browser Sync enabled for metadata.",
        type: "success"
      });
    } catch (err) {
      console.error("[VaultDashboard] Failed to enable Browser Sync:", err);
      await setSyncEnabled(false);
      setIsSyncing(false);
      setToastMessage({ msg: "Browser Sync failed to enable. Metadata may be too large for sync storage.", type: "error" });
    } finally {
      setIsSyncBusy(false);
    }
  };

  const disableBrowserSync = async () => {
    setIsSyncBusy(true);
    try {
      await setSyncEnabled(false);
      setIsSyncing(false);
      setToastMessage({ msg: "Browser Sync disabled. Local vault unchanged.", type: "success" });
    } catch (err) {
      console.error("[VaultDashboard] Failed to disable Browser Sync:", err);
      setToastMessage({ msg: "Failed to disable Browser Sync.", type: "error" });
    } finally {
      setIsSyncBusy(false);
    }
  };

  const handleToggleBrowserSync = () => {
    if (isSyncBusy) return;
    void (isSyncing ? disableBrowserSync() : enableBrowserSync());
  };

  const refreshBackupSettings = async () => {
    try {
      const response = await browser.runtime.sendMessage({ action: "get_backup_settings" }) as any;
      if (response?.success && response.settings) {
        setBackupSettings(response.settings);
        setBackupFolderDraft(response.settings.folder || '');
      }
    } catch (err) {
      console.warn("[VaultDashboard] Failed to refresh backup settings:", err);
    }
  };

  const saveBackupSettingsFromDraft = async (patch: Partial<BackupSettings> = {}) => {
    const next = {
      ...backupSettings,
      ...patch,
      folder: backupFolderDraft
    };
    setBackupSettings(next);

    const response = await browser.runtime.sendMessage({
      action: "save_backup_settings",
      settings: next
    }) as any;
    if (!response?.success) {
      throw new Error(response?.error || "Failed to save backup settings.");
    }
    setToastMessage({ msg: "Backup settings saved.", type: "success" });
  };

  const handleToggleDailyBackup = async (enabled: boolean) => {
    try {
      await saveBackupSettingsFromDraft({ enabled });
    } catch (err) {
      console.error("[VaultDashboard] Failed to update daily backup setting:", err);
      setToastMessage({ msg: "Failed to update daily backup setting.", type: "error" });
      await refreshBackupSettings();
    }
  };

  const handleSaveBackupSettings = async () => {
    try {
      await saveBackupSettingsFromDraft();
    } catch (err) {
      console.error("[VaultDashboard] Failed to save backup settings:", err);
      setToastMessage({ msg: "Failed to save backup settings.", type: "error" });
      await refreshBackupSettings();
    }
  };

  const handleRunFullBackup = async () => {
    setIsBackupBusy(true);
    try {
      const response = await browser.runtime.sendMessage({ action: "run_full_backup" }) as any;
      if (!response?.success) {
        throw new Error(response?.error || "Backup failed.");
      }
      setToastMessage({
        msg: `Full backup downloaded (${response.videos} items, ${response.previews} previews).`,
        type: "success"
      });
      await refreshBackupSettings();
    } catch (err) {
      console.error("[VaultDashboard] Full backup failed:", err);
      setToastMessage({ msg: "Full backup failed. Check debug logs.", type: "error" });
    } finally {
      setIsBackupBusy(false);
    }
  };

  const doConfirmPinSetup = async (pin: string, length: 4 | 6) => {
    // Provision the zero-knowledge vault: derives the master KEK from the
    // PIN via Argon2id, mints an ML-KEM-1024 keypair, wraps the private
    // key, persists material, and unlocks. The raw PIN is never stored.
    const res = await vaultSetup(pin);
    if (!res.success) {
      setToastMessage({ msg: `PIN activation failed: ${res.error || 'unknown'}`, type: 'error' });
      return;
    }
    const updated = { ...pinSettings, enabled: true, length, lastUnlocked: Date.now() };
    await savePinSettings(updated);
    setPinSettings(updated);
    setPinSetupOpen(false);
    setPinSetupBoxes([]);
    setPinSetupError(false);
    setToastMessage({ msg: `${length}-digit PIN activated.`, type: 'success' });
  };

  const handlePinSetupChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newBoxes = [...pinSetupBoxes];
    newBoxes[index] = value.slice(-1);
    setPinSetupBoxes(newBoxes);
    setPinSetupError(false);
    if (value && index < newBoxes.length - 1) {
      pinSetupRefs.current[index + 1]?.focus();
    }
    const fullPin = newBoxes.join('');
    if (fullPin.length === pinSetupLength && /^\d+$/.test(fullPin)) {
      void doConfirmPinSetup(fullPin, pinSetupLength);
    }
  };

  const handlePinSetupKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pinSetupBoxes[index] && index > 0) {
      pinSetupRefs.current[index - 1]?.focus();
    }
  };

  const handlePinSetupLengthChange = (len: 4 | 6) => {
    setPinSetupLength(len);
    setPinSetupBoxes(new Array(len).fill(''));
    setPinSetupError(false);
    setTimeout(() => pinSetupRefs.current[0]?.focus(), 0);
  };

  const cancelPinSetup = () => {
    setPinSetupOpen(false);
    setPinSetupBoxes([]);
    setPinSetupError(false);
  };

  const confirmPinSetup = async () => {
    const pin = pinSetupBoxes.join('');
    if (pin.length !== pinSetupLength || !/^\d+$/.test(pin)) {
      setPinSetupError(true);
      pinSetupRefs.current[0]?.focus();
      return;
    }
    void doConfirmPinSetup(pin, pinSetupLength);
  };

  const togglePin = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    if (enabled) {
      const length = (pinSettings?.length as 4 | 6) || 4;
      setPinSetupLength(length);
      setPinSetupBoxes(new Array(length).fill(''));
      setPinSetupError(false);
      setPinSetupOpen(true);
      // Temporarily revert UI checkbox until confirmed
      e.target.checked = false;
    } else {
      const updated = { ...pinSettings, enabled: false };
      await savePinSettings(updated);
      setPinSettings(updated);
    }
  };

  const updatePinLength = async (len: 4 | 6) => {
     const updated = { ...pinSettings, length: len };
     await savePinSettings(updated);
     setPinSettings(updated);
  };

  const updateLockTimeout = async (timeout: number) => {
     const updated = { ...pinSettings, lockTimeout: timeout };
     await savePinSettings(updated);
     setPinSettings(updated);
  };
  const changeTheme = (id: number) => {
    setCurrentTheme(id);
    const mode = VAULT_THEMES[id]?.mode || 'dark';
    document.documentElement.setAttribute('data-theme', getThemeClass(id));
    document.documentElement.classList.toggle('dark', mode === 'dark');
    localStorage.setItem('vault-theme', id.toString());
  };

  const cycleTheme = () => {
    const themeIds = Object.keys(VAULT_THEMES).map(Number).sort((a, b) => a - b);
    const idx = themeIds.indexOf(currentTheme);
    const nextTheme = themeIds[(idx + 1) % themeIds.length] ?? themeIds[0];
    setCurrentTheme(nextTheme);
    const mode = VAULT_THEMES[nextTheme]?.mode || 'dark';
    document.documentElement.setAttribute('data-theme', getThemeClass(nextTheme));
    document.documentElement.classList.toggle('dark', mode === 'dark');
    localStorage.setItem('vault-theme', nextTheme.toString());
  };

  // Infinite scroll
  const handleScroll = () => {
    if (!mainRef.current || isolatedGroup || scrollThrottle.current) return;
    const { scrollTop, scrollHeight, clientHeight } = mainRef.current;
    if (scrollHeight - scrollTop <= clientHeight * 1.5) {
      // ⚡ BOLT OPTIMIZATION:
      // Throttling the infinite scroll handler prevents rapid, redundant state updates
      // and main-thread blocking when users scroll quickly near the bottom of the list.
      scrollThrottle.current = true;
      setSectionLimit(prev => prev + 20); // soft load 20 more
      setTimeout(() => {
        scrollThrottle.current = false;
      }, 300);
    }
  };

  // ⚡ BOLT OPTIMIZATION:
  // Hoisting `.toLowerCase()` conversion out of the filter loop avoids O(N) redundant
  // string instantiations on every keystroke during live searches.
  const searchableValues = useMemo(() => {
    return items.map(item => {
      const targetValue = item[searchField];
      if (targetValue === null || targetValue === undefined) return null;
      if (Array.isArray(targetValue)) {
        return targetValue.map(v => v.toString().toLowerCase());
      }
      return targetValue.toString().toLowerCase();
    });
  }, [items, searchField]);

  const filtered = useMemo(() => {
    if (!effectiveSearch) return items;

    const searchStr = effectiveSearch.toLowerCase();

    return items.filter((_, index) => {
      const targetValue = searchableValues[index];
      if (!targetValue) return false;
      
      if (Array.isArray(targetValue)) {
        return targetValue.some(v => v.includes(searchStr));
      }
      
      return targetValue.includes(searchStr);
    });
  }, [items, effectiveSearch, searchableValues]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const valA = a[sortBy];
      const valB = b[sortBy];

      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      let comparison = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        comparison = valA - valB;
      } else {
        comparison = collator.compare(valA.toString(), valB.toString());
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filtered, sortBy, sortOrder]);

  const grouped = useMemo(() => {
    if (groupBy === 'None') return { 'All Items': sorted };
    
    return sorted.reduce((acc, item) => {
      const key = getDomainFromUrl(item.url, true);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {} as Record<string, VideoData[]>);
  }, [sorted, groupBy]);

  const viewClasses: Record<number, string> = {
    1: 'flex flex-col gap-[1px] w-full', // Details (compact list)
    2: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2', // List mode
    3: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', // Small
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', // Medium
    5: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3', // Large
    6: 'grid-cols-1 xl:grid-cols-2', // Biggest
  };

  // Card shell classes per view size.
  // Views 5 & 6 use landscape (flex-row) layout like view 2 because they're
  // too wide for a portrait card proportions at 1-2 columns.
  const CARD_CLASS: Record<number, string> = {
    1: "flex-row items-center gap-2 h-[60px] px-3 py-1 border-b border-vault-border rounded-none shadow-none hover:bg-vault-cardBg/50",
    2: "flex-row items-stretch p-0 h-[110px] hover:-translate-y-1",
    3: "flex-col h-[200px]",
    4: "flex-col h-[250px]",
    5: "flex-row items-stretch p-0 h-[200px]",
    6: "flex-row items-stretch p-0 h-[260px]",
  };

  // Thumbnail wrapper classes per view size.
  const THUMB_CLASS: Record<number, string> = {
    2: "relative w-2/5 flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb rounded-l-lg border-r border-vault-border",
    3: "relative w-full h-[130px] flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb border-b border-vault-border rounded-t-lg",
    4: "relative w-full h-[163px] flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb border-b border-vault-border rounded-t-lg",
    5: "relative w-[38%] flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb rounded-l-lg border-r border-vault-border",
    6: "relative w-2/5 flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb rounded-l-lg border-r border-vault-border",
  };

  // If isolated, display that group. Else display UP TO `sectionLimit` groups.
  const groupsToRender = isolatedGroup
    ? [ [isolatedGroup, grouped[isolatedGroup] || []] as const ]
    : Object.entries(grouped).slice(0, sectionLimit);

  // When filter / sort options change while the user is in the isolated-group
  // drill-down, automatically return to the main dashboard view so the
  // filter applies across all groups (going back "with filter" as UX).
  useEffect(() => {
    setIsolatedGroup(null);
  }, [effectiveSearch, sortBy, sortOrder, groupBy]);

  // Helper to change page for a group
  const setGroupPage = (groupName: string, delta: number) => {
    setPages(prev => ({
      ...prev,
      [groupName]: Math.max(0, (prev[groupName] || 0) + delta)
    }));
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-vault-bg text-vault-text font-sans antialiased transition-colors duration-500">

      <LockedBanner
        visible={vaultLocked}
        pinLength={pinSettings?.length ?? 4}
        onUnlocked={() => setVaultLocked(false)}
      />

      {/* HEADER */}
      <header style={{ backgroundColor: 'var(--vault-card-bg)' }} className="flex-none h-16 flex items-center justify-between px-4 md:px-6 z-20 backdrop-blur-md border-b border-vault-border shadow-sm relative">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="text-vault-accent">
              <Icons.VaultWaresIcon size={26} strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <h1 className="text-xl font-bold tracking-tight flex items-center gap-1">
                Vault<span className="text-vault-accent font-light">Central</span>
              </h1>
              <p className="text-[9px] text-vault-muted font-medium tracking-wider uppercase">
                Secure Media Vault // <a href="https://vaultwares.com" target="_blank" rel="noreferrer" className="hover:text-vault-accent underline transition-colors">VaultWares.com</a>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group flex items-center">
            {/* Field selector — icon overlay on native select */}
            <div className="relative flex-none">
              <Icons.SortIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-vault-muted/70 pointer-events-none" size={13} />
              <select
                value={searchField}
                onChange={(e) => setSearchField(e.target.value as keyof VideoData)}
                className="bg-vault-cardBg border border-vault-border border-r-0 rounded-l-full pl-8 pr-4 py-2 text-sm text-vault-text focus:border-vault-accent focus:z-10 outline-none appearance-none cursor-pointer"
              >
                <option value="title">Title</option>
                <option value="author">Author</option>
                <option value="domain">Domain</option>
                <option value="url">URL</option>
                <option value="quality">Quality</option>
                <option value="resolution">Res</option>
                <option value="description">Desc</option>
                <option value="tags">Tags</option>
              </select>
            </div>
            <div className="relative flex-1">
              <Icons.SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-vault-muted group-focus-within:text-vault-accent transition-colors" size={16} />
              <input
                type="text"
                placeholder={`Search in ${searchField}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-12 pr-4 py-2 w-64 bg-vault-cardBg border border-vault-border rounded-r-full outline-none focus:border-vault-accent focus:z-10 text-sm transition-all"
              />
            </div>
          </div>

          <button onClick={() => setIsSettingsOpen(true)} className="vault-btn flex items-center justify-center p-1.5 rounded-full h-7 w-7 group" title="Vault Settings">
            <Icons.SettingsIcon size={14} className="text-vault-accent group-hover:text-vault-bg transition-colors duration-200" />
          </button>
          <button onClick={cycleTheme} className="vault-btn flex items-center justify-center p-1.5 rounded-full h-7 w-7 group" title="Cycle Theme">
            <Icons.ThemeIcon size={14} className="text-vault-accent group-hover:text-vault-bg transition-colors duration-200" />
          </button>
        </div>
      </header>

      {/* VIEWPORT */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* SIDEBAR CONTAINER */}
        <div className="flex flex-none relative z-20">
          {/* SIDEBAR */}
          <aside 
            data-testid="dashboard-sidebar"
            className={cn(
            "bg-vault-cardBg/30 border-r border-vault-border transition-all duration-300 overflow-y-auto h-full flex flex-col gap-6",
            isSidebarOpen ? "w-64 p-4 opacity-100 visible" : "w-0 p-0 opacity-0 invisible border-none"
          )}>
            <div className="space-y-4">
            {/* View Mode */}
            <div>
              <label className="text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-1.5 tracking-tight">
                <Icons.ViewModeIcon size={14} className="text-vault-accent" /> View Mode
              </label>
              <input 
                type="range" 
                min="1" 
                max="6" 
                value={viewSize} 
                onChange={(e) => setViewSize(parseInt(e.target.value))}
                className="w-full accent-vault-accent"
              />
              <div className="flex justify-between text-[10px] text-vault-muted mt-1 font-semibold">
                <span>Details</span>
                <span>Biggest</span>
              </div>
            </div>

            {/* Theme Config */}
            <div>
              <label className="text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-1.5 tracking-tight">
                <Icons.ThemeIcon size={14} className="text-vault-accent" /> UI Theme
              </label>
              <select 
                value={currentTheme}
                onChange={(e) => changeTheme(parseInt(e.target.value))}
                className="w-full bg-vault-bg border border-vault-border text-xs p-1.5 rounded outline-none focus:border-vault-accent text-vault-text"
              >
                {Object.values(VAULT_THEMES).map(t => (
                  <option key={t.id} value={t.id}>{t.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} ({t.mode})</option>
                ))}
              </select>
            </div>
            {/* Grouping */}
            <div>
              <label className="text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-1.5 tracking-tight">
                <Icons.GroupIcon size={14} className="text-vault-accent" /> Group By
              </label>
              <select 
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                className="w-full bg-vault-bg border border-vault-border text-xs p-1.5 rounded outline-none focus:border-vault-accent text-vault-text"
              >
                <option value="None">None (Flat List)</option>
                <option value="Hostname">Source Hostname</option>
              </select>
            </div>

            {/* Sorting */}
            <div className="space-y-2">
               <label className="text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-1.5 tracking-tight">
                <Icons.SortIcon size={14} className="text-vault-accent" /> Sort Params
              </label>
              <div className="flex gap-2">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as keyof VideoData)}
                  className="flex-1 bg-vault-bg border border-vault-border text-[10px] p-1.5 rounded outline-none focus:border-vault-accent text-vault-text"
                >
                  <option value="timestamp">Date Saved</option>
                  <option value="datePublished">Date Published</option>
                  <optgroup label="Metadata Fields">
                    <option value="title">Title</option>
                    <option value="author">Author</option>
                    <option value="domain">Domain</option>
                    <option value="views">Views</option>
                    <option value="likes">Likes</option>
                    <option value="dislikes">Dislikes</option>
                    <option value="quality">Quality</option>
                    <option value="resolution">Resolution</option>
                    <option value="size">Size</option>
                  </optgroup>
                </select>
                <button
                  onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="vault-btn p-1 px-2 text-[10px] font-bold"
                  title="Toggle Asc/Desc"
                >
                  {sortOrder === 'asc' ? 'ASC' : 'DESC'}
                </button>
              </div>
            </div>
            
            <hr className="border-vault-border opacity-50 my-2" />
            
            {/* PIN System */}
            <div className="pt-2">
              <label className="text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-2 tracking-tight">
                <Icons.PinIcon size={14} className="text-vault-accent" /> PIN Protection
              </label>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-vault-muted font-bold uppercase tracking-widest">Master PIN</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={pinSettings?.enabled || false} 
                      onChange={togglePin}
                    />
                    <div className="w-9 h-5 bg-vault-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-transparent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-vault-bg after:border-vault-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-vault-accent peer-checked:after:bg-white" />
                  </label>
                </div>

                {pinSettings?.enabled && (
                  <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                    <div>
                      <span className="text-[9px] text-vault-muted font-bold block mb-1.5 uppercase opacity-60">Sequence Length</span>
                      <div className="flex gap-2">
                        {[4, 6].map(len => (
                          <button
                            key={len}
                            onClick={() => updatePinLength(len as 4 | 6)}
                            className={cn(
                              "flex-1 py-1 text-[10px] font-black rounded-sm border transition-all",
                              pinSettings.length === len 
                                ? "bg-vault-accent border-vault-accent text-vault-bg shadow-[0_0_10px_-2px_var(--color-vault-accent)]" 
                                : "bg-vault-bg border-vault-border text-vault-muted hover:border-vault-muted"
                            )}
                          >
                            {len} DIGITS
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-[9px] text-vault-muted font-bold block mb-1.5 uppercase opacity-60">Auto-Locker Delay</span>
                      <select 
                        value={pinSettings.lockTimeout}
                        onChange={(e) => updateLockTimeout(parseInt(e.target.value))}
                        className="w-full bg-vault-bg border border-vault-border text-[10px] p-1.5 rounded outline-none focus:border-vault-accent text-vault-text font-bold"
                      >
                        <option value={600000}>10 Minutes</option>
                        <option value={1800000}>30 Minutes</option>
                        <option value={3600000}>1 Hour</option>
                        <option value={7200000}>2 Hours</option>
                        <option value={-1}>Never (Manual only)</option>
                      </select>
                    </div>

                    <button
                      onClick={async () => {
                        // Tell background to clear its in-memory unlocked
                        // vault. The polling effect picks up the new state
                        // and surfaces the LockedBanner.
                        await vaultLock();
                        const next = { ...pinSettings, lastUnlocked: 1 };
                        await savePinSettings(next);
                        setPinSettings(next);
                        setVaultLocked(true);
                        setItems([]);
                      }}
                      className="w-full py-1.5 text-[10px] font-black uppercase tracking-widest bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all rounded-sm"
                    >
                      Lock Vault Now
                    </button>
                  </div>
                )}
              </div>
            </div>

            <hr className="border-vault-border opacity-50 my-2" />
            
            {/* Sync Option */}
            <div className="pt-2">
              <label className="text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-1.5 tracking-tight">
                <Icons.DebugIcon size={14} className="text-vault-accent" /> Persistence
              </label>
              <button
                onClick={handleToggleBrowserSync}
                disabled={isSyncBusy}
                className={cn(
                  "w-full vault-btn p-2 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2",
                  isSyncing
                    ? "bg-vault-accent text-vault-bg border-transparent hover:border-dashed hover:border-vault-accentHover"
                    : "border-dashed border-vault-border text-vault-muted opacity-60 hover:opacity-100",
                  isSyncBusy && "cursor-wait opacity-70"
                )}
                title={isFirefox ? "Use Firefox Sync Storage" : "Use Chrome Sync Storage"}
              >
                <div className={cn("w-1.5 h-1.5 rounded-full", isSyncing ? "bg-vault-bg animate-pulse" : "bg-vault-muted")} />
                {isSyncBusy ? "Syncing..." : isSyncing ? "Sync Enabled" : "Enable Browser Sync"}
              </button>
              <p className="text-[9px] text-vault-muted mt-2 leading-relaxed opacity-60 italic">
                {isFirefox 
                  ? "Uses Firefox Sync to backup metadata across devices (excludes large binary previews)." 
                  : "Uses Chrome Sync for metadata only, chunked for browser quota limits."}
              </p>
            </div>

            <hr className="border-vault-border opacity-50 my-2" />
            
            <div className="text-xs text-vault-muted space-y-2">
              <p>Total Items: <strong className="text-vault-accent">{items.length}</strong></p>
              <p>Visible: <strong className="text-vault-text">{filtered.length}</strong></p>
            </div>
          </div>
        </aside>
          
          {/* TOGGLE BAR */}
          <div 
            onClick={() => {
              const newState = !isSidebarOpen;
              setSidebarOpen(newState);
              localStorage.setItem('vault-sidebar-open', newState.toString());
            }}
            className="w-4 bg-vault-cardBg/50 hover:bg-vault-cardBg border-r border-vault-border flex flex-col items-center justify-center cursor-pointer transition-colors group z-30"
            title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
          >
            <div className="w-1 h-8 rounded-full bg-vault-border group-hover:bg-vault-accent transition-colors" />
          </div>
        </div>

        {/* MAIN ITEM WINDOW */}
        <main ref={mainRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 md:p-6 bg-vault-bg/50 scroll-smooth">
          <div className="max-w-[1920px] mx-auto space-y-10">
            
            {isolatedGroup && (
              <div className="mb-6">
                <button 
                  onClick={() => setIsolatedGroup(null)}
                  className="vault-btn flex items-center gap-2"
                >
                  <Icons.BackIcon size={16} /> Back to Dashboard
                </button>
              </div>
            )}

            {groupsToRender.map(([groupName, groupItems]) => {
              const currentPage = pages[groupName] || 0;
              // If isolated, show all items using simple array, otherwise paginate
              const maxRows = 2;
              // perRow comes from the actual breakpoint that matches the current
              // viewport, not a substring search of the class string. The first
              // search ("grid-cols-4") would otherwise win against "grid-cols-5",
              // breaking pagination at every viewport size.
              const perRow = computePerRow(viewSize);
              const itemsPerPage = isolatedGroup ? groupItems.length : perRow * maxRows;
              
              const displayItems = isolatedGroup 
                ? groupItems 
                : groupItems.slice(currentPage * itemsPerPage, (currentPage + 1) * itemsPerPage);
              
              const totalPages = Math.ceil(groupItems.length / itemsPerPage);

              return (
                <section key={groupName} className="space-y-4">
                  {/* Section Header */}
                  <div className="flex items-center justify-between">
                    <div 
                      className={cn("flex items-center gap-3", !isolatedGroup && "cursor-pointer group")}
                      onClick={() => !isolatedGroup && setIsolatedGroup(groupName)}
                    >
                      <h2 className="text-base font-semibold text-vault-text inline-flex items-center gap-2.5 tracking-tight transition-colors group-hover:text-vault-accent">
                        <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-vault-accent shrink-0" />
                        {groupName}
                      </h2>
                      <span className="text-xs bg-vault-cardBg border border-vault-border px-2 py-0.5 rounded-full text-vault-muted font-bold">
                        {groupItems.length}
                      </span>
                    </div>

                    {/* Pagination Controls (Only on non-isolated view and if multiple pages) */}
                    {!isolatedGroup && totalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setGroupPage(groupName, -1)}
                          disabled={currentPage === 0}
                          className="vault-btn p-1 h-7 w-7 flex items-center justify-center disabled:opacity-30"
                        >
                          <Icons.ChevronLeftIcon size={14} />
                        </button>
                        <span className="text-[10px] font-mono font-bold text-vault-muted w-10 text-center">
                          {currentPage + 1} / {totalPages}
                        </span>
                        <button 
                          onClick={() => setGroupPage(groupName, 1)}
                          disabled={currentPage >= totalPages - 1}
                          className="vault-btn p-1 h-7 w-7 flex items-center justify-center disabled:opacity-30"
                        >
                          <Icons.ChevronRightIcon size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Section Grid */}
                  <div className={cn(
                    "grid gap-4 md:gap-6",
                    viewClasses[viewSize as keyof typeof viewClasses]
                  )}>
                    {displayItems.map((fav, idx) => (
                      <div key={`${fav.url}-${idx}`} className={cn(
                        "vault-card group relative flex transform transition-all hover:shadow-lg overflow-hidden",
                        CARD_CLASS[viewSize]
                      )}>
                        
                        {/* THUMBNAIL AREA */}
                        {viewSize >= 2 && (
                          <div 
                            onClick={(e) => {
                              // If clicking an action button inside the thumb, don't trigger play
                              if ((e.target as HTMLElement).closest('.thumb-action')) return;

                              if (fav.type === 'video' && fav.rawVideoSrc) {
                                setPlayingVideo(fav);
                                setVideoError(false);
                                setIsRefreshing(false);
                              } else {
                                // Test-mode override: suppress popups during automated tests
                                if (typeof window !== 'undefined' && (window as any).__TEST_MODE__) {
                                  if ((window as any).__MOCK_WINDOW_OPEN__) {
                                    (window as any).__MOCK_WINDOW_OPEN__(fav.url);
                                  }
                                  // No-op in test mode
                                } else {
                                  window.open(fav.url, '_blank');
                                }
                              }
                            }}
                            className={THUMB_CLASS[viewSize]}
                          >
                            {fav.type === 'video' ? (
                              <PreviewThumb video={fav} />
                            ) : (
                              isDisplayableImageThumbnail(fav.thumbnail) ? (
                                // ⚡ BOLT OPTIMIZATION: `loading="lazy"` prevents fetching all images simultaneously.
                                <img src={fav.thumbnail} alt={fav.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover/thumb:scale-105" />
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-vault-cardBg to-vault-bg/50">
                                    <Icons.DebugIcon size={32} className="opacity-10 mb-1" />
                                    <span className="text-[10px] font-mono opacity-30">NO PREVIEW</span>
                                </div>
                              )
                            )}

                            {/* Subtle inset stroke replaces the four corner accents — quieter, no hover animation. */}
                            <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5 rounded-[inherit]" />

                            {/* Internal Thumbnail Actions */}
                            {viewSize > 2 && (
                              <>
                                <div className="absolute top-2 left-2 z-30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex flex-col gap-2">
                                  <button onClick={(e) => { e.stopPropagation(); handleEdit(fav); }} className="thumb-action p-1.5 bg-black/60 hover:bg-vault-accent text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110" title="Edit Metadata">
                                    <Icons.EditIcon size={12} />
                                  </button>
                                </div>
                                <div className="absolute top-2 right-2 z-30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex flex-col gap-2">
                                  <button onClick={(e) => { e.stopPropagation(); handleDelete(fav.url); }} className="thumb-action p-1.5 bg-black/60 hover:bg-red-500 text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110" title="Delete Item">
                                    <Icons.DeleteIcon size={12} />
                                  </button>
                                </div>
                              </>
                            )}

                            {/* Duration Badge */}
                            {fav.duration && (
                              <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shadow z-20">
                                {formatDuration(fav.duration)}
                              </div>
                            )}

                            {/* Hover overlay — gentle dim + play affordance fade. No scale jump. */}
                            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                              <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/15 transition-colors duration-200" />
                              <div className="relative w-11 h-11 rounded-full bg-white/90 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center shadow-lg transition-opacity duration-200">
                                {fav.type === 'video'
                                  ? <Icons.PlayIcon fill="currentColor" className="text-vault-bg ml-0.5" size={18} />
                                  : <Icons.ChevronRightIcon className="text-vault-bg" size={18} />}
                              </div>
                            </div>
                            
                            {/* Type chip — sentence case, no animation noise. */}
                            <div className="absolute bottom-2 left-2 z-20 opacity-0 group-hover/thumb:opacity-100 transition-opacity duration-200 pointer-events-none">
                              <div className="flex items-center gap-1.5 bg-black/55 px-2 py-0.5 rounded-full text-[10px] font-medium text-white/90 backdrop-blur-sm tracking-tight">
                                <span className="w-1 h-1 rounded-full bg-vault-accent" />
                                {fav.type === 'video' ? 'Video' : 'Link'}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* DETAILS AREA */}
                        <div className={cn("z-10 relative flex flex-col flex-1", viewSize === 1 ? "flex-row items-center justify-between w-full min-h-[60px]" : "p-4")}>
                          
                          <div className={cn("flex justify-between items-start mb-2", viewSize === 1 && "mb-0 items-center")}>
                            <div className="flex gap-2 items-center">
                              <span className={cn(
                                "text-[10px] uppercase font-bold tracking-widest text-vault-bg bg-vault-muted px-2 py-0.5 rounded-sm",
                                viewSize === 1 && "flex items-center justify-center h-5"
                              )}>
                                {viewSize > 1 ? `#${idx + 1 + (currentPage * itemsPerPage)}` : 'V-ID'}
                              </span>
                            </div>
                            {viewSize <= 2 && (
                                <div className="flex gap-1 ml-auto">
                                  <button onClick={(e) => { e.stopPropagation(); handleEdit(fav); }} className="vault-btn p-1 flex items-center justify-center border-none hover:bg-vault-cardBg" title="Edit">
                                    <Icons.EditIcon size={14} className="text-vault-muted hover:text-vault-accent" />
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); handleDelete(fav.url); }} className="vault-btn p-1 flex items-center justify-center border-none hover:bg-vault-cardBg" title="Delete">
                                    <Icons.DeleteIcon size={14} className="text-vault-muted hover:text-red-500" />
                                  </button>
                                </div>
                            )}
                          </div>
                          
                          <div className={cn("flex-1", viewSize === 1 ? "flex items-center justify-between w-full ml-4" : "flex flex-col")}>
                            <div className={viewSize === 1 ? "flex-1 mr-4" : ""}>
                              <h3 className={cn(
                                "font-bold mb-1 leading-snug cursor-pointer hover:text-vault-accent transition-colors",
                                viewSize === 1 ? "text-base line-clamp-1" : "text-[15px] line-clamp-2"
                              )}>
                                {fav.title || 'Untitled Reference'}
                              </h3>
                              <p className="text-xs text-vault-muted truncate max-w-[250px] font-mono opacity-80" title={fav.url}>
                                {(fav.domain && fav.domain !== 'Unknown') ? fav.domain : getDomainFromUrl(fav.url, true)}
                              </p>
                            </div>
                            
                            {viewSize > 1 && (
                              <div className="mt-3 space-y-1 mb-2 flex-1">
                                {fav.author && (
                                  <p className="text-[11px] text-vault-text line-clamp-1"><span className="text-vault-muted">By:</span> {fav.author}</p>
                                )}
                                {fav.actors && fav.actors.length > 0 && (
                                  <p className="text-[11px] text-vault-accent line-clamp-1 opacity-90"><span className="text-vault-muted">With:</span> {fav.actors.join(', ')}</p>
                                )}
                                {(fav.views || fav.likes) && (
                                  <p className="text-[11px] text-vault-muted flex gap-3 mt-1">
                                    {fav.views && <span><strong>{fav.views}</strong> views</span>}
                                    {fav.likes && <span><strong>{fav.likes}</strong> likes</span>}
                                  </p>
                                )}
                                {fav.tags && fav.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {fav.tags.slice(0, 3).map(tag => (
                                      <span key={tag} className="text-[9px] bg-vault-cardBg border border-vault-border px-1.5 py-0.5 rounded text-vault-muted inline-block">
                                        {tag}
                                      </span>
                                    ))}
                                    {fav.tags.length > 3 && (
                                      <span className="text-[9px] bg-vault-cardBg/50 border border-vault-border border-dashed px-1.5 py-0.5 rounded text-vault-muted inline-block">
                                        +{fav.tags.length - 3}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className={cn(
                            "flex items-center justify-between border-vault-border pt-3 mt-auto",
                            viewSize === 1 ? "border-none ml-4 gap-4 mt-0 pt-0" : "border-t"
                          )}>
                            <span className="text-[11px] font-semibold text-vault-muted tracking-wider">
                              {dateFormatter.format(fav.timestamp)}
                            </span>
                            <a 
                              href={fav.url} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-[10px] font-bold text-vault-bg bg-vault-accent hover:bg-vault-accentHover transition-colors flex items-center gap-1 px-3 py-1.5 rounded-sm"
                            >
                              OPEN <Icons.ChevronRightIcon size={12} strokeWidth={3} className="group-hover:translate-x-0.5 transition-transform" />
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

            {filtered.length === 0 && (
              <div className="py-24 text-center border border-dashed border-vault-border rounded-xl bg-vault-cardBg/30 flex flex-col items-center justify-center">
                <Icons.DebugIcon size={48} className="text-vault-border mb-4" />
                <p className="text-vault-muted text-sm font-semibold tracking-widest uppercase mb-2">
                  No encrypted items found
                </p>
                <p className="text-xs text-vault-muted opacity-60">
                   Try scanning a new target domain or clearing your filters
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Toast — soft pill, fades up. */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'fixed bottom-6 right-6 z-[100] px-4 py-2.5 rounded-full shadow-lg backdrop-blur-md text-[13px] font-medium tracking-tight border animate-in slide-in-from-bottom-2 fade-in duration-200',
            toastMessage.type === 'success'
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
              : 'bg-red-500/15 text-red-300 border-red-500/25',
          )}
        >
          {toastMessage.msg}
        </div>
      )}

      {/* CONFIRM MODAL */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-vault-cardBg border border-vault-border rounded-lg shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95">
            <h3 className="text-vault-text font-bold mb-4 flex items-center gap-2"><Icons.AlertIcon size={20} className="text-vault-accent" /> Confirm Action</h3>
            <p className="text-vault-muted text-sm">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setConfirmDialog(null)} className="px-4 py-1.5 text-xs font-bold text-vault-muted hover:text-vault-text transition-colors">Cancel</button>
              <button onClick={confirmDialog.onConfirm} className="px-4 py-1.5 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all shadow-lg">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* PROMPT MODAL */}
      {promptDialog && (
        <PromptDialog
          message={promptDialog.message}
          type={promptDialog.type}
          onCancel={() => setPromptDialog(null)}
          onConfirm={promptDialog.onConfirm}
        />
      )}

      {/* EDIT MODAL */}
      {editingItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setEditingItem(null)}>
          <div className="bg-vault-bg border border-vault-border rounded-lg shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-vault-border">
              <h2 className="text-lg font-bold text-vault-text flex items-center gap-2">
                <Icons.EditIcon size={20} className="text-vault-accent" /> Edit Metadata
              </h2>
              <button onClick={() => setEditingItem(null)} className="vault-btn p-1.5 rounded-full hover:bg-vault-bg border-none">
                <Icons.CloseIcon size={16} className="text-vault-muted" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              {['title', 'author', 'domain', 'url', 'rawVideoSrc', 'quality', 'resolution', 'size', 'description'].map((field) => (
                <div key={field} className="flex flex-col gap-1">
                  <label className="text-xs font-bold uppercase tracking-widest text-vault-muted">{field}</label>
                  {field === 'description' ? (
                     <textarea 
                       className="w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none min-h-[80px]"
                       value={(editingItem.current as any)[field] || ''}
                       onChange={(e) => setEditingItem({...editingItem, current: {...editingItem.current, [field]: e.target.value}})}
                     />
                  ) : (
                    <input 
                      type={field === 'url' ? 'url' : 'text'}
                      className="w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none"
                      value={(editingItem.current as any)[field] || ''}
                      onChange={(e) => setEditingItem({...editingItem, current: {...editingItem.current, [field]: e.target.value}})}
                    />
                  )}
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold uppercase tracking-widest text-vault-muted">Tags (Comma separated)</label>
                <input 
                  type="text"
                  className="w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none"
                  value={editingItem.current.tags?.join(', ') || ''}
                  onChange={(e) => setEditingItem({...editingItem, current: {...editingItem.current, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean)}})}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold uppercase tracking-widest text-vault-muted">Actors (Comma separated)</label>
                <input 
                  type="text"
                  className="w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none"
                  value={editingItem.current.actors?.join(', ') || ''}
                  onChange={(e) => setEditingItem({...editingItem, current: {...editingItem.current, actors: e.target.value.split(',').map(t => t.trim()).filter(Boolean)}})}
                />
              </div>
            </div>
            <div className="p-4 border-t border-vault-border flex justify-end gap-3 bg-vault-bg">
              <button onClick={() => setEditingItem(null)} className="px-5 py-2 text-xs font-bold text-vault-muted hover:text-vault-text transition-colors">Cancel</button>
              <button onClick={() => saveEditedItem(editingItem.current, editingItem.original)} className="px-5 py-2 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all shadow-lg">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* SETTINGS & EXPORT MODAL */}
      {isSettingsOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-pointer"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div 
            className="bg-vault-bg border border-vault-border rounded-lg shadow-2xl w-full max-w-2xl p-0 relative flex flex-col animate-in zoom-in-95 duration-200 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-vault-border bg-vault-cardBg">
              <h2 className="text-lg font-bold text-vault-text flex items-center gap-2">
                <Icons.SettingsIcon size={20} className="text-vault-accent" /> Advanced Options & Export
              </h2>
              <button 
                onClick={() => setIsSettingsOpen(false)} 
                className="vault-btn p-1.5 h-8 w-8 flex items-center justify-center rounded-full hover:bg-vault-bg border-none"
              >
                <Icons.CloseIcon size={16} className="text-vault-muted" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto max-h-[70vh] flex flex-col gap-8">
               
               {/* Export / Import */}
               <section>
                 <h3 className="text-sm font-black uppercase text-vault-muted mb-4 border-b border-vault-border pb-2 tracking-widest">Data Portability</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className="bg-vault-cardBg border border-vault-border rounded p-4 flex flex-col gap-3">
                     <div className="flex items-center gap-2 text-vault-text font-bold">
                       <Icons.ExportIcon size={18} className="text-vault-accent"/> Export Vault JSON
                     </div>
                     <p className="text-xs text-vault-muted leading-relaxed flex-1">
                       Download a metadata-only JSON backup of tags, references, and saved item records.
                     </p>
                     <button onClick={handleExportVault} className="vault-btn py-2 text-xs font-bold w-full bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors">
                       Generate Backup
                     </button>
                   </div>

                   <div className="bg-vault-cardBg border border-vault-border rounded p-4 flex flex-col gap-3">
                     <div className="flex items-center gap-2 text-vault-text font-bold">
                       <Icons.ImportIcon size={18} className="text-vault-accent"/> Import Vault Backup
                     </div>
                     <p className="text-xs text-vault-muted leading-relaxed flex-1">
                       Restore a previously exported Vault JSON file. Note: Pre-existing duplicate URLs will be skipped.
                     </p>
                     <label className="vault-btn py-2 text-xs font-bold w-full bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors text-center cursor-pointer">
                        Select JSON File
                        <input type="file" accept=".json" onChange={(e) => { handleImportVault(e); setIsSettingsOpen(false); }} className="hidden" />
                     </label>
                   </div>

                   <div className="col-span-1 md:col-span-2 bg-vault-cardBg border border-vault-border rounded p-4 flex flex-col gap-4">
                     <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                       <div className="flex-1">
                         <h4 className="text-vault-text font-bold flex items-center gap-2">
                           <Icons.ExportIcon size={16} className="text-vault-accent"/> Full Local Backup
                         </h4>
                         <p className="text-xs text-vault-muted mt-1 leading-relaxed">
                           Includes metadata, thumbnails, and WebM previews. Folder is relative to the browser Downloads folder; leave it blank for the Downloads root.
                         </p>
                         {backupSettings.lastBackupAt && (
                           <p className={cn(
                             "text-xs mt-2",
                             backupSettings.lastBackupStatus === 'error' ? "text-red-400" : "text-vault-accent"
                           )}>
                             Last backup: {dateTimeFormatter.format(backupSettings.lastBackupAt)}
                             {backupSettings.lastBackupStatus === 'error' ? ` - ${backupSettings.lastBackupError || 'failed'}` : ''}
                           </p>
                         )}
                       </div>
                       <label className="flex items-center gap-2 text-xs font-bold text-vault-text whitespace-nowrap">
                         <input
                           type="checkbox"
                           checked={backupSettings.enabled}
                           onChange={(e) => void handleToggleDailyBackup(e.target.checked)}
                           className="accent-vault-accent"
                         />
                         Daily automatic backup
                       </label>
                     </div>
                     <div className="flex flex-col md:flex-row gap-3">
                       <input
                         type="text"
                         value={backupFolderDraft}
                         onChange={(e) => setBackupFolderDraft(e.target.value)}
                         placeholder="Downloads root"
                         className="flex-1 bg-vault-bg border border-vault-border rounded px-3 py-2 text-xs text-vault-text focus:border-vault-accent outline-none"
                       />
                       <button
                         onClick={() => void handleSaveBackupSettings()}
                         className="vault-btn py-2 px-4 text-xs font-bold bg-vault-cardBg text-vault-text border-vault-border hover:border-vault-accent hover:text-vault-accent transition-colors"
                       >
                         Save Folder
                       </button>
                       <button
                         onClick={() => void handleRunFullBackup()}
                         disabled={isBackupBusy}
                         className="vault-btn py-2 px-5 text-xs font-bold bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                       >
                         {isBackupBusy ? "Backing Up..." : "Run Full Backup"}
                       </button>
                     </div>
                   </div>

                   <div className="col-span-1 md:col-span-2 bg-vault-cardBg border border-vault-border rounded p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                     <div className="flex-1">
                       <h4 className="text-vault-text font-bold flex items-center gap-2">
                         <Icons.DebugIcon size={16} className="text-vault-accent"/> Debug Logs
                       </h4>
                       <p className="text-xs text-vault-muted mt-1">Download background capture logs for troubleshooting extension issues.</p>
                     </div>
                     <button 
                        onClick={() => {
                          browser.runtime.sendMessage({ action: "download_debug_logs" });
                          setToastMessage({msg: "Downloading debug logs...", type: "success"});
                        }} 
                        className="vault-btn py-2 px-6 text-xs font-bold bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors shrink-0"
                     >
                       Download Logs
                     </button>
                   </div>
                 </div>
               </section>

               {/* Danger Zone */}
               <section>
                 <h3 className="text-sm font-black uppercase text-red-500/80 mb-4 border-b border-red-900/30 pb-2 tracking-widest">Danger Zone</h3>
                 <div className="bg-red-900/10 border border-red-900/30 rounded p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                   <div>
                     <h4 className="text-red-400 font-bold flex items-center gap-2"><Icons.AlertIcon size={16}/> Wipe Vault Data</h4>
                     <p className="text-xs text-red-400/70 mt-1">Permanently obliterate all bookmarks, metadata, and locally stored previews.</p>
                   </div>
                   <button onClick={handleWipeVault} className="vault-btn py-2 px-4 shadow-[0_0_15px_-3px_var(--color-red-500)] text-xs font-black uppercase tracking-widest bg-red-600 hover:bg-red-500 text-white border border-red-400/60 whitespace-nowrap">
                     Wipe Database
                   </button>
                 </div>
               </section>

            </div>
          </div>
        </div>
      )}

      {/* VIDEO PLAYER MODAL */}
      {playingVideo && (
        <div 
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center transition-all duration-700",
            isDimmed ? "bg-black/98" : "bg-black/80 backdrop-blur-sm"
          )}
          onClick={() => { setPlayingVideo(null); setIsDimmed(false); }}
        >
          <div 
            className={cn(
              "w-[90vw] max-w-5xl bg-vault-cardBg border border-vault-border rounded-lg shadow-2xl flex flex-col overflow-hidden transition-transform duration-500",
              playingVideo ? "scale-100 opacity-100" : "scale-95 opacity-0"
            )}
            onClick={e => e.stopPropagation()} // Prevent close on click inside
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-vault-border bg-vault-bg/50">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setIsDimmed(!isDimmed)}
                  className={cn(
                    "vault-btn p-1.5 h-8 w-8 flex items-center justify-center rounded-full transition-all border border-vault-border/50",
                    isDimmed ? "bg-vault-accent text-vault-bg" : "bg-vault-cardBg text-vault-muted hover:text-vault-accent"
                  )}
                  title={isDimmed ? "Turn Lights ON" : "Turn Lights OFF"}
                >
                  <Icons.ThemeIcon size={16} fill={isDimmed ? "currentColor" : "none"} />
                </button>
                <h3 className="font-bold text-lg text-vault-text line-clamp-1 pr-4">
                  {playingVideo.title || 'Untitled Video'}
                </h3>
              </div>
              <button 
                title="Close Player"
                onClick={() => { setPlayingVideo(null); setIsDimmed(false); }}
                className="vault-btn p-1.5 h-8 w-8 flex items-center justify-center rounded-full hover:bg-red-500/10 hover:text-red-500 transition-colors border-none"
              >
                <Icons.CloseIcon size={20} />
              </button>
            </div>
            
            {/* Modal Body / Player */}
            <div className="relative w-full aspect-video bg-black flex items-center justify-center group/player">
              {playingVideo.type === 'video' && playingVideo.rawVideoSrc && !videoError ? (
                <div className="w-full h-full relative">
                  <video 
                    src={playingVideo.rawVideoSrc}
                    autoPlay
                    controls
                    preload="auto"
                    className="w-full h-full object-contain"
                    playsInline
                    onError={() => setVideoError(true)}
                  />
                  {/* Status Overlay */}
                  <div className="absolute top-4 left-4 z-20 pointer-events-none transition-opacity group-hover/player:opacity-100 opacity-20 group-hover/player:delay-100">
                    <div className="flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-sm border border-vault-accent/30 backdrop-blur-md">
                      <div className="w-2 h-2 rounded-full bg-vault-accent animate-pulse" />
                      <span className="text-[10px] font-mono font-bold text-vault-accent uppercase tracking-widest">
                        Vault Stream: {playingVideo.quality || playingVideo.resolution || 'AUTO'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : videoError ? (
                <div className="text-center space-y-4 p-6">
                  <Icons.AlertIcon className="mx-auto text-yellow-500" size={48} />
                  <div>
                    <h4 className="text-vault-text font-bold text-lg mb-1">Playback Failed</h4>
                    <p className="text-vault-muted text-sm">The media link may have expired or is blocked by CORS.</p>
                  </div>
                  <div className="flex justify-center gap-3 mt-4">
                    <button 
                      className="vault-btn text-sm px-4 py-2 flex items-center gap-2"
                      onClick={async () => {
                        if (!playingVideo) return;
                        setIsRefreshing(true);
                        setVideoError(false);
                        try {
                          const response = (await browser.runtime.sendMessage({
                            action: "extract_fresh_m3u8",
                            url: playingVideo.url
                          })) as { src: string | null };
                          
                          if (response && response.src) {
                            // Update the video in local state
                            const updated = { ...playingVideo, rawVideoSrc: response.src };
                            setPlayingVideo(updated);
                            
                            // Update in permanent storage
                            const all = await getSavedVideos();
                            const idx = all.findIndex(v => v.url === playingVideo.url);
                            if (idx !== -1) {
                              all[idx].rawVideoSrc = response.src;
                              await saveVideos(all);
                              setItems(all);
                            }
                          } else {
                            setVideoError(true);
                          }
                        } catch (err) {
                          console.error("Failed to refresh video link", err);
                          setToastMessage({ msg: "Failed to refresh video link.", type: "error" });
                          setVideoError(true);
                        } finally {
                          setIsRefreshing(false);
                        }
                      }}
                      disabled={isRefreshing}
                    >
                      {isRefreshing ? 'Refreshing Link...' : 'Try Refreshing Link'}
                    </button>
                    <a 
                      href={playingVideo.url} 
                      target="_blank" 
                      rel="noreferrer"
                      className="vault-btn text-sm px-4 py-2 bg-vault-accent text-vault-bg flex items-center gap-2 hover:bg-vault-accentHover"
                    >
                      Open Original Page
                    </a>
                  </div>
                </div>
              ) : (
                <video 
                  src={playingVideo.rawVideoSrc || undefined} 
                  controls 
                  autoPlay
                  className="w-full h-full outline-none"
                  onError={() => setVideoError(true)}
                >
                  <source src={playingVideo.rawVideoSrc || undefined} />
                </video>
              )}
            </div>
            
            {/* Modal Footer / Metadata */}
            <div className="p-4 bg-vault-cardBg flex items-center justify-between text-sm text-vault-muted">
              <div>
                <span className="font-semibold text-vault-text">{playingVideo.domain || getDomainFromUrl(playingVideo.url)}</span>
                {playingVideo.author && <span className="ml-2 px-2 border-l border-vault-border">By: {playingVideo.author}</span>}
              </div>
              <div className="font-mono text-xs">
                {dateTimeFormatter.format(playingVideo.timestamp)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PIN SETUP MODAL */}
      {pinSetupOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-vault-bg border border-vault-border rounded-lg shadow-2xl p-6 w-80 flex flex-col items-center gap-5 animate-in zoom-in-95 duration-200">
            <div className="relative">
              <Icons.PinIcon size={28} className="text-vault-accent" />
              <div className="absolute -inset-1 blur-lg bg-vault-accent/20 rounded-full" />
            </div>
            <div className="text-center">
              <h3 className="text-sm font-black uppercase tracking-widest text-vault-text">Set New PIN</h3>
              <p className="text-[10px] text-vault-muted mt-1">Enter a {pinSetupLength}-digit security sequence</p>
            </div>

            {/* Length selector */}
            <div className="flex gap-2 w-full">
              {([4, 6] as const).map(len => (
                <button
                  key={len}
                  onClick={() => handlePinSetupLengthChange(len)}
                  className={cn(
                    "flex-1 py-1 text-[10px] font-black rounded-sm border transition-all",
                    pinSetupLength === len
                      ? "bg-vault-accent border-vault-accent text-vault-bg"
                      : "bg-transparent border-vault-border text-vault-muted hover:border-vault-muted"
                  )}
                >
                  {len} DIGITS
                </button>
              ))}
            </div>

            {/* PIN boxes */}
            <div className="flex gap-3 justify-center">
              {pinSetupBoxes.map((digit, idx) => (
                <input
                  key={`${pinSetupLength}-${idx}`}
                  ref={el => { pinSetupRefs.current[idx] = el; }}
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  onChange={e => handlePinSetupChange(idx, e.target.value)}
                  onKeyDown={e => handlePinSetupKeyDown(idx, e)}
                  className={cn(
                    "w-10 h-14 bg-vault-cardBg/50 border-2 rounded-xl text-center text-xl font-bold",
                    "focus:border-vault-accent focus:bg-vault-accent/5 outline-none transition-all",
                    pinSetupError ? 'border-red-500/50' : 'border-vault-border/50',
                    digit ? 'border-vault-accent/50 scale-105 shadow-[0_0_12px_-4px_var(--vault-accent)]' : ''
                  )}
                  autoFocus={idx === 0}
                />
              ))}
            </div>

            {pinSetupError && (
              <p className="text-[10px] font-black text-red-500 uppercase tracking-tight animate-in slide-in-from-top-1">
                Enter exactly {pinSetupLength} numeric digits
              </p>
            )}

            <div className="flex gap-3 w-full mt-1">
              <button
                onClick={cancelPinSetup}
                className="flex-1 px-4 py-2 text-xs font-bold text-vault-muted hover:text-vault-text border border-vault-border rounded hover:border-vault-muted transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmPinSetup}
                className="flex-1 px-4 py-2 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all"
              >
                Activate PIN
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
