import browser from 'webextension-polyfill';
import {
    getBackupSettings,
    getSavedVideos,
    recordBackupResult,
    saveBackupSettings,
    saveVideos
} from '../../src/lib/storage-vault';
import { savePreview } from '../../src/lib/dexie-store';
import { DAILY_BACKUP_ALARM, downloadFullVaultBackup } from '../../src/lib/backup-vault';
import { STORAGE_KEYS } from '../../src/lib/constants';

class DebugLogger {
    private logs: string[] = [];

    private formatArg(arg: any): string {
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        if (typeof arg === 'bigint') return arg.toString();
        if (typeof arg !== 'object' || arg === null) return String(arg);
        try {
            return JSON.stringify(arg);
        } catch {
            return Object.prototype.toString.call(arg);
        }
    }
    
    log(msg: string, ...args: any) {
        const line = `[${new Date().toISOString()}] [VaultAuth-Debug] ${msg} ${args.map((a: any) => this.formatArg(a)).join(' ')}`;
        console.log(line);
        this.logs.push(line);
        if (this.logs.length > 500) this.logs.shift();
    }
    
    warn(msg: string, ...args: any) {
        const line = `[${new Date().toISOString()}] [VaultAuth-Warn] ${msg} ${args.map((a: any) => this.formatArg(a)).join(' ')}`;
        console.warn(line);
        this.logs.push(line);
        if (this.logs.length > 500) this.logs.shift();
    }
    
    error(msg: string, ...args: any) {
        const line = `[${new Date().toISOString()}] [VaultAuth-Error] ${msg} ${args.map((a: any) => this.formatArg(a)).join(' ')}`;
        console.error(line);
        this.logs.push(line);
        if (this.logs.length > 500) this.logs.shift();
    }

    async downloadLogFile() {
        const blob = new Blob([this.logs.join('\n')], { type: 'text/plain' });
        const objUrl = URL.createObjectURL(blob);
        await browser.downloads.download({ url: objUrl, filename: `vault_central_debug_${Date.now()}.log` });
        URL.revokeObjectURL(objUrl);
    }
}
const logger = new DebugLogger();

function getNextDailyBackupTime(): number {
    const next = new Date();
    next.setHours(3, 0, 0, 0);
    if (next.getTime() <= Date.now()) {
        next.setDate(next.getDate() + 1);
    }
    return next.getTime();
}

async function scheduleDailyBackupAlarm() {
    const settings = await getBackupSettings();
    await browser.alarms.clear(DAILY_BACKUP_ALARM);
    if (!settings.enabled) {
        logger.log("[backup] Daily backup disabled. Alarm cleared.");
        return;
    }

    await browser.alarms.create(DAILY_BACKUP_ALARM, {
        when: getNextDailyBackupTime(),
        periodInMinutes: 1440
    });
    logger.log("[backup] Daily backup alarm scheduled.");
}

async function runAutomaticBackup() {
    const settings = await getBackupSettings();
    if (!settings.enabled) return;

    try {
        const result = await downloadFullVaultBackup('automatic');
        logger.log("[backup] Automatic backup complete:", result);
    } catch (err) {
        logger.error("[backup] Automatic backup failed:", err);
        await recordBackupResult('error', err instanceof Error ? err.message : String(err));
    }
}

export interface ExtractionResult {
    src: string | null;
    metadata: {
        title: string;
        thumbnail: string; // Used for the WebM or JPEG base64
        duration: number;
        author: string;
        views: string;
        tags: string[];
        likes: string;
        date: string;
    };
}


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
browser.runtime.onMessage.addListener((request: any, sender: any) => {
    logger.log("[onMessage] Received action:", request.action, "| from tab:", sender?.tab?.id, "url:", sender?.tab?.url?.substring(0, 80));
    if (request.action === "extract_fresh_m3u8") return doTabExtraction(request.url).then(res => ({ src: res?.src || null }));
    if (request.action === "open_dashboard") { openDashboard(); return Promise.resolve(true); }
    if (request.action === "process_capture") return runCapturePipeline(request.data, sender?.tab?.id, sender?.tab?.windowId);
    if (request.action === "generate_preview") {
        return setupOffscreenDocument().then(async (ready) => {
            if (!ready) {
                return { success: false, error: "Preview processor unavailable" };
            }
            return browser.runtime.sendMessage({
                action: "generate_preview_process",
                data: request.data
            });
        });
    }
    if (request.action === "generate_preview_process") return undefined;
    if (request.action === "download_debug_logs") { logger.downloadLogFile(); return Promise.resolve(true); }
    if (request.action === "run_full_backup") {
        return downloadFullVaultBackup('manual')
            .then(result => result)
            .catch(err => ({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    if (request.action === "get_backup_settings") {
        return getBackupSettings()
            .then(settings => ({ success: true, settings }))
            .catch(err => ({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    if (request.action === "save_backup_settings") {
        return saveBackupSettings(request.settings)
            .then(scheduleDailyBackupAlarm)
            .then(() => ({ success: true }))
            .catch(err => ({ success: false, error: err instanceof Error ? err.message : String(err) }));
    }
    logger.warn("[onMessage] Unknown action received:", request.action);
    return undefined;
});

browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DAILY_BACKUP_ALARM) {
        void runAutomaticBackup();
    }
});

browser.runtime.onInstalled.addListener(() => {
    void scheduleDailyBackupAlarm();
});

browser.runtime.onStartup.addListener(() => {
    void scheduleDailyBackupAlarm();
});

void scheduleDailyBackupAlarm();

browser.action.onClicked.addListener(() => {
    logger.log("[action.onClicked] Extension icon clicked. Opening dashboard.");
    openDashboard();
});

browser.commands.onCommand.addListener(async (command) => {
    logger.log("[commands.onCommand] Command received:", command);
    if (command === "_execute_action" || command === "open-dashboard") {
        openDashboard();
    } else if (command === "capture-video") {
        try {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            const activeTab = tabs[0];
            logger.log("[commands.onCommand] capture-video. Active tab:", activeTab?.id, "url:", activeTab?.url?.substring(0, 80));
            if (!activeTab?.id || !activeTab.url || activeTab.url.startsWith('chrome:')) {
                logger.warn("[commands.onCommand] Cannot capture - no valid active tab.");
                return;
            }

            try {
                await browser.tabs.sendMessage(activeTab.id, { type: "capture-video" });
                logger.log("[commands.onCommand] Sent capture-video to content script.");
            } catch (error) {
                logger.warn("[commands.onCommand] Content script not available on tab. Showing alert.", error);
                try {
                    await browser.scripting.executeScript({
                        target: { tabId: activeTab.id },
                        func: () => alert("[Vault Central] Extension script is not active on this page. Please refresh.")
                    });
                } catch (e) {
                    logger.error("[commands.onCommand] executeScript for alert also failed:", e);
                }
            }
        } catch (error) {
            logger.error("[commands.onCommand] Unexpected error handling capture-video command:", error);
        }
    }
});
