import { z } from 'zod';
export const VideoDataSchema = z.object({
    url: z.string().url(),
    rawVideoSrc: z.string().nullable().optional(),
    title: z.string().min(1).default('Untitled'),
    thumbnail: z.string().optional(),
    timestamp: z.number().default(() => Date.now()),
    type: z.enum(['video', 'image', 'link']).default('link'),
    domain: z.string().default('Unknown'),
    duration: z.string().nullable().optional(),
    views: z.string().nullable().optional(),
    uploaded: z.string().nullable().optional(),
    originalIndex: z.number().optional()
});
export const StorageSchema = z.object({
    savedVideos: z.array(VideoDataSchema).default([])
});
