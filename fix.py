import os

code = open('background/scripts/background.ts', 'r', encoding='utf-8').read()
start_bound = code.find('async function doTabExtraction')
run_cap_index = code.find('async function runCapturePipeline')
end_bound = code.find('browser.runtime.onMessage.addListener', run_cap_index)

replacement = '''
/**
 * Run the capture pipeline directly.
 * Removed doTabExtraction because it was redundant.
 */
async function runCapturePipeline(data: any, tabId?: number, windowId?: number): Promise<any> {
    logger.log("[runCapturePipeline] Received capture request. url:", data.url);
    try {
        if (!data.thumbnail && windowId) {
            try {
                data.thumbnail = await browser.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 20 });
            } catch (e) {
                logger.warn("[runCapturePipeline] captureVisibleTab failed:", e);
            }
        }

        const saved = await getSavedVideos(true);
        if (saved.some(v => v.url === data.url)) {
            logger.warn("[runCapturePipeline] Item already in vault:", data.url);
            return { success: false, message: "Item already in vault" };
        }

        data.timestamp = Date.now();
        
        let capturedWebmPreviewDataUrl = "";
        if (data.thumbnail && data.thumbnail.startsWith('data:video')) {
            capturedWebmPreviewDataUrl = data.thumbnail;
        }

        const thumbIsWebm = Boolean(capturedWebmPreviewDataUrl);
        if (thumbIsWebm) {
            data.thumbnail = "";
        }

        data.rawVideoSrc = data.url; 
        saved.push(data);
        await saveVideos(saved);
        logger.log("[runCapturePipeline] Saved! New vault size:", saved.length);

        if (thumbIsWebm) {
            try {
                const response = await fetch(capturedWebmPreviewDataUrl);
                const blob = await response.blob();
                await savePreview(data.url, blob);
                logger.log("[runCapturePipeline] Saved injected WebM to Dexie.");
            } catch (err) {
                logger.warn("[runCapturePipeline] Failed to save WebM to Dexie:", err);
            }
        } else if (data.rawVideoSrc) {
            logger.log("[runCapturePipeline] Queuing background preview generation for:", data.rawVideoSrc);
            setupOffscreenDocument().then((ready) => {
                if (ready) {
                    browser.runtime.sendMessage({
                        action: "generate_preview_process",
                        data: {
                            previewKey: data.url,
                            sourceUrl: data.rawVideoSrc,
                            duration: data.duration || 60
                        }
                    });
                }
            });
        }
        return { success: true };
    } catch (e) {
        logger.error("[runCapturePipeline] Error during pipeline:", e);
        return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
}
'''
new_code = code[:start_bound] + replacement + code[end_bound:]
open('background/scripts/background.ts', 'w', encoding='utf-8').write(new_code)
print('Done!')
