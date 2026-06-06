import { getPreview } from './vault-client';
const domainCache = new Map();
export const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const PER_ROW_BY_VIEW_SIZE = {
    1: 1, // Details
    2: 2, // List
    3: 5, // Small
    4: 4, // Medium
    5: 3, // Large
    6: 2, // Biggest
};
export function computePerRow(viewSize) {
    return PER_ROW_BY_VIEW_SIZE[viewSize] ?? 1;
}
/**
 * Format duration to H:MM:SS or MM:SS format.
 */
export function formatDuration(d) {
    if (typeof d !== 'number' || !isFinite(d))
        return String(d ?? '');
    const total = Math.max(0, Math.floor(d));
    const s = (total % 60).toString().padStart(2, '0');
    const m = (Math.floor(total / 60) % 60).toString();
    const h = Math.floor(total / 3600);
    return h > 0 ? `${h}:${m.padStart(2, '0')}:${s}` : `${m}:${s}`;
}
export async function getPreviewForVideo(video) {
    console.debug('[getPreviewForVideo] Fetching primary for:', video.url);
    const primary = await getPreview(video.url);
    if (primary || !video.rawVideoSrc || video.rawVideoSrc === video.url) {
        console.debug('[getPreviewForVideo] Returning primary / no fallback needed. Found primary?', !!primary);
        return primary;
    }
    console.debug('[getPreviewForVideo] Primary not found, fetching fallback for:', video.rawVideoSrc);
    return getPreview(video.rawVideoSrc);
}
export function isDisplayableImageThumbnail(thumbnail) {
    return Boolean(thumbnail && !thumbnail.startsWith('data:video') && !thumbnail.startsWith('data:application/json'));
}
export function mergeSyncedMetadata(localItems, syncedItems) {
    const seen = new Set(localItems.map(item => item.url));
    const additions = syncedItems.filter(item => {
        if (seen.has(item.url))
            return false;
        seen.add(item.url);
        return true;
    });
    return {
        merged: [...localItems, ...additions],
        addedCount: additions.length
    };
}
export function getDomainFromUrl(url, removeWww = false) {
    if (!url)
        return 'Unknown';
    const cacheKey = `${url}-${removeWww}`;
    if (domainCache.has(cacheKey)) {
        return domainCache.get(cacheKey);
    }
    try {
        const urlObj = new URL(url);
        const hostname = removeWww ? urlObj.hostname.replace(/^www\./, '') : urlObj.hostname;
        const domain = hostname || 'Unknown';
        domainCache.set(cacheKey, domain);
        return domain;
    }
    catch (e) {
        domainCache.set(cacheKey, 'Unknown');
        return 'Unknown';
    }
}
