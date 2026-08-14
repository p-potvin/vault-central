import React, { useCallback, useState } from 'react';
import * as Icons from '../lib/icons';
import { cn } from '../lib/utils';
import { VideoData } from '../types/schemas';
import { PreviewThumb } from './PreviewThumb';
import {
  computePerRow,
  formatDuration,
  isDisplayableImageThumbnail,
  getDomainFromUrl,
  dateFormatter
} from '../lib/dashboard-utils';

interface VideoGridProps {
  groupsToRender: readonly (readonly [string, VideoData[]])[];
  pages: Record<string, number>;
  setGroupPage: (groupName: string, delta: number) => void;
  viewSize: number;
  /** Current grouping, so the card can avoid repeating what the section already says. */
  groupBy: string;
  isolatedGroup: string | null;
  setIsolatedGroup: (groupName: string | null) => void;
  setPlayingVideo: (video: VideoData | null) => void;
  setVideoError: (err: boolean) => void;
  setIsRefreshing: (ref: boolean) => void;
  handleEdit: (video: VideoData) => void;
  handleDelete: (url: string) => void;
}

const viewClasses: Record<number, string> = {
  1: 'flex flex-col gap-[1px] w-full', // Details (compact list)
  2: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2', // List mode
  3: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', // Small
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4', // Medium
  5: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3', // Large
  6: 'grid-cols-1 xl:grid-cols-2', // Biggest
};

const CARD_CLASS: Record<number, string> = {
  1: "flex-row items-center gap-2 h-[60px] px-3 py-1 border-b border-vault-border rounded-none shadow-none hover:bg-vault-cardBg/50",
  2: "flex-row items-stretch p-0 h-[115px]",
  3: "flex-col h-[230px]",
  4: "flex-col h-[290px]",
  5: "flex-row items-stretch p-0 h-[210px]",
  6: "flex-row items-stretch p-0 h-[270px]",
};

const THUMB_CLASS: Record<number, string> = {
  2: "relative w-2/5 flex-none bg-vault-cardBg/50 overflow-hidden rounded-l-lg border-r border-vault-border",
  3: "relative w-full h-[130px] flex-none bg-vault-cardBg/50 overflow-hidden border-b border-vault-border rounded-t-lg",
  4: "relative w-full h-[163px] flex-none bg-vault-cardBg/50 overflow-hidden border-b border-vault-border rounded-t-lg",
  5: "relative w-[38%] flex-none bg-vault-cardBg/50 overflow-hidden rounded-l-lg border-r border-vault-border",
  6: "relative w-2/5 flex-none bg-vault-cardBg/50 overflow-hidden rounded-l-lg border-r border-vault-border",
};

