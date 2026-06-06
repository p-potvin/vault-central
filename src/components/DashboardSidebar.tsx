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
  return (
    <aside 
      data-testid="dashboard-sidebar"
      className={cn(
        "bg-vault-cardBg/30 border-r border-vault-border transition-all duration-300 overflow-y-auto h-full flex flex-col gap-6",
        isSidebarOpen ? "w-64 p-4 opacity-100 visible" : "w-0 p-0 opacity-0 invisible border-none"
      )}
    >
      <div className="space-y-4">
        {/* View Mode */}
        <div>
          <label className="text-xs font-bold text-vault-muted/90 flex items-center gap-1.5 mb-2 uppercase tracking-wider">
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

        {/* Grouping */}
        <div>
          <label className="text-xs font-bold text-vault-muted/90 flex items-center gap-1.5 mb-2 uppercase tracking-wider">
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
          <label className="text-xs font-bold text-vault-muted/90 flex items-center gap-1.5 mb-2 uppercase tracking-wider">
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
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
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
          <label className="text-xs font-bold text-vault-muted/90 flex items-center gap-1.5 mb-2.5 uppercase tracking-wider">
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
                            ? "bg-vault-accent border-vault-accent text-vault-bg shadow-[0_0_10px_-2px_var(--vault-accent)]" 
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
                  onClick={lockVaultNow}
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
          <label className="text-xs font-bold text-vault-muted/90 flex items-center gap-1.5 mb-2 uppercase tracking-wider">
            <Icons.DebugIcon size={14} className="text-vault-accent" /> Persistence
          </label>
          <button
            onClick={handleToggleBrowserSync}
            disabled={isSyncBusy}
            className={cn(
              "w-full vault-btn p-2 text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all",
              isSyncing
                ? "bg-vault-accent/12 text-vault-text border-vault-accent/60 hover:bg-vault-accent/22 hover:border-vault-accent/80"
                : "border-dashed border-vault-border text-vault-muted opacity-60 hover:opacity-100 hover:bg-vault-accent/12 hover:border-vault-accent/60",
              isSyncBusy && "cursor-wait opacity-70"
            )}
            title={isFirefox ? "Use Firefox Sync Storage" : "Use Chrome Sync Storage"}
          >
            <div className={cn("w-1.5 h-1.5 rounded-full", isSyncing ? "bg-vault-accent animate-pulse" : "bg-vault-muted")} />
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
          <p>Total Items: <strong className="text-vault-accent">{totalItems}</strong></p>
          <p>Visible: <strong className="text-vault-text">{visibleItems}</strong></p>
        </div>
      </div>
    </aside>
  );
};
