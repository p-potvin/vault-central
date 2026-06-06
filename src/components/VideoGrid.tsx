import React from 'react';
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
  2: "relative w-2/5 flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb rounded-l-lg border-r border-vault-border",
  3: "relative w-full h-[130px] flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb border-b border-vault-border rounded-t-lg",
  4: "relative w-full h-[163px] flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb border-b border-vault-border rounded-t-lg",
  5: "relative w-[38%] flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb rounded-l-lg border-r border-vault-border",
  6: "relative w-2/5 flex-none bg-vault-cardBg/50 overflow-hidden cursor-pointer group/thumb rounded-l-lg border-r border-vault-border",
};

export const VideoGrid: React.FC<VideoGridProps> = ({
  groupsToRender,
  pages,
  setGroupPage,
  viewSize,
  isolatedGroup,
  setIsolatedGroup,
  setPlayingVideo,
  setVideoError,
  setIsRefreshing,
  handleEdit,
  handleDelete,
}) => {
  return (
    <>
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
        const maxRows = 2;
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
                <div className="flex items-center gap-2 bg-vault-cardBg/60 border border-vault-border/50 rounded-full px-2 py-1 shadow-sm">
                  <button 
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
            <div className={cn(
              "grid gap-4 md:gap-6",
              viewClasses[viewSize]
            )}>
              {displayItems.map((fav, idx) => (
                <div 
                  key={`${fav.url}-${idx}`} 
                  className={cn(
                    "vault-card group relative flex overflow-hidden",
                    CARD_CLASS[viewSize]
                  )}
                >
                  {/* THUMBNAIL AREA */}
                  {viewSize >= 2 && (
                    <div 
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('.thumb-action')) return;

                        if (fav.type === 'video' && fav.rawVideoSrc) {
                          setPlayingVideo(fav);
                          setVideoError(false);
                          setIsRefreshing(false);
                        } else {
                          if (typeof window !== 'undefined' && (window as any).__TEST_MODE__) {
                            if ((window as any).__MOCK_WINDOW_OPEN__) {
                              (window as any).__MOCK_WINDOW_OPEN__(fav.url);
                            }
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
                          <img
                            src={fav.thumbnail}
                            alt={fav.title}
                            loading="lazy"
                            className="w-full h-full object-cover transition-transform duration-500 group-hover/thumb:scale-105"
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
                          <div className="absolute top-2 left-2 z-30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex flex-col gap-2">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleEdit(fav); }} 
                              className="thumb-action p-1.5 bg-black/60 hover:bg-vault-accent text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110" 
                              title="Edit Metadata"
                            >
                              <Icons.EditIcon size={12} />
                            </button>
                          </div>
                          <div className="absolute top-2 right-2 z-30 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex flex-col gap-2">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDelete(fav.url); }} 
                              className="thumb-action p-1.5 bg-black/60 hover:bg-red-500 text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110" 
                              title="Delete Item"
                            >
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

                      {/* Hover overlay */}
                      <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                        <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/15 transition-colors duration-200" />
                        <div className="relative w-11 h-11 rounded-full bg-white/90 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center shadow-lg transition-opacity duration-200">
                          {fav.type === 'video'
                            ? <Icons.PlayIcon fill="currentColor" className="text-vault-bg ml-0.5" size={18} />
                            : <Icons.ChevronRightIcon className="text-vault-bg" size={18} />}
                        </div>
                      </div>
                      
                      {/* Type chip */}
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
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleEdit(fav); }} 
                            className="vault-btn p-1 flex items-center justify-center border-none hover:bg-vault-cardBg" 
                            title="Edit"
                          >
                            <Icons.EditIcon size={14} className="text-vault-muted hover:text-vault-accent" />
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDelete(fav.url); }} 
                            className="vault-btn p-1 flex items-center justify-center border-none hover:bg-vault-cardBg" 
                            title="Delete"
                          >
                            <Icons.DeleteIcon size={14} className="text-vault-muted hover:text-red-500" />
                          </button>
                        </div>
                      )}
                    </div>
                    
                    <div className={cn("flex-1", viewSize === 1 ? "flex items-center justify-between w-full ml-4" : "flex flex-col")}>
                      <div className={viewSize === 1 ? "flex-1 mr-4" : ""}>
                        <h3 className={cn(
                          "font-bold mb-1 leading-snug cursor-pointer hover:text-vault-accent transition-colors",
                          viewSize === 1 ? "text-base line-clamp-1" : "text-[16px] line-clamp-2"
                        )}>
                          {fav.title || 'Untitled Reference'}
                        </h3>
                        <p className="text-[13px] text-vault-muted truncate max-w-[250px] font-mono opacity-80" title={fav.url}>
                          {(fav.domain && fav.domain !== 'Unknown') ? fav.domain : getDomainFromUrl(fav.url, true)}
                        </p>
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
                      <span className="text-[13px] font-semibold text-vault-muted tracking-wider">
                        {dateFormatter.format(fav.timestamp)}
                      </span>
                      <a 
                        href={fav.url} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-[12px] font-bold text-vault-bg bg-vault-accent hover:bg-vault-accentHover transition-colors flex items-center gap-1 px-3 py-1.5 rounded-sm"
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
    </>
  );
};
