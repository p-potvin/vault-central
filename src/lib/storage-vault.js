import browser from 'webextension-polyfill';
import { VideoDataSchema, VaultMaterialSchema } from '../types/schemas';
import { STORAGE_KEYS, VAULT_CONFIG } from './constants';
const SYNC_ENABLED_KEY = 'vaultSyncEnabled';
const SYNC_META_KEY = 'savedVideosSyncMeta';
const SYNC_CHUNK_PREFIX = 'savedVideosSyncChunk';
const SYNC_CHUNK_SIZE = 7000;
const BACKUP_SETTINGS_KEY = 'vaultBackupSettings';
export const DEFAULT_BACKUP_SETTINGS = {
    enabled: true,
    folder: ''
};
/**
 * [VaultAuth] Storage Vault Utility
 * ---------------------------------
 * Safely accesses the chrome.storage.local.
 */
function normalizeVideos(videos) {
    if (!Array.isArray(videos))
        return [];
    // Manual validation to avoid Zod 'unsafe-eval' issues in Firefox
    return videos
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
}
function getSyncChunkKey(index) {
    return `${SYNC_CHUNK_PREFIX}:${index}`;
}
function splitSyncPayload(payload) {
    const chunks = [];
    for (let i = 0; i < payload.length; i += SYNC_CHUNK_SIZE) {
        chunks.push(payload.slice(i, i + SYNC_CHUNK_SIZE));
    }
    return chunks.length > 0 ? chunks : ['[]'];
}
function sanitizeVideoForSync(video) {
    const thumbnail = video.thumbnail?.startsWith('data:') ? undefined : video.thumbnail;
    return { ...video, thumbnail };
}
function ensureSyncStorage() {
    if (!browser.storage?.sync) {
        throw new Error('Browser sync storage is unavailable in this extension context.');
    }
    return browser.storage.sync;
}
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
// Base64 codec for the binary fields in VaultMaterial. browser.storage.local
// serializes via structured-clone but Uint8Array round-trips to plain object
// shape across some browser versions, so we standardize on base64 strings.
export function bytesToBase64(bytes) {
    const chunks = [];
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        // ⚡ BOLT OPTIMIZATION: Using array push and join('') prevents O(N^2) memory reallocation overhead
        // from repetitive string concatenation (binary += chunk), significantly improving speed for large blobs.
        // Additionally, String.fromCharCode.apply works natively with Uint8Array, avoiding Array.from overhead.
        chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(chunks.join(''));
}
export function base64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++)
        out[i] = binary.charCodeAt(i);
    return out;
}
export async function getVaultMaterial() {
    const data = await browser.storage.local.get(STORAGE_KEYS.VAULT_MATERIAL);
    const raw = data[STORAGE_KEYS.VAULT_MATERIAL];
    if (!raw)
        return null;
    const parsed = VaultMaterialSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}
export async function saveVaultMaterial(material) {
    await browser.storage.local.set({ [STORAGE_KEYS.VAULT_MATERIAL]: material });
}
export async function clearVaultMaterial() {
    await browser.storage.local.remove(STORAGE_KEYS.VAULT_MATERIAL);
}
export async function getBackupSettings() {
    const data = await browser.storage.local.get(BACKUP_SETTINGS_KEY);
    return { ...DEFAULT_BACKUP_SETTINGS, ...(data[BACKUP_SETTINGS_KEY] || {}) };
}
export async function saveBackupSettings(settings) {
    await browser.storage.local.set({
        [BACKUP_SETTINGS_KEY]: {
            ...DEFAULT_BACKUP_SETTINGS,
            ...settings
        }
    });
}
export async function recordBackupResult(status, error) {
    const settings = await getBackupSettings();
    await saveBackupSettings({
        ...settings,
        lastBackupAt: Date.now(),
        lastBackupStatus: status,
        lastBackupError: error
    });
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
        return normalizeVideos(videos);
    }
    catch (error) {
        console.error("[VaultAuth] Storage access failed:", error);
        return [];
    }
}
export async function getSyncEnabled() {
    const data = await browser.storage.local.get(SYNC_ENABLED_KEY);
    return data[SYNC_ENABLED_KEY] === true;
}
export async function setSyncEnabled(enabled) {
    await browser.storage.local.set({ [SYNC_ENABLED_KEY]: enabled });
}
export async function getSyncedVideos() {
    const syncStorage = ensureSyncStorage();
    const metaData = await syncStorage.get(SYNC_META_KEY);
    const meta = metaData[SYNC_META_KEY];
    if (meta?.chunkCount) {
        const keys = Array.from({ length: meta.chunkCount }, (_, index) => getSyncChunkKey(index));
        const chunks = await syncStorage.get(keys);
        const payload = keys.map(key => String(chunks[key] || '')).join('');
        return normalizeVideos(JSON.parse(payload));
    }
    // Backward-compatible fallback if a future/older build wrote the array directly.
    const legacy = await syncStorage.get(STORAGE_KEYS.SAVED_VIDEOS);
    return normalizeVideos(legacy[STORAGE_KEYS.SAVED_VIDEOS] || []);
}
export async function saveSyncedVideos(videos) {
    const syncStorage = ensureSyncStorage();
    const existingMeta = await syncStorage.get(SYNC_META_KEY);
    const previousChunkCount = Number(existingMeta[SYNC_META_KEY]?.chunkCount || 0);
    const payload = JSON.stringify(videos.map(sanitizeVideoForSync));
    const chunks = splitSyncPayload(payload);
    const updatedAt = Date.now();
    const values = {
        [SYNC_META_KEY]: {
            version: 1,
            chunkCount: chunks.length,
            updatedAt
        }
    };
    chunks.forEach((chunk, index) => {
        values[getSyncChunkKey(index)] = chunk;
    });
    await syncStorage.set(values);
    if (previousChunkCount > chunks.length) {
        const staleKeys = Array.from({ length: previousChunkCount - chunks.length }, (_, index) => getSyncChunkKey(index + chunks.length));
        await syncStorage.remove(staleKeys);
    }
}
export async function clearSyncedVideos() {
    const syncStorage = ensureSyncStorage();
    const existingMeta = await syncStorage.get(SYNC_META_KEY);
    const chunkCount = Number(existingMeta[SYNC_META_KEY]?.chunkCount || 0);
    const keys = [
        SYNC_META_KEY,
        STORAGE_KEYS.SAVED_VIDEOS,
        ...Array.from({ length: chunkCount }, (_, index) => getSyncChunkKey(index))
    ];
    await syncStorage.remove(keys);
}
/**
 * [VaultAuth] Saves the videos to local storage.
 */
export async function saveVideos(videos) {
    try {
        await browser.storage.local.set({ [STORAGE_KEYS.SAVED_VIDEOS]: videos });
        if (await getSyncEnabled()) {
            try {
                await saveSyncedVideos(videos);
            }
            catch (syncError) {
                console.warn("[VaultAuth] Browser Sync update failed:", syncError);
            }
        }
    }
    catch (error) {
        console.error("[VaultAuth] Failed to save videos:", error);
        throw new Error("Persistence error: Industrial-Cyber integrity compromised.");
    }
}
