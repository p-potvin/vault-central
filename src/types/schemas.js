import { z } from 'zod';
export const VideoDataSchema = z.object({
    url: z.string().url(),
    rawVideoSrc: z.string().nullable().optional(),
    title: z.string().min(1).default('Untitled'),
    thumbnail: z.string().optional(),
    timestamp: z.number().default(() => Date.now()),
    type: z.enum(['video', 'image', 'link', 'audio', 'torrent']).default('link'),
    domain: z.string().default('Unknown'),
    duration: z.union([z.string(), z.number()]).nullable().optional(),
    views: z.string().nullable().optional(),
    uploaded: z.string().nullable().optional(),
    originalIndex: z.number().optional(),
    author: z.string().nullable().optional(),
    likes: z.string().nullable().optional(),
    dislikes: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    actors: z.array(z.string()).optional(),
    date: z.string().nullable().optional(),
    datePublished: z.string().nullable().optional(),
    dateSaved: z.number().optional(),
    resolution: z.string().nullable().optional(),
    bitrate: z.string().nullable().optional(),
    quality: z.string().nullable().optional(),
    size: z.string().nullable().optional(),
    length: z.union([z.string(), z.number()]).nullable().optional(),
    previewStatus: z.enum(['pending', 'processing', 'success', 'failed']).optional(),
});
export const StorageSchema = z.object({
    savedVideos: z.array(VideoDataSchema).default([])
});
// PIN settings store the lock policy and (legacy) the raw PIN. Post-upgrade,
// the `pin` field is migrated to the new VaultMaterial on first unlock and
// then cleared. Keep the field optional and zod-tolerant so existing vaults
// load without a deserialization error during the migration window.
export const PinSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    /** @deprecated Legacy plaintext PIN. Cleared after migration to VaultMaterial. */
    pin: z.string().optional(),
    length: z.union([z.literal(4), z.literal(6)]).default(4),
    lockTimeout: z.union([
        z.literal(600000), // 10 min
        z.literal(1800000), // 30 min
        z.literal(3600000), // 1 hour
        z.literal(7200000), // 2 hours
        z.literal(-1) // Never
    ]).default(3600000),
    lastUnlocked: z.number().optional(),
});
// VaultMaterial — at-rest envelope state per the zero-knowledge standard.
// All Uint8Array fields are stored as base64 strings so they survive
// browser.storage.local serialization. The runtime helpers convert.
export const VaultMaterialSchema = z.object({
    schemaVersion: z.literal(1).default(1),
    algorithm: z.union([z.literal('ml-kem-1024'), z.literal('ml-kem-512'), z.literal('aes-only')]),
    argonSalt: z.string(), // base64 — 16 bytes
    pinVerifier: z.string(), // base64 — 32 bytes (sha256 of KEK || 'verify')
    publicKey: z.string().optional(), // base64 — ML-KEM public key (omitted in 'aes-only')
    wrappedPrivateKey: z.string().optional(), // base64 — AES-GCM ciphertext of ML-KEM private key
    wrappedPrivateKeyIv: z.string().optional(), // base64 — 12 bytes
});
