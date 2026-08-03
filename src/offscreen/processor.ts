/**
 * processor.ts — Offscreen document that generates video previews.
 *
 * Only needed where the background context has no DOM: Chrome MV3 service
 * workers. Firefox's MV3 background is an event page and calls
 * generatePreview() directly, so this document never loads there.
 *
 * The generation itself lives in src/lib/preview-generator.ts so both hosts run
 * identical code; this file is just the offscreen message endpoint.
 */

import browser from 'webextension-polyfill';
import { savePreview } from '../lib/vault-client';
import { generatePreview } from '../lib/preview-generator';

browser.runtime.onMessage.addListener((message: any) => {
    if (message.action !== 'generate_preview_process') return undefined;
    return handleGeneratePreviewProcess(message);
});

async function handleGeneratePreviewProcess(message: any) {
    const { previewKey, sourceUrl, url, frameCount } = message.data ?? {};
    const mediaUrl = sourceUrl || url;
    const storageKey = previewKey || url || sourceUrl;

    if (!mediaUrl || !storageKey) {
        return { success: false, error: 'Missing preview source URL or storage key' };
    }

    try {
        console.log('[VaultProcessor] Generating preview for:', mediaUrl);
        const { blob, capture, reason } = await generatePreview(mediaUrl, frameCount);

        if (capture) {
            console.log(
                `[VaultProcessor] Capture: ${capture.frames.length}/${capture.attempted} usable` +
                ` (${capture.timedOut} seek timeouts, ${capture.blank} blank, ${capture.tainted} tainted)`,
            );
        }

        if (!blob) {
            console.error('[VaultProcessor] No preview stored:', reason);
            return { success: false, error: reason || 'Preview generation returned no blob' };
        }

        await savePreview(storageKey, blob);
        console.log('[VaultProcessor] Preview stored:', blob.size, 'bytes');
        return { success: true };
    } catch (err: any) {
        console.error('[VaultProcessor] Preview generation failed:', err);
        return { success: false, error: 'Preview generation failed' };
    }
}
