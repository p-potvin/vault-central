import browser from 'webextension-polyfill';
import { VideoDataSchema } from '../types/schemas';
import { STORAGE_KEYS, VAULT_CONFIG } from './constants';
/**
 * [VaultAuth] Storage Vault Utility
 * ---------------------------------
 * Safely accesses the chrome.storage.local.
 */
export async function getPinSettings() {
    const data = await browser.storage.local.get(STORAGE_KEYS.PIN_SETTINGS);
    const settings = data[STORAGE_KEYS.PIN_SETTINGS];
    const defaults = {
        enabled: false,
        length: VAULT_CONFIG.DEFAULT_PIN_LENGTH,
        lockTimeout: VAULT_CONFIG.DEFAULT_LOCK_TIMEOUT, // 1 hour
    };
    return { ...defaults, ...settings };
}
export async function savePinSettings(settings) {
    await browser.storage.local.set({ [STORAGE_KEYS.PIN_SETTINGS]: settings });
}
export async function isVaultLocked() {
    const settings = await getPinSettings();
    if (!settings.enabled)
        return false;
    if (!settings.lastUnlocked)
        return true;
    // "Never" lock
    if (settings.lockTimeout === VAULT_CONFIG.NEVER_LOCK_TIMEOUT)
        return false;
    const elapsed = Date.now() - settings.lastUnlocked;
    return elapsed > settings.lockTimeout;
}
export async function getSavedVideos(ignoreLock = false) {
    const locked = await isVaultLocked();
    if (locked && !ignoreLock) {
        console.warn("[VaultAuth] Attempted access to locked database.");
        return [];
    }
    try {
        const rawData = await browser.storage.local.get(STORAGE_KEYS.SAVED_VIDEOS);
        const videos = rawData[STORAGE_KEYS.SAVED_VIDEOS] || [];
        if (!Array.isArray(videos))
            return [];
        // Manual validation to avoid Zod 'unsafe-eval' issues in Firefox
        const validVideos = videos
            .filter((v) => {
            const item = v;
            return item && typeof item.url === 'string' && item.url.trim().length > 0;
        })
            .map((v) => {
            const item = v;
            try {
                return VideoDataSchema.parse({
                    ...item,
                    url: String(item.url),
                    timestamp: Number(item.timestamp || Date.now()),
                    type: (item.type === 'video' || item.type === 'image' || item.type === 'link' || item.type === 'audio' || item.type === 'torrent') ? item.type : 'link',
                    domain: String(item.domain || 'Unknown'),
                    tags: Array.isArray(item.tags) ? item.tags : []
                });
            }
            catch (e) {
                // Fallback if Zod fails in specific environments or data is slightly corrupted
                return {
                    url: String(item.url),
                    rawVideoSrc: item.rawVideoSrc || null,
                    title: String(item.title || 'Untitled'),
                    thumbnail: item.thumbnail || undefined,
                    timestamp: Number(item.timestamp || Date.now()),
                    type: (item.type === 'video' || item.type === 'image') ? item.type : 'link',
                    domain: String(item.domain || 'Unknown'),
                    duration: item.duration || null,
                    views: item.views || null,
                    uploaded: item.uploaded || null,
                    originalIndex: item.originalIndex,
                    author: item.author || null,
                    likes: item.likes || null,
                    date: item.date || null,
                    tags: Array.isArray(item.tags) ? item.tags : []
                };
            }
        });
        return validVideos;
    }
    catch (error) {
        console.error("[VaultAuth] Storage access failed:", error);
        return [];
    }
}
/**
 * [VaultAuth] Saves the videos to local storage.
 */
export async function saveVideos(videos) {
    try {
        await browser.storage.local.set({ [STORAGE_KEYS.SAVED_VIDEOS]: videos });
    }
    catch (error) {
        console.error("[VaultAuth] Failed to save videos:", error);
        throw new Error("Persistence error: Industrial-Cyber integrity compromised.");
    }
}
