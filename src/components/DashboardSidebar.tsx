import React from 'react';
import * as Icons from '../lib/icons';
import { cn } from '../lib/utils';
import { VideoData } from '../types/schemas';

interface DashboardSidebarProps {
  isSidebarOpen: boolean;
  viewSize: number;
  setViewSize: (size: number) => void;
  groupBy: string;
  setGroupBy: (group: string) => void;
  sortBy: keyof VideoData;
  setSortBy: (field: keyof VideoData) => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (order: 'asc' | 'desc') => void;
  pinSettings: any;
  togglePin: (e: React.ChangeEvent<HTMLInputElement>) => void;
  updatePinLength: (len: 4 | 6) => void;
  updateLockTimeout: (timeout: number) => void;
  lockVaultNow: () => void;
  isSyncing: boolean;
  isSyncBusy: boolean;
  handleToggleBrowserSync: () => void;
  isFirefox: boolean;
  totalItems: number;
  visibleItems: number;
}

export const DashboardSidebar: React.FC<DashboardSidebarProps> = ({
  isSidebarOpen,
  viewSize,
  setViewSize,
  groupBy,
  setGroupBy,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  pinSettings,
  togglePin,
  updatePinLength,
  updateLockTimeout,
  lockVaultNow,
  isSyncing,
  isSyncBusy,
  handleToggleBrowserSync,
  isFirefox,
  totalItems,
  visibleItems,
}) => {
  const sectionLabel = "text-[10px] font-bold text-vault-muted/90 flex items-center gap-1.5 mb-2 uppercase tracking-wider";
  const field = "w-full bg-vault-bg border border-vault-border text-[11px] px-2 py-1.5 rounded outline-none focus:border-vault-accent text-vault-text";

  return (
    <aside
      data-testid="dashboard-sidebar"
      className={cn(
        "bg-vault-cardBg/30 border-r border-vault-border transition-all duration-300 overflow-y-auto h-full flex flex-col",
        isSidebarOpen ? "w-60 px-4 py-4 opacity-100 visible" : "w-0 p-0 opacity-0 invisible border-none"
      )}
    >
      <div className="space-y-5">
        {/* View Mode */}
        <div>
          <label className={sectionLabel}>
            <Icons.ViewModeIcon size={13} className="text-vault-accent" /> View Mode
          </label>
          <input
            type="range"
            min="1"
            max="6"
            value={viewSize}
            onChange={(e) => setViewSize(parseInt(e.target.value))}
            className="w-full accent-vault-accent"
          />
          <div className="flex justify-between text-[9px] text-vault-muted font-semibold">
            <span>Details</span>
            <span>Biggest</span>
          </div>
        </div>

        {/* Grouping */}
        <div>
          <label className={sectionLabel}>
            <Icons.GroupIcon size={13} className="text-vault-accent" /> Group By
          </label>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className={field}
          >
            <option value="None">None (Flat List)</option>
            <option value="Hostname">Source Hostname</option>
          </select>
        </div>

        {/* Sorting */}
        <div>
          <label className={sectionLabel}>
            <Icons.SortIcon size={13} className="text-vault-accent" /> Sort Params
          </label>
          <div className="flex gap-1.5">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as keyof VideoData)}
              className={cn(field, "flex-1 min-w-0")}
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
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="vault-btn flex-none px-2.5 py-1.5 text-[10px] font-bold"
              title="Toggle Asc/Desc"
            >
              {sortOrder === 'asc' ? 'ASC' : 'DESC'}
            </button>
          </div>
        </div>

        <hr className="border-vault-border opacity-50 -mx-1" />

        {/* PIN System */}
        <div>
          <label className={sectionLabel}>
            <Icons.PinIcon size={13} className="text-vault-accent" /> PIN Protection
          </label>
          <div className="space-y-3">
            {/* Horizontal switch. Explicit px sizing: the width and height
             * utilities are exactly what broke this before (h-5 resolved to
             * 40px against a 36px width), so the pill geometry is pinned here. */}
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-[10px] text-vault-muted font-bold uppercase tracking-widest group-hover:text-vault-text transition-colors">
                Master PIN
              </span>
              <span className="relative inline-flex items-center flex-none">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={pinSettings?.enabled || false}
                  onChange={togglePin}
                />
                <span
                  style={{ width: 34, height: 18 }}
                  className="block rounded-full bg-vault-border transition-colors peer-checked:bg-vault-accent"
                />
                <span
                  style={{ width: 14, height: 14 }}
                  className="pointer-events-none absolute left-[2px] rounded-full bg-vault-cardBg shadow-sm transition-transform duration-200 peer-checked:translate-x-4"
                />
              </span>
            </label>

            {pinSettings?.enabled && (
              <div className="space-y-2.5 animate-in slide-in-from-top-2 duration-300">
                <div>
                  <span className="text-[9px] text-vault-muted font-bold block mb-1 uppercase opacity-60">Sequence Length</span>
                  <div className="flex gap-1.5">
                    {[4, 6].map(len => (
                      <button
                        key={len}
                        onClick={() => updatePinLength(len as 4 | 6)}
                        className={cn(
                          "flex-1 py-1 text-[10px] font-black rounded-sm border transition-all",
                          pinSettings.length === len
                            ? "bg-vault-accent border-vault-accent text-vault-bg"
                            : "bg-vault-bg border-vault-border text-vault-muted hover:border-vault-muted"
                        )}
                      >
                        {len} DIGITS
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[9px] text-vault-muted font-bold block mb-1 uppercase opacity-60">Auto-Locker Delay</span>
                  <select
                    value={pinSettings.lockTimeout}
                    onChange={(e) => updateLockTimeout(parseInt(e.target.value))}
                    className={cn(field, "font-bold")}
                  >
                    <option value={600000}>10 Minutes</option>
                    <option value={1800000}>30 Minutes</option>
                    <option value={3600000}>1 Hour</option>
                    <option value={7200000}>2 Hours</option>
                    <option value={-1}>Never (Manual only)</option>
                  </select>
                </div>

                <button
                  onClick={lockVaultNow}
                  className="w-full py-1.5 text-[10px] font-black uppercase tracking-widest bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all rounded-sm"
                >
                  Lock Vault Now
                </button>
              </div>
            )}
          </div>
        </div>

        <hr className="border-vault-border opacity-50 -mx-1" />

        {/* Sync Option */}
        <div>
          <label className={sectionLabel}>
            <Icons.DebugIcon size={13} className="text-vault-accent" /> Persistence
          </label>
          <button
            onClick={handleToggleBrowserSync}
            disabled={isSyncBusy}
            className={cn(
              "w-full vault-btn py-1.5 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all",
              isSyncing
                // Enabled reads as a solid accent fill, deliberately a shade darker
                // than the accent tint .vault-btn uses on hover, so "on" never gets
                // confused with "you happen to be pointing at it".
                ? "bg-vault-accentHover border-vault-accentHover text-vault-bg hover:bg-vault-accent hover:border-vault-accent"
                : "border-dashed border-vault-border text-vault-muted opacity-70 hover:opacity-100",
              isSyncBusy && "cursor-wait opacity-70"
            )}
            title={isFirefox ? "Use Firefox Sync Storage" : "Use Chrome Sync Storage"}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full flex-none", isSyncing ? "bg-vault-bg animate-pulse" : "bg-vault-muted")} />
            {isSyncBusy ? "Syncing..." : isSyncing ? "Sync Enabled" : "Enable Browser Sync"}
          </button>
          <p className="text-[9px] text-vault-muted mt-1.5 leading-snug opacity-60 italic">
            {isFirefox
              ? "Uses Firefox Sync to backup metadata across devices (excludes large binary previews)."
              : "Uses Chrome Sync for metadata only, chunked for browser quota limits."}
          </p>
        </div>

        <hr className="border-vault-border opacity-50 -mx-1" />

        <div className="flex items-center justify-between gap-2 text-[10px] text-vault-muted uppercase tracking-wider font-bold">
          <span>Total Items: <strong className="text-vault-accent font-black">{totalItems}</strong></span>
          <span>Visible: <strong className="text-vault-text font-black">{visibleItems}</strong></span>
        </div>
      </div>
    </aside>
  );
};
