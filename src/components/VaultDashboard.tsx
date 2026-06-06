import browser from 'webextension-polyfill';

import {
  clearSyncedVideos,
  getPinSettings,
  getSavedVideos,
  getSyncEnabled,
  getSyncedVideos,
  savePinSettings,
  saveSyncedVideos,
  saveVideos,
  setSyncEnabled
} from '../lib/storage-vault';
import { clearPreviews, deletePreview, getPreview, vaultSetup, vaultStatus, vaultUnlock, vaultLock } from '../lib/vault-client';
import { VAULT_THEMES, getThemeClass } from '../lib/themes'; // Added for binary previews
import { type VideoData, VideoDataSchema } from '../types/schemas';
import { STORAGE_KEYS } from '../lib/constants';
import * as Icons from '../lib/icons';
import { cn } from '../lib/utils';
import React, { useEffect, useState, useMemo, useRef, useDeferredValue } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { SettingsDialog } from './SettingsDialog';
import { PinSetupDialog } from './PinSetupDialog';

import { PromptDialog } from './PromptDialog';
import { LockedBanner } from './LockedBanner';
import { DashboardSidebar } from './DashboardSidebar';
import { EditMetadataDialog } from './EditMetadataDialog';
import { VideoGrid } from './VideoGrid';
import {
  mergeSyncedMetadata,
  getDomainFromUrl,
  collator
} from '../lib/dashboard-utils';

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
  const [pinSetupOpen, setPinSetupOpen] = useState(false);

  // Custom Dialog States
  const [toastMessage, setToastMessage] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{message: string, onConfirm: () => void} | null>(null);
  const [promptDialog, setPromptDialog] = useState<{message: string, type?: 'password' | 'text', onConfirm: (val: string) => void} | null>(null);
  const [editingItem, setEditingItem] = useState<{current: VideoData, original: VideoData} | null>(null);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

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



  useEffect(() => {
    syncEnabledRef.current = isSyncing;
    localStorage.setItem('vault-sync-enabled', isSyncing.toString());
  }, [isSyncing]);

  const loadVideos = async () => {
    try {
      let syncEnabled = await getSyncEnabled();
      const legacySyncEnabled = localStorage.getItem('vault-sync-enabled') === 'true';
      if (!syncEnabled && legacySyncEnabled) {
        await setSyncEnabled(true);
        syncEnabled = true;
      }
      setIsSyncing(syncEnabled);

      const all = await getSavedVideos();
      setItems(all || []);

      if (syncEnabled) {
        void (async () => {
          try {
            const synced = await getSyncedVideos();
            const { merged, addedCount } = mergeSyncedMetadata(all, synced);
            if (addedCount > 0) {
              await saveVideos(merged);
              setItems(merged);
            } else {
              await saveSyncedVideos(all);
            }
          } catch (err) {
            console.error("[VaultDashboard] Browser Sync background load failed:", err);
          }
        })();
      }
    } catch (err) {
      console.error("[VaultDashboard] Failed to load videos:", err);
    }
  };

  useEffect(() => {
    if (vaultLocked) {
      setItems([]);
    } else {
      loadVideos();
    }
  }, [vaultLocked]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('vault-theme');
    if (savedTheme) {
      const themeNum = parseInt(savedTheme, 10);
      setCurrentTheme(themeNum);
    }
    // Lock to warm theme: remove any custom theme attributes and dark classes
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');

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
      const settings = await getPinSettings();
      setPinSettings(settings);
    };
    load();
    
    // Listen for browser sync updates
    const handleStorageChange = (changes: any, areaName: string) => {
      // BUG FIX: was checking changes.vault_videos but the actual key is STORAGE_KEYS.SAVED_VIDEOS ('savedVideos').
      // This listener was never firing when vault items were saved.
      if (areaName === 'local' && changes[STORAGE_KEYS.SAVED_VIDEOS]) {
        const newValue = changes[STORAGE_KEYS.SAVED_VIDEOS].newValue || [];
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



  const togglePin = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    if (enabled) {
      setPinSetupOpen(true);
      // Temporarily revert UI checkbox until confirmed
      e.target.checked = false;
    } else {
      const updated = { ...pinSettings, enabled: false };
      await savePinSettings(updated);
      setPinSettings(updated);
      setToastMessage({ msg: "PIN protection disabled.", type: "success" });
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
    localStorage.setItem('vault-theme', id.toString());
  };

  const cycleTheme = () => {
    const themeIds = Object.keys(VAULT_THEMES).map(Number).sort((a, b) => a - b);
    const idx = themeIds.indexOf(currentTheme);
    const nextTheme = themeIds[(idx + 1) % themeIds.length] ?? themeIds[0];
    setCurrentTheme(nextTheme);
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
    2: "flex-row items-stretch p-0 h-[115px]",
    3: "flex-col h-[230px]",
    4: "flex-col h-[290px]",
    5: "flex-row items-stretch p-0 h-[210px]",
    6: "flex-row items-stretch p-0 h-[270px]",
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

          {pinSettings?.enabled && (
            <button 
              onClick={async () => {
                await vaultLock();
                const next = { ...pinSettings, lastUnlocked: 0 };
                await savePinSettings(next);
                setPinSettings(next);
                setVaultLocked(true);
                setItems([]);
              }}
              className="vault-btn flex items-center justify-center p-1.5 rounded-md h-8 w-8 group border border-vault-border hover:border-vault-accent"
              title="Lock Vault"
            >
              <Icons.PinIcon size={16} className="text-vault-accent group-hover:text-vault-accent/85 transition-colors duration-200" />
            </button>
          )}

          <button onClick={() => setIsSettingsOpen(true)} className="vault-btn flex items-center justify-center p-1.5 rounded-md h-8 w-8 group border border-vault-border hover:border-vault-accent" title="Vault Settings">
            <Icons.SettingsIcon size={16} className="text-vault-accent group-hover:text-vault-accent/85 transition-colors duration-200" />
          </button>
        </div>
      </header>

      {/* VIEWPORT */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* SIDEBAR CONTAINER */}
        <div className="flex flex-none relative z-20">
          {/* SIDEBAR */}
          <DashboardSidebar
            isSidebarOpen={isSidebarOpen}
            viewSize={viewSize}
            setViewSize={setViewSize}
            groupBy={groupBy}
            setGroupBy={setGroupBy}
            sortBy={sortBy}
            setSortBy={setSortBy}
            sortOrder={sortOrder}
            setSortOrder={setSortOrder}
            pinSettings={pinSettings}
            togglePin={togglePin}
            updatePinLength={updatePinLength}
            updateLockTimeout={updateLockTimeout}
            lockVaultNow={async () => {
              await vaultLock();
              const next = { ...pinSettings, lastUnlocked: 1 };
              await savePinSettings(next);
              setPinSettings(next);
              setVaultLocked(true);
              setItems([]);
            }}
            isSyncing={isSyncing}
            isSyncBusy={isSyncBusy}
            handleToggleBrowserSync={handleToggleBrowserSync}
            isFirefox={isFirefox}
            totalItems={items.length}
            visibleItems={filtered.length}
          />
          
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
            <VideoGrid
              groupsToRender={groupsToRender}
              pages={pages}
              setGroupPage={setGroupPage}
              viewSize={viewSize}
              isolatedGroup={isolatedGroup}
              setIsolatedGroup={setIsolatedGroup}
              setPlayingVideo={setPlayingVideo}
              setVideoError={setVideoError}
              setIsRefreshing={setIsRefreshing}
              handleEdit={handleEdit}
              handleDelete={handleDelete}
            />

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
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onWipeVault={handleWipeVault}
        onImportSuccess={(nextItems) => setItems(nextItems)}
        onShowToast={(msg, type) => setToastMessage({ msg, type })}
      />

      {/* VIDEO PLAYER MODAL */}
      {playingVideo && (
        <VideoPlayer
          video={playingVideo}
          playlist={items.filter((item: VideoData) => item.type === 'video')}
          onClose={() => { setPlayingVideo(null); setIsDimmed(false); }}
          onSelectVideo={(video) => setPlayingVideo(video)}
          onRefresh={async () => {
            setIsRefreshing(true);
            try {
              const response = (await browser.runtime.sendMessage({
                action: "extract_fresh_m3u8",
                url: playingVideo.url
              })) as { src: string | null };
              
              if (response && response.src) {
                const updated = { ...playingVideo, rawVideoSrc: response.src };
                setPlayingVideo(updated);
                
                const all = await getSavedVideos();
                const idx = all.findIndex(v => v.url === playingVideo.url);
                if (idx !== -1) {
                  all[idx].rawVideoSrc = response.src;
                  await saveVideos(all);
                  setItems(all);
                }
              }
            } catch (err) {
              console.error("Failed to refresh video link", err);
              setToastMessage({ msg: "Failed to refresh video link.", type: "error" });
            } finally {
              setIsRefreshing(false);
            }
          }}
          isRefreshing={isRefreshing}
        />
      )}

      {/* PIN SETUP MODAL */}
      <PinSetupDialog
        isOpen={pinSetupOpen}
        onClose={() => setPinSetupOpen(false)}
        onSuccess={async (length) => {
          const updated = { ...pinSettings, enabled: true, length, lastUnlocked: Date.now() };
          await savePinSettings(updated);
          setPinSettings(updated);
          setToastMessage({ msg: `${length}-digit PIN activated.`, type: 'success' });
        }}
        onError={(err) => setToastMessage({ msg: err, type: 'error' })}
      />
    </div>
  );
};
