import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import browser from 'webextension-polyfill';
import { clearSyncedVideos, getPinSettings, getSavedVideos, getSyncEnabled, getSyncedVideos, savePinSettings, saveSyncedVideos, saveVideos, setSyncEnabled } from '../lib/storage-vault';
import { clearPreviews, deletePreview, vaultStatus, vaultLock } from '../lib/vault-client';
import { VAULT_THEMES } from '../lib/themes'; // Added for binary previews
import { STORAGE_KEYS } from '../lib/constants';
import * as Icons from '../lib/icons';
import { cn } from '../lib/utils';
import { useEffect, useState, useMemo, useRef, useDeferredValue } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { SettingsDialog } from './SettingsDialog';
import { PinSetupDialog } from './PinSetupDialog';
import { PromptDialog } from './PromptDialog';
import { LockedBanner } from './LockedBanner';
import { PreviewThumb } from './PreviewThumb';
import { computePerRow, formatDuration, isDisplayableImageThumbnail, mergeSyncedMetadata, getDomainFromUrl, dateFormatter, collator } from '../lib/dashboard-utils';
export const VaultDashboard = () => {
    const [items, setItems] = useState([]);
    const [search, setSearch] = useState('');
    const deferredSearch = useDeferredValue(search);
    // When search is cleared, use the immediate value so the list resets instantly.
    const effectiveSearch = search === '' ? search : deferredSearch;
    const [searchField, setSearchField] = useState('title');
    const [currentTheme, setCurrentTheme] = useState(3);
    // Sidebar states
    const [isSidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('vault-sidebar-open');
        return saved !== 'false';
    });
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [pinSetupOpen, setPinSetupOpen] = useState(false);
    // Custom Dialog States
    const [toastMessage, setToastMessage] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [promptDialog, setPromptDialog] = useState(null);
    const [editingItem, setEditingItem] = useState(null);
    useEffect(() => {
        if (toastMessage) {
            const timer = setTimeout(() => setToastMessage(null), 3000);
            return () => clearTimeout(timer);
        }
    }, [toastMessage]);
    const handleDelete = async (url) => {
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
    const handleEdit = (video) => {
        setEditingItem({ current: JSON.parse(JSON.stringify(video)), original: video });
    };
    const saveEditedItem = async (updatedVideo, originalVideo) => {
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
                }
                catch (err) {
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
    const [sortBy, setSortBy] = useState(() => {
        const raw = localStorage.getItem('vault-sort-by');
        if (raw === 'DateDesc' || raw === 'DateAsc' || !raw)
            return 'timestamp';
        return raw;
    });
    const [sortOrder, setSortOrder] = useState(() => {
        const raw = localStorage.getItem('vault-sort-order');
        if (raw === 'asc' || raw === 'desc')
            return raw;
        // If old DateAsc was the saved field, the user wanted ascending dates.
        return localStorage.getItem('vault-sort-by') === 'DateAsc' ? 'asc' : 'desc';
    });
    const [viewSize, setViewSize] = useState(() => {
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
    const [isolatedGroup, setIsolatedGroup] = useState(null);
    const [pages, setPages] = useState({});
    const [sectionLimit, setSectionLimit] = useState(50);
    const mainRef = useRef(null);
    const scrollThrottle = useRef(false);
    // Video Player Modal states
    const [playingVideo, setPlayingVideo] = useState(null);
    const [videoError, setVideoError] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    // PIN Settings
    const [pinSettings, setPinSettings] = useState(null);
    // Vault lock state — polled from background. The banner appears whenever
    // the vault is enabled but locked (auto-lock fired while dashboard open).
    const [vaultLocked, setVaultLocked] = useState(false);
    useEffect(() => {
        let cancelled = false;
        const tick = async () => {
            try {
                const s = await vaultStatus();
                if (cancelled)
                    return;
                setVaultLocked(s.success && s.enabled && s.locked);
            }
            catch { /* background may be cycling — ignore one tick */ }
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
        if (savedViewSize)
            setViewSize(parseInt(savedViewSize, 10));
        const savedGroupBy = localStorage.getItem('vault-group-by');
        if (savedGroupBy)
            setGroupBy(savedGroupBy);
        const savedSortBy = localStorage.getItem('vault-sort-by');
        if (savedSortBy)
            setSortBy(savedSortBy);
        const savedSortOrder = localStorage.getItem('vault-sort-order');
        if (savedSortOrder)
            setSortOrder(savedSortOrder);
        const load = async () => {
            const settings = await getPinSettings();
            setPinSettings(settings);
            let syncEnabled = await getSyncEnabled();
            const legacySyncEnabled = localStorage.getItem('vault-sync-enabled') === 'true';
            if (!syncEnabled && legacySyncEnabled) {
                await setSyncEnabled(true);
                syncEnabled = true;
            }
            setIsSyncing(syncEnabled);
            let all = await getSavedVideos();
            if (syncEnabled) {
                try {
                    const synced = await getSyncedVideos();
                    const { merged, addedCount } = mergeSyncedMetadata(all, synced);
                    if (addedCount > 0) {
                        await saveVideos(merged);
                        all = merged;
                    }
                    else {
                        await saveSyncedVideos(all);
                    }
                }
                catch (err) {
                    console.error("[VaultDashboard] Browser Sync load failed:", err);
                    setToastMessage({ msg: "Browser Sync metadata could not be loaded.", type: "error" });
                }
            }
            setItems(all || []);
        };
        load();
        // Listen for browser sync updates
        const handleStorageChange = (changes, areaName) => {
            // BUG FIX: was checking changes.vault_videos but the actual key is STORAGE_KEYS.SAVED_VIDEOS ('savedVideos').
            // This listener was never firing when vault items were saved.
            if (areaName === 'local' && changes[STORAGE_KEYS.SAVED_VIDEOS]) {
                const newValue = changes[STORAGE_KEYS.SAVED_VIDEOS].newValue || [];
                setItems(newValue);
            }
            if (areaName === 'sync' && syncEnabledRef.current) {
                const keys = Object.keys(changes);
                const syncChanged = keys.some(key => key === 'savedVideosSyncMeta' ||
                    key === STORAGE_KEYS.SAVED_VIDEOS ||
                    key.startsWith('savedVideosSyncChunk:'));
                if (!syncChanged)
                    return;
                void (async () => {
                    try {
                        const localItems = await getSavedVideos(true);
                        const syncedItems = await getSyncedVideos();
                        const { merged, addedCount } = mergeSyncedMetadata(localItems, syncedItems);
                        if (addedCount > 0) {
                            await saveVideos(merged);
                            setItems(merged);
                        }
                    }
                    catch (err) {
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
        }
        catch (err) {
            console.error("[VaultDashboard] Failed to enable Browser Sync:", err);
            await setSyncEnabled(false);
            setIsSyncing(false);
            setToastMessage({ msg: "Browser Sync failed to enable. Metadata may be too large for sync storage.", type: "error" });
        }
        finally {
            setIsSyncBusy(false);
        }
    };
    const disableBrowserSync = async () => {
        setIsSyncBusy(true);
        try {
            await setSyncEnabled(false);
            setIsSyncing(false);
            setToastMessage({ msg: "Browser Sync disabled. Local vault unchanged.", type: "success" });
        }
        catch (err) {
            console.error("[VaultDashboard] Failed to disable Browser Sync:", err);
            setToastMessage({ msg: "Failed to disable Browser Sync.", type: "error" });
        }
        finally {
            setIsSyncBusy(false);
        }
    };
    const handleToggleBrowserSync = () => {
        if (isSyncBusy)
            return;
        void (isSyncing ? disableBrowserSync() : enableBrowserSync());
    };
    const togglePin = async (e) => {
        const enabled = e.target.checked;
        if (enabled) {
            setPinSetupOpen(true);
            // Temporarily revert UI checkbox until confirmed
            e.target.checked = false;
        }
        else {
            const updated = { ...pinSettings, enabled: false };
            await savePinSettings(updated);
            setPinSettings(updated);
            setToastMessage({ msg: "PIN protection disabled.", type: "success" });
        }
    };
    const updatePinLength = async (len) => {
        const updated = { ...pinSettings, length: len };
        await savePinSettings(updated);
        setPinSettings(updated);
    };
    const updateLockTimeout = async (timeout) => {
        const updated = { ...pinSettings, lockTimeout: timeout };
        await savePinSettings(updated);
        setPinSettings(updated);
    };
    const changeTheme = (id) => {
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
        if (!mainRef.current || isolatedGroup || scrollThrottle.current)
            return;
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
            if (targetValue === null || targetValue === undefined)
                return null;
            if (Array.isArray(targetValue)) {
                return targetValue.map(v => v.toString().toLowerCase());
            }
            return targetValue.toString().toLowerCase();
        });
    }, [items, searchField]);
    const filtered = useMemo(() => {
        if (!effectiveSearch)
            return items;
        const searchStr = effectiveSearch.toLowerCase();
        return items.filter((_, index) => {
            const targetValue = searchableValues[index];
            if (!targetValue)
                return false;
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
            if (valA === undefined || valA === null)
                return 1;
            if (valB === undefined || valB === null)
                return -1;
            let comparison = 0;
            if (typeof valA === 'number' && typeof valB === 'number') {
                comparison = valA - valB;
            }
            else {
                comparison = collator.compare(valA.toString(), valB.toString());
            }
            return sortOrder === 'asc' ? comparison : -comparison;
        });
    }, [filtered, sortBy, sortOrder]);
    const grouped = useMemo(() => {
        if (groupBy === 'None')
            return { 'All Items': sorted };
        return sorted.reduce((acc, item) => {
            const key = getDomainFromUrl(item.url, true);
            if (!acc[key])
                acc[key] = [];
            acc[key].push(item);
            return acc;
        }, {});
    }, [sorted, groupBy]);
    const viewClasses = {
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
    const CARD_CLASS = {
        1: "flex-row items-center gap-2 h-[60px] px-3 py-1 border-b border-vault-border rounded-none shadow-none hover:bg-vault-cardBg/50",
        2: "flex-row items-stretch p-0 h-[115px]",
        3: "flex-col h-[230px]",
        4: "flex-col h-[290px]",
        5: "flex-row items-stretch p-0 h-[210px]",
        6: "flex-row items-stretch p-0 h-[270px]",
    };
    // Thumbnail wrapper classes per view size.
    const THUMB_CLASS = {
        2: "relative w-2/5 flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb rounded-l-lg border-r border-vault-border",
        3: "relative w-full h-[130px] flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb border-b border-vault-border rounded-t-lg",
        4: "relative w-full h-[163px] flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb border-b border-vault-border rounded-t-lg",
        5: "relative w-[38%] flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb rounded-l-lg border-r border-vault-border",
        6: "relative w-2/5 flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb rounded-l-lg border-r border-vault-border",
    };
    // If isolated, display that group. Else display UP TO `sectionLimit` groups.
    const groupsToRender = isolatedGroup
        ? [[isolatedGroup, grouped[isolatedGroup] || []]]
        : Object.entries(grouped).slice(0, sectionLimit);
    // When filter / sort options change while the user is in the isolated-group
    // drill-down, automatically return to the main dashboard view so the
    // filter applies across all groups (going back "with filter" as UX).
    useEffect(() => {
        setIsolatedGroup(null);
    }, [effectiveSearch, sortBy, sortOrder, groupBy]);
    // Helper to change page for a group
    const setGroupPage = (groupName, delta) => {
        setPages(prev => ({
            ...prev,
            [groupName]: Math.max(0, (prev[groupName] || 0) + delta)
        }));
    };
    return (_jsxs("div", { className: "flex flex-col h-screen overflow-hidden bg-vault-bg text-vault-text font-sans antialiased transition-colors duration-500", children: [_jsx(LockedBanner, { visible: vaultLocked, pinLength: pinSettings?.length ?? 4, onUnlocked: () => setVaultLocked(false) }), _jsxs("header", { style: { backgroundColor: 'var(--vault-card-bg)' }, className: "flex-none h-16 flex items-center justify-between px-4 md:px-6 z-20 backdrop-blur-md border-b border-vault-border shadow-sm relative", children: [_jsx("div", { className: "flex items-center gap-4", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "text-vault-accent", children: _jsx(Icons.VaultWaresIcon, { size: 26, strokeWidth: 2.5 }) }), _jsxs("div", { className: "leading-tight", children: [_jsxs("h1", { className: "text-xl font-bold tracking-tight flex items-center gap-1", children: ["Vault", _jsx("span", { className: "text-vault-accent font-light", children: "Central" })] }), _jsxs("p", { className: "text-[9px] text-vault-muted font-medium tracking-wider uppercase", children: ["Secure Media Vault // ", _jsx("a", { href: "https://vaultwares.com", target: "_blank", rel: "noreferrer", className: "hover:text-vault-accent underline transition-colors", children: "VaultWares.com" })] })] })] }) }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "relative group flex items-center", children: [_jsxs("div", { className: "relative flex-none", children: [_jsx(Icons.SortIcon, { className: "absolute left-2.5 top-1/2 -translate-y-1/2 text-vault-muted/70 pointer-events-none", size: 13 }), _jsxs("select", { value: searchField, onChange: (e) => setSearchField(e.target.value), className: "bg-vault-cardBg border border-vault-border border-r-0 rounded-l-full pl-8 pr-4 py-2 text-sm text-vault-text focus:border-vault-accent focus:z-10 outline-none appearance-none cursor-pointer", children: [_jsx("option", { value: "title", children: "Title" }), _jsx("option", { value: "author", children: "Author" }), _jsx("option", { value: "domain", children: "Domain" }), _jsx("option", { value: "url", children: "URL" }), _jsx("option", { value: "quality", children: "Quality" }), _jsx("option", { value: "resolution", children: "Res" }), _jsx("option", { value: "description", children: "Desc" }), _jsx("option", { value: "tags", children: "Tags" })] })] }), _jsxs("div", { className: "relative flex-1", children: [_jsx(Icons.SearchIcon, { className: "absolute left-3 top-1/2 -translate-y-1/2 text-vault-muted group-focus-within:text-vault-accent transition-colors", size: 16 }), _jsx("input", { type: "text", placeholder: `Search in ${searchField}...`, value: search, onChange: (e) => setSearch(e.target.value), className: "pl-12 pr-4 py-2 w-64 bg-vault-cardBg border border-vault-border rounded-r-full outline-none focus:border-vault-accent focus:z-10 text-sm transition-all" })] })] }), _jsx("button", { onClick: () => setIsSettingsOpen(true), className: "vault-btn flex items-center justify-center p-1.5 rounded-md h-8 w-8 group border border-vault-border hover:border-vault-accent", title: "Vault Settings", children: _jsx(Icons.SettingsIcon, { size: 16, className: "text-vault-accent group-hover:text-vault-accent/85 transition-colors duration-200" }) })] })] }), _jsxs("div", { className: "flex flex-1 overflow-hidden relative", children: [_jsxs("div", { className: "flex flex-none relative z-20", children: [_jsx("aside", { "data-testid": "dashboard-sidebar", className: cn("bg-vault-cardBg/30 border-r border-vault-border transition-all duration-300 overflow-y-auto h-full flex flex-col gap-6", isSidebarOpen ? "w-64 p-4 opacity-100 visible" : "w-0 p-0 opacity-0 invisible border-none"), children: _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsxs("label", { className: "text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-1.5 tracking-tight", children: [_jsx(Icons.ViewModeIcon, { size: 14, className: "text-vault-accent" }), " View Mode"] }), _jsx("input", { type: "range", min: "1", max: "6", value: viewSize, onChange: (e) => setViewSize(parseInt(e.target.value)), className: "w-full accent-vault-accent" }), _jsxs("div", { className: "flex justify-between text-[10px] text-vault-muted mt-1 font-semibold", children: [_jsx("span", { children: "Details" }), _jsx("span", { children: "Biggest" })] })] }), _jsxs("div", { children: [_jsxs("label", { className: "text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-1.5 tracking-tight", children: [_jsx(Icons.GroupIcon, { size: 14, className: "text-vault-accent" }), " Group By"] }), _jsxs("select", { value: groupBy, onChange: (e) => setGroupBy(e.target.value), className: "w-full bg-vault-bg border border-vault-border text-xs p-1.5 rounded outline-none focus:border-vault-accent text-vault-text", children: [_jsx("option", { value: "None", children: "None (Flat List)" }), _jsx("option", { value: "Hostname", children: "Source Hostname" })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsxs("label", { className: "text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-1.5 tracking-tight", children: [_jsx(Icons.SortIcon, { size: 14, className: "text-vault-accent" }), " Sort Params"] }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("select", { value: sortBy, onChange: (e) => setSortBy(e.target.value), className: "flex-1 bg-vault-bg border border-vault-border text-[10px] p-1.5 rounded outline-none focus:border-vault-accent text-vault-text", children: [_jsx("option", { value: "timestamp", children: "Date Saved" }), _jsx("option", { value: "datePublished", children: "Date Published" }), _jsxs("optgroup", { label: "Metadata Fields", children: [_jsx("option", { value: "title", children: "Title" }), _jsx("option", { value: "author", children: "Author" }), _jsx("option", { value: "domain", children: "Domain" }), _jsx("option", { value: "views", children: "Views" }), _jsx("option", { value: "likes", children: "Likes" }), _jsx("option", { value: "dislikes", children: "Dislikes" }), _jsx("option", { value: "quality", children: "Quality" }), _jsx("option", { value: "resolution", children: "Resolution" }), _jsx("option", { value: "size", children: "Size" })] })] }), _jsx("button", { onClick: () => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc'), className: "vault-btn p-1 px-2 text-[10px] font-bold", title: "Toggle Asc/Desc", children: sortOrder === 'asc' ? 'ASC' : 'DESC' })] })] }), _jsx("hr", { className: "border-vault-border opacity-50 my-2" }), _jsxs("div", { className: "pt-2", children: [_jsxs("label", { className: "text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-2 tracking-tight", children: [_jsx(Icons.PinIcon, { size: 14, className: "text-vault-accent" }), " PIN Protection"] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[10px] text-vault-muted font-bold uppercase tracking-widest", children: "Master PIN" }), _jsxs("label", { className: "relative inline-flex items-center cursor-pointer", children: [_jsx("input", { type: "checkbox", className: "sr-only peer", checked: pinSettings?.enabled || false, onChange: togglePin }), _jsx("div", { className: "w-9 h-5 bg-vault-border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-transparent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-vault-bg after:border-vault-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-vault-accent peer-checked:after:bg-white" })] })] }), pinSettings?.enabled && (_jsxs("div", { className: "space-y-3 animate-in slide-in-from-top-2 duration-300", children: [_jsxs("div", { children: [_jsx("span", { className: "text-[9px] text-vault-muted font-bold block mb-1.5 uppercase opacity-60", children: "Sequence Length" }), _jsx("div", { className: "flex gap-2", children: [4, 6].map(len => (_jsxs("button", { onClick: () => updatePinLength(len), className: cn("flex-1 py-1 text-[10px] font-black rounded-sm border transition-all", pinSettings.length === len
                                                                                    ? "bg-vault-accent border-vault-accent text-vault-bg shadow-[0_0_10px_-2px_var(--color-vault-accent)]"
                                                                                    : "bg-vault-bg border-vault-border text-vault-muted hover:border-vault-muted"), children: [len, " DIGITS"] }, len))) })] }), _jsxs("div", { children: [_jsx("span", { className: "text-[9px] text-vault-muted font-bold block mb-1.5 uppercase opacity-60", children: "Auto-Locker Delay" }), _jsxs("select", { value: pinSettings.lockTimeout, onChange: (e) => updateLockTimeout(parseInt(e.target.value)), className: "w-full bg-vault-bg border border-vault-border text-[10px] p-1.5 rounded outline-none focus:border-vault-accent text-vault-text font-bold", children: [_jsx("option", { value: 600000, children: "10 Minutes" }), _jsx("option", { value: 1800000, children: "30 Minutes" }), _jsx("option", { value: 3600000, children: "1 Hour" }), _jsx("option", { value: 7200000, children: "2 Hours" }), _jsx("option", { value: -1, children: "Never (Manual only)" })] })] }), _jsx("button", { onClick: async () => {
                                                                        // Tell background to clear its in-memory unlocked
                                                                        // vault. The polling effect picks up the new state
                                                                        // and surfaces the LockedBanner.
                                                                        await vaultLock();
                                                                        const next = { ...pinSettings, lastUnlocked: 1 };
                                                                        await savePinSettings(next);
                                                                        setPinSettings(next);
                                                                        setVaultLocked(true);
                                                                        setItems([]);
                                                                    }, className: "w-full py-1.5 text-[10px] font-black uppercase tracking-widest bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all rounded-sm", children: "Lock Vault Now" })] }))] })] }), _jsx("hr", { className: "border-vault-border opacity-50 my-2" }), _jsxs("div", { className: "pt-2", children: [_jsxs("label", { className: "text-[11px] font-semibold text-vault-muted/85 flex items-center gap-1.5 mb-1.5 tracking-tight", children: [_jsx(Icons.DebugIcon, { size: 14, className: "text-vault-accent" }), " Persistence"] }), _jsxs("button", { onClick: handleToggleBrowserSync, disabled: isSyncBusy, className: cn("w-full vault-btn p-2 text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all", isSyncing
                                                        ? "bg-vault-accent/12 text-vault-text border-vault-accent/60 hover:bg-vault-accent/22 hover:border-vault-accent/80"
                                                        : "border-dashed border-vault-border text-vault-muted opacity-60 hover:opacity-100 hover:bg-vault-accent/12 hover:border-vault-accent/60", isSyncBusy && "cursor-wait opacity-70"), title: isFirefox ? "Use Firefox Sync Storage" : "Use Chrome Sync Storage", children: [_jsx("div", { className: cn("w-1.5 h-1.5 rounded-full", isSyncing ? "bg-vault-accent animate-pulse" : "bg-vault-muted") }), isSyncBusy ? "Syncing..." : isSyncing ? "Sync Enabled" : "Enable Browser Sync"] }), _jsx("p", { className: "text-[9px] text-vault-muted mt-2 leading-relaxed opacity-60 italic", children: isFirefox
                                                        ? "Uses Firefox Sync to backup metadata across devices (excludes large binary previews)."
                                                        : "Uses Chrome Sync for metadata only, chunked for browser quota limits." })] }), _jsx("hr", { className: "border-vault-border opacity-50 my-2" }), _jsxs("div", { className: "text-xs text-vault-muted space-y-2", children: [_jsxs("p", { children: ["Total Items: ", _jsx("strong", { className: "text-vault-accent", children: items.length })] }), _jsxs("p", { children: ["Visible: ", _jsx("strong", { className: "text-vault-text", children: filtered.length })] })] })] }) }), _jsx("div", { onClick: () => {
                                    const newState = !isSidebarOpen;
                                    setSidebarOpen(newState);
                                    localStorage.setItem('vault-sidebar-open', newState.toString());
                                }, className: "w-4 bg-vault-cardBg/50 hover:bg-vault-cardBg border-r border-vault-border flex flex-col items-center justify-center cursor-pointer transition-colors group z-30", title: isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar", children: _jsx("div", { className: "w-1 h-8 rounded-full bg-vault-border group-hover:bg-vault-accent transition-colors" }) })] }), _jsx("main", { ref: mainRef, onScroll: handleScroll, className: "flex-1 overflow-y-auto p-4 md:p-6 bg-vault-bg/50 scroll-smooth", children: _jsxs("div", { className: "max-w-[1920px] mx-auto space-y-10", children: [isolatedGroup && (_jsx("div", { className: "mb-6", children: _jsxs("button", { onClick: () => setIsolatedGroup(null), className: "vault-btn flex items-center gap-2", children: [_jsx(Icons.BackIcon, { size: 16 }), " Back to Dashboard"] }) })), groupsToRender.map(([groupName, groupItems]) => {
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
                                    return (_jsxs("section", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: cn("flex items-center gap-3", !isolatedGroup && "cursor-pointer group"), onClick: () => !isolatedGroup && setIsolatedGroup(groupName), children: [_jsxs("h2", { className: "text-base font-semibold text-vault-text inline-flex items-center gap-2.5 tracking-tight transition-colors group-hover:text-vault-accent", children: [_jsx("span", { "aria-hidden": true, className: "w-1.5 h-1.5 rounded-full bg-vault-accent shrink-0" }), groupName] }), _jsx("span", { className: "text-xs bg-vault-cardBg border border-vault-border px-2 py-0.5 rounded-full text-vault-muted font-bold", children: groupItems.length })] }), !isolatedGroup && totalPages > 1 && (_jsxs("div", { className: "flex items-center gap-2 bg-vault-cardBg/60 border border-vault-border/50 rounded-full px-2 py-1 shadow-sm", children: [_jsx("button", { onClick: () => setGroupPage(groupName, -1), disabled: currentPage === 0, className: "vault-btn p-1 h-8 w-8 flex items-center justify-center rounded-full border border-vault-border bg-vault-cardBg text-vault-text hover:bg-vault-accent/10 hover:border-vault-accent disabled:opacity-30 disabled:cursor-not-allowed transition-all", children: _jsx(Icons.ChevronLeftIcon, { size: 16 }) }), _jsxs("span", { className: "text-xs font-mono font-black text-vault-text min-w-[48px] text-center", children: [currentPage + 1, " ", _jsx("span", { className: "opacity-40", children: "/" }), " ", totalPages] }), _jsx("button", { onClick: () => setGroupPage(groupName, 1), disabled: currentPage >= totalPages - 1, className: "vault-btn p-1 h-8 w-8 flex items-center justify-center rounded-full border border-vault-border bg-vault-cardBg text-vault-text hover:bg-vault-accent/10 hover:border-vault-accent disabled:opacity-30 disabled:cursor-not-allowed transition-all", children: _jsx(Icons.ChevronRightIcon, { size: 16 }) })] }))] }), _jsx("div", { className: cn("grid gap-4 md:gap-6", viewClasses[viewSize]), children: displayItems.map((fav, idx) => (_jsxs("div", { className: cn("vault-card group relative flex overflow-hidden", CARD_CLASS[viewSize]), children: [viewSize >= 2 && (_jsxs("div", { onClick: (e) => {
                                                                // If clicking an action button inside the thumb, don't trigger play
                                                                if (e.target.closest('.thumb-action'))
                                                                    return;
                                                                if (fav.type === 'video' && fav.rawVideoSrc) {
                                                                    setPlayingVideo(fav);
                                                                    setVideoError(false);
                                                                    setIsRefreshing(false);
                                                                }
                                                                else {
                                                                    // Test-mode override: suppress popups during automated tests
                                                                    if (typeof window !== 'undefined' && window.__TEST_MODE__) {
                                                                        if (window.__MOCK_WINDOW_OPEN__) {
                                                                            window.__MOCK_WINDOW_OPEN__(fav.url);
                                                                        }
                                                                        // No-op in test mode
                                                                    }
                                                                    else {
                                                                        window.open(fav.url, '_blank');
                                                                    }
                                                                }
                                                            }, className: THUMB_CLASS[viewSize], children: [fav.type === 'video' ? (_jsx(PreviewThumb, { video: fav })) : (isDisplayableImageThumbnail(fav.thumbnail) ? (
                                                                // ⚡ BOLT OPTIMIZATION: `loading="lazy"` prevents fetching all images simultaneously.
                                                                _jsx("img", { src: fav.thumbnail, alt: fav.title, loading: "lazy", className: "w-full h-full object-cover transition-transform duration-500 group-hover/thumb:scale-105", onError: (e) => {
                                                                        const target = e.currentTarget;
                                                                        const fallbackSrc = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E';
                                                                        if (target.src !== fallbackSrc) {
                                                                            target.src = fallbackSrc;
                                                                        }
                                                                    } })) : (_jsxs("div", { className: "w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-vault-cardBg to-vault-bg/50", children: [_jsx(Icons.DebugIcon, { size: 32, className: "opacity-10 mb-1" }), _jsx("span", { className: "text-[10px] font-mono opacity-30", children: "NO PREVIEW" })] }))), _jsx("div", { className: "pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5 rounded-[inherit]" }), viewSize > 2 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "absolute top-2 left-2 z-30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex flex-col gap-2", children: _jsx("button", { onClick: (e) => { e.stopPropagation(); handleEdit(fav); }, className: "thumb-action p-1.5 bg-black/60 hover:bg-vault-accent text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110", title: "Edit Metadata", children: _jsx(Icons.EditIcon, { size: 12 }) }) }), _jsx("div", { className: "absolute top-2 right-2 z-30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex flex-col gap-2", children: _jsx("button", { onClick: (e) => { e.stopPropagation(); handleDelete(fav.url); }, className: "thumb-action p-1.5 bg-black/60 hover:bg-red-500 text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110", title: "Delete Item", children: _jsx(Icons.DeleteIcon, { size: 12 }) }) })] })), fav.duration && (_jsx("div", { className: "absolute bottom-2 right-2 bg-black/80 text-white text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shadow z-20", children: formatDuration(fav.duration) })), _jsxs("div", { className: "absolute inset-0 flex items-center justify-center z-10 pointer-events-none", children: [_jsx("div", { className: "absolute inset-0 bg-black/0 group-hover/thumb:bg-black/15 transition-colors duration-200" }), _jsx("div", { className: "relative w-11 h-11 rounded-full bg-white/90 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center shadow-lg transition-opacity duration-200", children: fav.type === 'video'
                                                                                ? _jsx(Icons.PlayIcon, { fill: "currentColor", className: "text-vault-bg ml-0.5", size: 18 })
                                                                                : _jsx(Icons.ChevronRightIcon, { className: "text-vault-bg", size: 18 }) })] }), _jsx("div", { className: "absolute bottom-2 left-2 z-20 opacity-0 group-hover/thumb:opacity-100 transition-opacity duration-200 pointer-events-none", children: _jsxs("div", { className: "flex items-center gap-1.5 bg-black/55 px-2 py-0.5 rounded-full text-[10px] font-medium text-white/90 backdrop-blur-sm tracking-tight", children: [_jsx("span", { className: "w-1 h-1 rounded-full bg-vault-accent" }), fav.type === 'video' ? 'Video' : 'Link'] }) })] })), _jsxs("div", { className: cn("z-10 relative flex flex-col flex-1", viewSize === 1 ? "flex-row items-center justify-between w-full min-h-[60px]" : "p-4"), children: [_jsxs("div", { className: cn("flex justify-between items-start mb-2", viewSize === 1 && "mb-0 items-center"), children: [_jsx("div", { className: "flex gap-2 items-center", children: _jsx("span", { className: cn("text-[10px] uppercase font-bold tracking-widest text-vault-bg bg-vault-muted px-2 py-0.5 rounded-sm", viewSize === 1 && "flex items-center justify-center h-5"), children: viewSize > 1 ? `#${idx + 1 + (currentPage * itemsPerPage)}` : 'V-ID' }) }), viewSize <= 2 && (_jsxs("div", { className: "flex gap-1 ml-auto", children: [_jsx("button", { onClick: (e) => { e.stopPropagation(); handleEdit(fav); }, className: "vault-btn p-1 flex items-center justify-center border-none hover:bg-vault-cardBg", title: "Edit", children: _jsx(Icons.EditIcon, { size: 14, className: "text-vault-muted hover:text-vault-accent" }) }), _jsx("button", { onClick: (e) => { e.stopPropagation(); handleDelete(fav.url); }, className: "vault-btn p-1 flex items-center justify-center border-none hover:bg-vault-cardBg", title: "Delete", children: _jsx(Icons.DeleteIcon, { size: 14, className: "text-vault-muted hover:text-red-500" }) })] }))] }), _jsxs("div", { className: cn("flex-1", viewSize === 1 ? "flex items-center justify-between w-full ml-4" : "flex flex-col"), children: [_jsxs("div", { className: viewSize === 1 ? "flex-1 mr-4" : "", children: [_jsx("h3", { className: cn("font-bold mb-1 leading-snug cursor-pointer hover:text-vault-accent transition-colors", viewSize === 1 ? "text-base line-clamp-1" : "text-[16px] line-clamp-2"), children: fav.title || 'Untitled Reference' }), _jsx("p", { className: "text-[13px] text-vault-muted truncate max-w-[250px] font-mono opacity-80", title: fav.url, children: (fav.domain && fav.domain !== 'Unknown') ? fav.domain : getDomainFromUrl(fav.url, true) })] }), viewSize > 1 && (_jsxs("div", { className: "mt-3 space-y-1 mb-2 flex-1", children: [fav.author && (_jsxs("p", { className: "text-[13px] text-vault-text line-clamp-1", children: [_jsx("span", { className: "text-vault-muted", children: "By:" }), " ", fav.author] })), fav.actors && fav.actors.length > 0 && (_jsxs("p", { className: "text-[13px] text-vault-accent line-clamp-1 opacity-90", children: [_jsx("span", { className: "text-vault-muted", children: "With:" }), " ", fav.actors.join(', ')] })), (fav.views || fav.likes) && (_jsxs("p", { className: "text-[13px] text-vault-muted flex gap-3 mt-1", children: [fav.views && _jsxs("span", { children: [_jsx("strong", { children: fav.views }), " views"] }), fav.likes && _jsxs("span", { children: [_jsx("strong", { children: fav.likes }), " likes"] })] })), fav.tags && fav.tags.length > 0 && (_jsxs("div", { className: "flex flex-wrap gap-1 mt-2", children: [fav.tags.slice(0, 3).map(tag => (_jsx("span", { className: "text-[11px] bg-vault-cardBg border border-vault-border px-1.5 py-0.5 rounded text-vault-muted inline-block", children: tag }, tag))), fav.tags.length > 3 && (_jsxs("span", { className: "text-[11px] bg-vault-cardBg/50 border border-vault-border border-dashed px-1.5 py-0.5 rounded text-vault-muted inline-block", children: ["+", fav.tags.length - 3] }))] }))] }))] }), _jsxs("div", { className: cn("flex items-center justify-between border-vault-border pt-3 mt-auto", viewSize === 1 ? "border-none ml-4 gap-4 mt-0 pt-0" : "border-t"), children: [_jsx("span", { className: "text-[13px] font-semibold text-vault-muted tracking-wider", children: dateFormatter.format(fav.timestamp) }), _jsxs("a", { href: fav.url, target: "_blank", rel: "noreferrer", className: "text-[12px] font-bold text-vault-bg bg-vault-accent hover:bg-vault-accentHover transition-colors flex items-center gap-1 px-3 py-1.5 rounded-sm", children: ["OPEN ", _jsx(Icons.ChevronRightIcon, { size: 12, strokeWidth: 3, className: "group-hover:translate-x-0.5 transition-transform" })] })] })] })] }, `${fav.url}-${idx}`))) })] }, groupName));
                                }), filtered.length === 0 && (_jsxs("div", { className: "py-24 text-center border border-dashed border-vault-border rounded-xl bg-vault-cardBg/30 flex flex-col items-center justify-center", children: [_jsx(Icons.DebugIcon, { size: 48, className: "text-vault-border mb-4" }), _jsx("p", { className: "text-vault-muted text-sm font-semibold tracking-widest uppercase mb-2", children: "No encrypted items found" }), _jsx("p", { className: "text-xs text-vault-muted opacity-60", children: "Try scanning a new target domain or clearing your filters" })] }))] }) })] }), toastMessage && (_jsx("div", { role: "status", "aria-live": "polite", className: cn('fixed bottom-6 right-6 z-[100] px-4 py-2.5 rounded-full shadow-lg backdrop-blur-md text-[13px] font-medium tracking-tight border animate-in slide-in-from-bottom-2 fade-in duration-200', toastMessage.type === 'success'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                    : 'bg-red-500/15 text-red-300 border-red-500/25'), children: toastMessage.msg })), confirmDialog && (_jsx("div", { className: "fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4", children: _jsxs("div", { className: "bg-vault-cardBg border border-vault-border rounded-lg shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95", children: [_jsxs("h3", { className: "text-vault-text font-bold mb-4 flex items-center gap-2", children: [_jsx(Icons.AlertIcon, { size: 20, className: "text-vault-accent" }), " Confirm Action"] }), _jsx("p", { className: "text-vault-muted text-sm", children: confirmDialog.message }), _jsxs("div", { className: "flex justify-end gap-3 mt-6", children: [_jsx("button", { onClick: () => setConfirmDialog(null), className: "px-4 py-1.5 text-xs font-bold text-vault-muted hover:text-vault-text transition-colors", children: "Cancel" }), _jsx("button", { onClick: confirmDialog.onConfirm, className: "px-4 py-1.5 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all shadow-lg", children: "Confirm" })] })] }) })), promptDialog && (_jsx(PromptDialog, { message: promptDialog.message, type: promptDialog.type, onCancel: () => setPromptDialog(null), onConfirm: promptDialog.onConfirm })), editingItem && (_jsx("div", { className: "fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4", onClick: () => setEditingItem(null), children: _jsxs("div", { className: "bg-vault-bg border border-vault-border rounded-lg shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] animate-in zoom-in-95", onClick: e => e.stopPropagation(), children: [_jsxs("div", { className: "flex items-center justify-between p-4 border-b border-vault-border", children: [_jsxs("h2", { className: "text-lg font-bold text-vault-text flex items-center gap-2", children: [_jsx(Icons.EditIcon, { size: 20, className: "text-vault-accent" }), " Edit Metadata"] }), _jsx("button", { onClick: () => setEditingItem(null), className: "vault-btn p-1.5 rounded-full hover:bg-vault-bg border-none", children: _jsx(Icons.CloseIcon, { size: 16, className: "text-vault-muted" }) })] }), _jsxs("div", { className: "p-6 overflow-y-auto space-y-4", children: [['title', 'author', 'domain', 'url', 'rawVideoSrc', 'quality', 'resolution', 'size', 'description'].map((field) => (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("label", { className: "text-xs font-bold uppercase tracking-widest text-vault-muted", children: field }), field === 'description' ? (_jsx("textarea", { className: "w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none min-h-[80px]", value: editingItem.current[field] || '', onChange: (e) => setEditingItem({ ...editingItem, current: { ...editingItem.current, [field]: e.target.value } }) })) : (_jsx("input", { type: field === 'url' ? 'url' : 'text', className: "w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none", value: editingItem.current[field] || '', onChange: (e) => setEditingItem({ ...editingItem, current: { ...editingItem.current, [field]: e.target.value } }) }))] }, field))), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("label", { className: "text-xs font-bold uppercase tracking-widest text-vault-muted", children: "Tags (Comma separated)" }), _jsx("input", { type: "text", className: "w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none", value: editingItem.current.tags?.join(', ') || '', onChange: (e) => setEditingItem({ ...editingItem, current: { ...editingItem.current, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) } }) })] }), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("label", { className: "text-xs font-bold uppercase tracking-widest text-vault-muted", children: "Actors (Comma separated)" }), _jsx("input", { type: "text", className: "w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none", value: editingItem.current.actors?.join(', ') || '', onChange: (e) => setEditingItem({ ...editingItem, current: { ...editingItem.current, actors: e.target.value.split(',').map(t => t.trim()).filter(Boolean) } }) })] })] }), _jsxs("div", { className: "p-4 border-t border-vault-border flex justify-end gap-3 bg-vault-bg", children: [_jsx("button", { onClick: () => setEditingItem(null), className: "px-5 py-2 text-xs font-bold text-vault-muted hover:text-vault-text transition-colors", children: "Cancel" }), _jsx("button", { onClick: () => saveEditedItem(editingItem.current, editingItem.original), className: "px-5 py-2 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all shadow-lg", children: "Save Changes" })] })] }) })), _jsx(SettingsDialog, { isOpen: isSettingsOpen, onClose: () => setIsSettingsOpen(false), onWipeVault: handleWipeVault, onImportSuccess: (nextItems) => setItems(nextItems), onShowToast: (msg, type) => setToastMessage({ msg, type }) }), playingVideo && (_jsx(VideoPlayer, { video: playingVideo, playlist: items.filter((item) => item.type === 'video'), onClose: () => { setPlayingVideo(null); setIsDimmed(false); }, onSelectVideo: (video) => setPlayingVideo(video), onRefresh: async () => {
                    setIsRefreshing(true);
                    try {
                        const response = (await browser.runtime.sendMessage({
                            action: "extract_fresh_m3u8",
                            url: playingVideo.url
                        }));
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
                    }
                    catch (err) {
                        console.error("Failed to refresh video link", err);
                        setToastMessage({ msg: "Failed to refresh video link.", type: "error" });
                    }
                    finally {
                        setIsRefreshing(false);
                    }
                }, isRefreshing: isRefreshing })), _jsx(PinSetupDialog, { isOpen: pinSetupOpen, onClose: () => setPinSetupOpen(false), onSuccess: async (length) => {
                    const updated = { ...pinSettings, enabled: true, length, lastUnlocked: Date.now() };
                    await savePinSettings(updated);
                    setPinSettings(updated);
                    setToastMessage({ msg: `${length}-digit PIN activated.`, type: 'success' });
                }, onError: (err) => setToastMessage({ msg: err, type: 'error' }) })] }));
};
