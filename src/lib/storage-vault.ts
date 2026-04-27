import browser from 'webextension-polyfill';
import { StorageSchema, StorageData, VideoData, PinSettings, VideoDataSchema } from '../types/schemas';
import { STORAGE_KEYS, VAULT_CONFIG } from './constants';

const SYNC_ENABLED_KEY = 'vaultSyncEnabled';
const SYNC_META_KEY = 'savedVideosSyncMeta';
const SYNC_CHUNK_PREFIX = 'savedVideosSyncChunk';
const SYNC_CHUNK_SIZE = 7000;

type SyncMeta = {
  version: 1;
  chunkCount: number;
  updatedAt: number;
};

/**
 * [VaultAuth] Storage Vault Utility
 * ---------------------------------
 * Safely accesses the chrome.storage.local.
 */

function normalizeVideos(videos: unknown): VideoData[] {
  if (!Array.isArray(videos)) return [];

  // Manual validation to avoid Zod 'unsafe-eval' issues in Firefox
  return videos
    .filter((v: unknown) => {
      const item = v as Partial<VideoData>;
      return item && typeof item.url === 'string' && item.url.trim().length > 0;
    })
    .map((v: unknown) => {
      const item = v as Partial<VideoData>;
      try {
        return VideoDataSchema.parse({
          ...item,
          url: String(item.url),
          timestamp: Number(item.timestamp || Date.now()),
          type: (item.type === 'video' || item.type === 'image' || item.type === 'link' || item.type === 'audio' || item.type === 'torrent') ? item.type : 'link',
          domain: String(item.domain || 'Unknown'),
          tags: Array.isArray(item.tags) ? item.tags : []
        });
      } catch (e) {
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
        } as VideoData;
      }
    });
}

function getSyncChunkKey(index: number): string {
  return `${SYNC_CHUNK_PREFIX}:${index}`;
}

function splitSyncPayload(payload: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += SYNC_CHUNK_SIZE) {
    chunks.push(payload.slice(i, i + SYNC_CHUNK_SIZE));
  }
  return chunks.length > 0 ? chunks : ['[]'];
}

function sanitizeVideoForSync(video: VideoData): VideoData {
  const thumbnail = video.thumbnail?.startsWith('data:') ? undefined : video.thumbnail;
  return { ...video, thumbnail };
}

function ensureSyncStorage() {
  if (!browser.storage?.sync) {
    throw new Error('Browser sync storage is unavailable in this extension context.');
  }
  return browser.storage.sync;
}

export async function getPinSettings(): Promise<PinSettings> {
  const data: { [key: string]: any } = await browser.storage.local.get(STORAGE_KEYS.PIN_SETTINGS);
  const settings = data[STORAGE_KEYS.PIN_SETTINGS];
  const defaults: PinSettings = {
    enabled: false,
    length: VAULT_CONFIG.DEFAULT_PIN_LENGTH,
    lockTimeout: VAULT_CONFIG.DEFAULT_LOCK_TIMEOUT, // 1 hour
  };
  return { ...defaults, ...settings };
}

export async function savePinSettings(settings: PinSettings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.PIN_SETTINGS]: settings });
}

export async function isVaultLocked(): Promise<boolean> {
  const settings = await getPinSettings();
  if (!settings.enabled) return false;
  
  if (!settings.lastUnlocked) return true;
  
  // "Never" lock
  if (settings.lockTimeout === VAULT_CONFIG.NEVER_LOCK_TIMEOUT) return false;
  
  const elapsed = Date.now() - settings.lastUnlocked;
  return elapsed > settings.lockTimeout;
}

export async function getSavedVideos(ignoreLock = false): Promise<VideoData[]> {
  const locked = await isVaultLocked();
  if (locked && !ignoreLock) {
    console.warn("[VaultAuth] Attempted access to locked database.");
    return [];
  }

  try {
    const rawData: { [key: string]: any } = await browser.storage.local.get(STORAGE_KEYS.SAVED_VIDEOS);
    const videos = rawData[STORAGE_KEYS.SAVED_VIDEOS] || [];
    return normalizeVideos(videos);
  } catch (error) {
    console.error("[VaultAuth] Storage access failed:", error);
    return [];
  }
}

export async function getSyncEnabled(): Promise<boolean> {
  const data: { [key: string]: any } = await browser.storage.local.get(SYNC_ENABLED_KEY);
  return data[SYNC_ENABLED_KEY] === true;
}

export async function setSyncEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [SYNC_ENABLED_KEY]: enabled });
}

export async function getSyncedVideos(): Promise<VideoData[]> {
  const syncStorage = ensureSyncStorage();
  const metaData: { [key: string]: any } = await syncStorage.get(SYNC_META_KEY);
  const meta = metaData[SYNC_META_KEY] as SyncMeta | undefined;

  if (meta?.chunkCount) {
    const keys = Array.from({ length: meta.chunkCount }, (_, index) => getSyncChunkKey(index));
    const chunks: { [key: string]: any } = await syncStorage.get(keys);
    const payload = keys.map(key => String(chunks[key] || '')).join('');
    return normalizeVideos(JSON.parse(payload));
  }

  // Backward-compatible fallback if a future/older build wrote the array directly.
  const legacy: { [key: string]: any } = await syncStorage.get(STORAGE_KEYS.SAVED_VIDEOS);
  return normalizeVideos(legacy[STORAGE_KEYS.SAVED_VIDEOS] || []);
}

export async function saveSyncedVideos(videos: VideoData[]): Promise<void> {
  const syncStorage = ensureSyncStorage();
  const existingMeta: { [key: string]: any } = await syncStorage.get(SYNC_META_KEY);
  const previousChunkCount = Number(existingMeta[SYNC_META_KEY]?.chunkCount || 0);
  const payload = JSON.stringify(videos.map(sanitizeVideoForSync));
  const chunks = splitSyncPayload(payload);
  const updatedAt = Date.now();

  const values: { [key: string]: any } = {
    [SYNC_META_KEY]: {
      version: 1,
      chunkCount: chunks.length,
      updatedAt
    } satisfies SyncMeta
  };

  chunks.forEach((chunk, index) => {
    values[getSyncChunkKey(index)] = chunk;
  });

  await syncStorage.set(values);

  if (previousChunkCount > chunks.length) {
    const staleKeys = Array.from(
      { length: previousChunkCount - chunks.length },
      (_, index) => getSyncChunkKey(index + chunks.length)
    );
    await syncStorage.remove(staleKeys);
  }
}

export async function clearSyncedVideos(): Promise<void> {
  const syncStorage = ensureSyncStorage();
  const existingMeta: { [key: string]: any } = await syncStorage.get(SYNC_META_KEY);
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
export async function saveVideos(videos: VideoData[]): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEYS.SAVED_VIDEOS]: videos });
    if (await getSyncEnabled()) {
      try {
        await saveSyncedVideos(videos);
      } catch (syncError) {
        console.warn("[VaultAuth] Browser Sync update failed:", syncError);
      }
    }
  } catch (error) {
    console.error("[VaultAuth] Failed to save videos:", error);
    throw new Error("Persistence error: Industrial-Cyber integrity compromised.");
  }
}