export const VideoGrid: React.FC<VideoGridProps> = ({
  groupsToRender,
  pages,
  setGroupPage,
  viewSize,
  groupBy,
  isolatedGroup,
  setIsolatedGroup,
  setPlayingVideo,
  setVideoError,
  setIsRefreshing,
  handleEdit,
  handleDelete,
}) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('vault-collapsed-groups') || '{}');
    } catch {
      return {};
    }
  });

  /**
   * Opening is now a card-level action. Interactive children (action buttons,
   * the Open link) opt out so they are not shadowed by it.
   */
  const openItem = useCallback((fav: VideoData, target: HTMLElement) => {
    if (target.closest('.thumb-action, a, button')) return;

    if (fav.type === 'video' && fav.rawVideoSrc) {
      setPlayingVideo(fav);
      setVideoError(false);
      setIsRefreshing(false);
      return;
    }
    if (typeof window !== 'undefined' && (window as any).__TEST_MODE__) {
      (window as any).__MOCK_WINDOW_OPEN__?.(fav.url);
    } else {
      window.open(fav.url, '_blank');
    }
  }, [setPlayingVideo, setVideoError, setIsRefreshing]);

  const toggleCollapsed = useCallback((groupName: string) => {
    setCollapsed(prev => {
      const next = { ...prev, [groupName]: !prev[groupName] };
      try {
        localStorage.setItem('vault-collapsed-groups', JSON.stringify(next));
      } catch { /* storage full or blocked — collapsing still works this session */ }
      return next;
    });
  }, []);

  return (
    <>
      {isolatedGroup && (
        <div className="mb-6">
          <button
            type="button"
            title="Back to all groups"
            onClick={() => setIsolatedGroup(null)}
            className="vault-btn flex items-center gap-2"
          >
            <Icons.BackIcon size={16} /> Back to Dashboard
          </button>
        </div>
      )}

      {groupsToRender.map(([groupName, groupItems]) => {
        const currentPage = pages[groupName] || 0;
        const maxRows = 2;
        const perRow = computePerRow(viewSize);
        const itemsPerPage = isolatedGroup ? groupItems.length : perRow * maxRows;
        
        const displayItems = isolatedGroup 
          ? groupItems 
          : groupItems.slice(currentPage * itemsPerPage, (currentPage + 1) * itemsPerPage);
        
        const totalPages = Math.ceil(groupItems.length / itemsPerPage);
        // An isolated group is the whole view, so collapsing it would leave an
        // empty page with no way back except the header.
        const isCollapsed = !isolatedGroup && !!collapsed[groupName];
        const sectionId = `vault-group-${encodeURIComponent(groupName)}`;

        return (
          <section key={groupName} className="space-y-4">
            {/* Section Header */}
            <div className="flex items-center justify-between gap-4">
              {/* Hostname is the organising principle of this page, so the header
                * reads as a band across the content. Two separate targets: the name
                * isolates the group, the rule collapses it — keeping them apart means
                * neither action can be triggered by aiming at the other. */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => !isolatedGroup && setIsolatedGroup(groupName)}
                  disabled={!!isolatedGroup}
                  title={isolatedGroup ? `Showing only ${groupName}` : `Show only ${groupName}`}
                  className={cn(
                    "group inline-flex items-center gap-2.5 shrink-0 rounded-sm",
                    !isolatedGroup && "cursor-pointer",
                    isolatedGroup && "cursor-default",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "shrink-0 bg-vault-accent transition-all duration-200",
                      // Collapsed reads as a plus (more to reveal); expanded as a
                      // minus. The dot it replaced conveyed nothing.
                      isCollapsed
                        ? "w-2.5 h-2.5 [clip-path:polygon(40%_0,60%_0,60%_40%,100%_40%,100%_60%,60%_60%,60%_100%,40%_100%,40%_60%,0_60%,0_40%,40%_40%)]"
                        : "w-2.5 h-[2px] rounded-full",
                    )}
                  />
                  <h2 className="text-[15px] font-semibold text-vault-text tracking-tight transition-colors group-hover:text-vault-accent group-disabled:text-vault-text">
                    {groupName}
                  </h2>
                </button>
                <span className="text-[11px] font-bold text-vault-muted tabular-nums shrink-0">
                  {groupItems.length}
                </span>
                <button
                  type="button"
                  onClick={() => toggleCollapsed(groupName)}
                  aria-expanded={!isCollapsed}
                  aria-controls={sectionId}
                  title={isCollapsed ? `Expand ${groupName}` : `Collapse ${groupName}`}
                  // Thin rule, generous hit area: the line is 1px but the button is
                  // full height so it is actually clickable.
                  className="group flex-1 h-6 flex items-center cursor-pointer min-w-[24px]"
                >
                  <span aria-hidden className="h-px w-full bg-vault-border transition-colors group-hover:bg-vault-accent/60" />
                </button>
              </div>

              {/* Pagination Controls (Only on non-isolated view and if multiple pages) */}
              {!isolatedGroup && !isCollapsed && totalPages > 1 && (
                <div className="flex items-center gap-2 bg-vault-cardBg/60 border border-vault-border/50 rounded-full px-2 py-1 shadow-sm">
                  <button
                    type="button"
                    aria-label={`Previous page of ${groupName}`}
                    title="Previous page"
                    onClick={() => setGroupPage(groupName, -1)}
                    disabled={currentPage === 0}
                    className="vault-btn p-1 h-8 w-8 flex items-center justify-center rounded-full border border-vault-border bg-vault-cardBg text-vault-text hover:bg-vault-accent/10 hover:border-vault-accent disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <Icons.ChevronLeftIcon size={16} />
                  </button>
                  <span className="text-xs font-mono font-black text-vault-text min-w-[48px] text-center">
                    {currentPage + 1} <span className="opacity-40">/</span> {totalPages}
                  </span>
                  <button
                    type="button"
                    aria-label={`Next page of ${groupName}`}
                    title="Next page"
                    onClick={() => setGroupPage(groupName, 1)}
                    disabled={currentPage >= totalPages - 1}
                    className="vault-btn p-1 h-8 w-8 flex items-center justify-center rounded-full border border-vault-border bg-vault-cardBg text-vault-text hover:bg-vault-accent/10 hover:border-vault-accent disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <Icons.ChevronRightIcon size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Section Grid */}
            <div
              id={sectionId}
              hidden={isCollapsed}
              className={cn(
                "grid gap-4 md:gap-6",
                viewClasses[viewSize]
              )}
            >
              {displayItems.map((fav, idx) => (
                <div
                  key={`${fav.url}-${idx}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${fav.type === 'video' ? 'Play' : 'Open'} ${fav.title || 'untitled item'}`}
                  title={fav.title || fav.url}
                  onClick={(e) => openItem(fav, e.target as HTMLElement)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openItem(fav, e.target as HTMLElement);
                    }
                  }}
                  className={cn(
                    "vault-card group relative flex overflow-hidden cursor-pointer",
                    "focus-visible:outline-none",
                    CARD_CLASS[viewSize]
                  )}
                >
                  {/* THUMBNAIL AREA */}
                  {viewSize >= 2 && (
                    <div className={THUMB_CLASS[viewSize]}>
                      {fav.type === 'video' ? (
                        <PreviewThumb video={fav} />
                      ) : (
                        isDisplayableImageThumbnail(fav.thumbnail) ? (
                          <img
                            src={fav.thumbnail}
                            alt={fav.title}
                            loading="lazy"
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            onError={(e) => {
                              const target = e.currentTarget;
                              const fallbackSrc = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"%3E%3C/rect%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"%3E%3C/circle%3E%3Cpolyline points="21 15 16 10 5 21"%3E%3C/polyline%3E%3C/svg%3E';
                              if (target.src !== fallbackSrc) {
                                target.src = fallbackSrc;
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-vault-cardBg to-vault-bg/50">
                            <Icons.DebugIcon size={32} className="opacity-10 mb-1" />
                            <span className="text-[10px] font-mono opacity-30">NO PREVIEW</span>
                          </div>
                        )
                      )}

                      <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5 rounded-[inherit]" />

                      {/* Internal Thumbnail Actions */}
                      {viewSize > 2 && (
                        <>
                          <div className="absolute top-2 left-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleEdit(fav); }} 
                              className="thumb-action h-6 w-6 flex items-center justify-center leading-none bg-black/60 hover:bg-vault-accent text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110" 
                              title="Edit metadata"
                              aria-label={`Edit metadata for ${fav.title || 'untitled item'}`}
                            >
                              <Icons.EditIcon size={12} />
                            </button>
                          </div>
                          <div className="absolute top-2 right-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDelete(fav.url); }} 
                              className="thumb-action h-6 w-6 flex items-center justify-center leading-none bg-black/60 hover:bg-red-500 text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110" 
                              title="Delete item"
                              aria-label={`Delete ${fav.title || 'untitled item'}`}
                            >
                              <Icons.DeleteIcon size={12} />
                            </button>
                          </div>
                        </>
                      )}

                      {/* Duration Badge */}
                      {fav.duration && (
                        <div title="Duration" className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shadow z-20">
                          {formatDuration(fav.duration)}
                        </div>
                      )}

                      {/* Hover overlay */}
                      <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/15 transition-colors duration-200" />
                        <div className="relative w-11 h-11 rounded-full bg-white/90 opacity-0 group-hover:opacity-100 flex items-center justify-center shadow-lg transition-opacity duration-200">
                          {fav.type === 'video'
                            ? <Icons.PlayIcon fill="currentColor" className="text-vault-bg ml-0.5" size={18} />
                            : <Icons.ChevronRightIcon className="text-vault-bg" size={18} />}
                        </div>
                      </div>
                      
                    </div>
                  )}

                  {/* DETAILS AREA */}
                  <div className={cn("z-10 relative flex flex-col flex-1", viewSize === 1 ? "flex-row items-center justify-between w-full min-h-[60px]" : "px-4 pt-4 pb-5")}>
                    {/* The "#N" chip that used to lead this row is gone. It numbered
                      * the item's position on the *current page*, so it changed as you
                      * paged and meant nothing outside that — yet it was rendered as a
                      * filled high-contrast chip, making it the loudest thing on every
                      * card. In Details view it was worse: a literal "V-ID" placeholder. */}
                    {viewSize <= 2 && (
                      <div className={cn("flex justify-end gap-1 mb-2", viewSize === 1 && "mb-0 items-center")}>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEdit(fav); }}
                          className="vault-btn h-6 w-6 flex items-center justify-center leading-none border-none hover:bg-vault-cardBg"
                          type="button"
                          title="Edit metadata"
                          aria-label={`Edit metadata for ${fav.title || 'untitled item'}`}
                        >
                          <Icons.EditIcon size={14} className="text-vault-muted hover:text-vault-accent" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(fav.url); }}
                          className="vault-btn h-6 w-6 flex items-center justify-center leading-none border-none hover:bg-vault-cardBg"
                          type="button"
                          title="Delete item"
                          aria-label={`Delete ${fav.title || 'untitled item'}`}
                        >
                          <Icons.DeleteIcon size={14} className="text-vault-muted hover:text-red-500" />
                        </button>
                      </div>
                    )}

                    <div className={cn("flex-1", viewSize === 1 ? "flex items-center justify-between w-full ml-4" : "flex flex-col")}>
                      <div className={viewSize === 1 ? "flex-1 mr-4" : ""}>
                        <h3 className={cn(
                          "font-bold mb-1 leading-snug cursor-pointer hover:text-vault-accent transition-colors",
                          // Underlined so the title reads as the card's anchor rather than
                          // blending into the domain line beneath it. Offset so descenders
                          // clear the rule.
                          "underline decoration-vault-accent/40 decoration-1 underline-offset-4 hover:decoration-vault-accent",
                          viewSize === 1 ? "text-base line-clamp-1" : "text-[16px] line-clamp-2"
                        )}>
                          {fav.title || 'Untitled Reference'}
                        </h3>
                        {groupBy !== 'Hostname' && (
                          <p className="text-[13px] text-vault-muted truncate font-mono opacity-80" title={fav.url}>
                            {(fav.domain && fav.domain !== 'Unknown') ? fav.domain : getDomainFromUrl(fav.url, true)}
                          </p>
                        )}
                      </div>
                      
                      {viewSize > 1 && (
                        <div className="mt-3 space-y-1 mb-2 flex-1">
                          {fav.author && (
                            <p className="text-[13px] text-vault-text line-clamp-1">
                              <span className="text-vault-muted">By:</span> {fav.author}
                            </p>
                          )}
                          {fav.actors && fav.actors.length > 0 && (
                            <p className="text-[13px] text-vault-accent line-clamp-1 opacity-90">
                              <span className="text-vault-muted">With:</span> {fav.actors.join(', ')}
                            </p>
                          )}
                          {(fav.views || fav.likes) && (
                            <p className="text-[13px] text-vault-muted flex gap-3 mt-1">
                              {fav.views && <span><strong>{fav.views}</strong> views</span>}
                              {fav.likes && <span><strong>{fav.likes}</strong> likes</span>}
                            </p>
                          )}
                          {fav.tags && fav.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {fav.tags.slice(0, 3).map(tag => (
                                <span key={tag} className="text-[11px] bg-vault-cardBg border border-vault-border px-1.5 py-0.5 rounded text-vault-muted inline-block">
                                  {tag}
                                </span>
                              ))}
                              {fav.tags.length > 3 && (
                                <span className="text-[11px] bg-vault-cardBg/50 border border-vault-border border-dashed px-1.5 py-0.5 rounded text-vault-muted inline-block">
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
                      <span className="text-[12px] text-vault-muted tracking-wide">
                        {dateFormatter.format(fav.timestamp)}
                      </span>
                      {/* Demoted from a filled accent button. The thumbnail already
                        * opens the item, so this is the secondary route — and one
                        * saturated gold block per card, five per row, drowned out the
                        * previews the page exists to show. It earns colour on hover. */}
                      <a
                        href={fav.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={`Open ${fav.url} in a new tab`}
                        aria-label={`Open ${fav.title || 'item'} in a new tab`}
                        className="text-[12px] font-semibold text-vault-muted hover:text-vault-accent transition-colors flex items-center gap-0.5"
                      >
                        Open <Icons.ChevronRightIcon size={12} strokeWidth={3} className="transition-transform group-hover:translate-x-0.5" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
};
