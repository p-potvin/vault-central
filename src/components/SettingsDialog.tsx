import React, { useState, useEffect } from 'react';
import browser from 'webextension-polyfill';
import * as Icons from '../lib/icons';
import { cn } from '../lib/utils';
import { dateTimeFormatter } from '../lib/dashboard-utils';
import {
  DEFAULT_BACKUP_SETTINGS,
  getSavedVideos,
  saveVideos,
  type BackupSettings
} from '../lib/storage-vault';
import { VideoDataSchema, type VideoData } from '../types/schemas';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onWipeVault: () => void;
  onImportSuccess: (nextItems: VideoData[]) => void;
  onShowToast: (msg: string, type: 'success' | 'error') => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
  onWipeVault,
  onImportSuccess,
  onShowToast,
}) => {
  const [backupSettings, setBackupSettings] = useState<BackupSettings>(DEFAULT_BACKUP_SETTINGS);
  const [backupFolderDraft, setBackupFolderDraft] = useState(DEFAULT_BACKUP_SETTINGS.folder);
  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const [bulkLinksText, setBulkLinksText] = useState("");
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");

  const refreshBackupSettings = async () => {
    try {
      const response = await browser.runtime.sendMessage({ action: "get_backup_settings" }) as any;
      if (response?.success && response.settings) {
        setBackupSettings(response.settings);
        setBackupFolderDraft(response.settings.folder || '');
      }
    } catch (err) {
      console.warn("[SettingsDialog] Failed to refresh backup settings:", err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void refreshBackupSettings();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExportVault = async () => {
    try {
      const data = await getSavedVideos();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vault-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onShowToast("Vault export generated.", "success");
    } catch (err) {
      console.error("Failed to export vault backup", err);
      onShowToast("Failed to export vault backup.", "error");
    }
  };

  const handleImportVault = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      onShowToast("Failed to import. File exceeds 50MB limit.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          const current = await getSavedVideos(true);
          const knownUrls = new Set(current.map(item => item.url));
          const validImports = json
            .map(item => VideoDataSchema.safeParse(item))
            .filter((result): result is { success: true; data: VideoData } => result.success)
            .map(result => result.data);
          const additions = validImports.filter(item => {
            if (knownUrls.has(item.url)) return false;
            knownUrls.add(item.url);
            return true;
          });
          const next = [...current, ...additions];
          await saveVideos(next);
          onImportSuccess(next);
          onShowToast(`Imported ${additions.length} items. Skipped ${json.length - additions.length}.`, "success");
          onClose();
        } else {
          onShowToast("Failed to import. Backup must be a JSON array.", "error");
        }
      } catch (err) {
        onShowToast("Failed to import. Invalid JSON backup.", "error");
      }
    };
    reader.readAsText(file);
  };

  const saveBackupSettingsFromDraft = async (patch: Partial<BackupSettings> = {}) => {
    const next = {
      ...backupSettings,
      ...patch,
      folder: backupFolderDraft
    };
    setBackupSettings(next);

    const response = await browser.runtime.sendMessage({
      action: "save_backup_settings",
      settings: next
    }) as any;
    if (!response?.success) {
      throw new Error(response?.error || "Failed to save backup settings.");
    }
    onShowToast("Backup settings saved.", "success");
  };

  const handleToggleDailyBackup = async (enabled: boolean) => {
    try {
      await saveBackupSettingsFromDraft({ enabled });
    } catch (err) {
      console.error("[SettingsDialog] Failed to update daily backup setting:", err);
      onShowToast("Failed to update daily backup setting.", "error");
      await refreshBackupSettings();
    }
  };

  const handleSaveBackupSettings = async () => {
    try {
      await saveBackupSettingsFromDraft();
    } catch (err) {
      console.error("[SettingsDialog] Failed to save backup settings:", err);
      onShowToast("Failed to save backup settings.", "error");
      await refreshBackupSettings();
    }
  };

  const handleRunFullBackup = async () => {
    setIsBackupBusy(true);
    try {
      const response = await browser.runtime.sendMessage({ action: "run_full_backup" }) as any;
      if (!response?.success) {
        throw new Error(response?.error || "Backup failed.");
      }
      onShowToast(
        `Full backup downloaded (${response.videos} items, ${response.previews} previews).`,
        "success"
      );
      await refreshBackupSettings();
    } catch (err) {
      console.error("[SettingsDialog] Full backup failed:", err);
      onShowToast("Full backup failed. Check debug logs.", "error");
    } finally {
      setIsBackupBusy(false);
    }
  };

  const handleBulkImport = async () => {
    const lines = bulkLinksText
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        try {
          return line.length > 0 && new URL(line);
        } catch {
          return false;
        }
      });

    if (lines.length === 0) {
      onShowToast("No valid URLs found in input.", "error");
      return;
    }

    setIsBulkImporting(true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const url = lines[i];
      setImportProgress(`Processing ${i + 1}/${lines.length}...`);
      try {
        const payload = {
          url: url,
          originUrl: url,
          originTitle: "Bulk Imported Link",
          thumbnail: "",
          title: url.split('/').pop() || "Captured Link",
          author: new URL(url).hostname || "Imported",
          tags: [] as string[],
          date: new Date().toISOString()
        };

        const res = (await browser.runtime.sendMessage({
          action: "process_capture",
          data: payload
        })) as any;

        if (res && res.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        console.error("Bulk import failed for URL:", url, err);
        failCount++;
      }
    }

    setIsBulkImporting(false);
    setBulkLinksText("");
    setImportProgress("");
    onShowToast(`Bulk import complete: ${successCount} succeeded, ${failCount} failed.`, "success");

    const all = await getSavedVideos();
    onImportSuccess(all);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-pointer"
      onClick={onClose}
    >
      <div 
        className="bg-vault-bg border border-vault-border rounded-lg shadow-2xl w-full max-w-2xl p-0 relative flex flex-col animate-in zoom-in-95 duration-200 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-vault-border bg-vault-cardBg">
          <h2 className="text-lg font-bold text-vault-text flex items-center gap-2">
            <Icons.SettingsIcon size={20} className="text-vault-accent" /> Advanced Options & Export
          </h2>
          <button 
            onClick={onClose} 
            className="vault-btn p-1.5 h-8 w-8 flex items-center justify-center rounded-full hover:bg-vault-bg border-none"
          >
            <Icons.CloseIcon size={16} className="text-vault-muted" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto max-h-[70vh] flex flex-col gap-8">
           
           {/* Export / Import */}
           <section>
             <h3 className="text-sm font-black uppercase text-vault-muted mb-4 border-b border-vault-border pb-2 tracking-widest">Data Portability</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="bg-vault-cardBg border border-vault-border rounded p-4 flex flex-col gap-3">
                 <div className="flex items-center gap-2 text-vault-text font-bold">
                   <Icons.ExportIcon size={18} className="text-vault-accent"/> Export Vault JSON
                 </div>
                 <p className="text-xs text-vault-muted leading-relaxed flex-1">
                   Download a metadata-only JSON backup of tags, references, and saved item records.
                 </p>
                 <button onClick={handleExportVault} className="vault-btn py-2 text-xs font-bold w-full bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors">
                   Generate Backup
                 </button>
               </div>

               <div className="bg-vault-cardBg border border-vault-border rounded p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-vault-text font-bold">
                    <Icons.ImportIcon size={18} className="text-vault-accent"/> Import Vault Backup
                  </div>
                  <p className="text-xs text-vault-muted leading-relaxed flex-1">
                    Restore a previously exported Vault JSON file. Note: Pre-existing duplicate URLs will be skipped.
                  </p>
                  <label className="vault-btn py-2 text-xs font-bold w-full bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors text-center cursor-pointer">
                     Select JSON File
                     <input type="file" accept=".json" onChange={handleImportVault} className="hidden" />
                  </label>
                </div>

                <div className="col-span-1 md:col-span-2 bg-vault-cardBg border border-vault-border rounded p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-vault-text font-bold">
                    <Icons.ImportIcon size={18} className="text-vault-accent"/> Bulk URL Import
                  </div>
                  <p className="text-xs text-vault-muted leading-relaxed">
                    Paste a list of video links (one URL per line). The importer will process each URL in the background, extracting media, capturing snapshots, and saving them to your library.
                  </p>
                  <textarea
                    value={bulkLinksText}
                    onChange={(e) => setBulkLinksText(e.target.value)}
                    disabled={isBulkImporting}
                    placeholder="https://example.com/video1.mp4&#10;https://example.com/video2.mp4"
                    rows={4}
                    className="w-full bg-vault-bg border border-vault-border rounded p-2 text-xs text-vault-text focus:border-vault-accent outline-none font-mono resize-y"
                  />
                  {isBulkImporting && (
                    <div className="flex items-center gap-2 text-xs text-vault-accent">
                      <Icons.LoaderIcon className="animate-spin" size={14} />
                      <span>{importProgress}</span>
                    </div>
                  )}
                  <button
                    onClick={handleBulkImport}
                    disabled={isBulkImporting || !bulkLinksText.trim()}
                    className="vault-btn py-2 text-xs font-bold w-full bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isBulkImporting ? "Importing..." : "Start Bulk Import"}
                  </button>
                </div>

                <div className="col-span-1 md:col-span-2 bg-vault-cardBg border border-vault-border rounded p-4 flex flex-col gap-4">
                 <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                   <div className="flex-1">
                     <h4 className="text-vault-text font-bold flex items-center gap-2">
                       <Icons.ExportIcon size={16} className="text-vault-accent"/> Full Local Backup
                     </h4>
                     <p className="text-xs text-vault-muted mt-1 leading-relaxed">
                       Includes metadata, thumbnails, and WebM previews. Folder is relative to the browser Downloads folder; leave it blank for the Downloads root.
                     </p>
                     {backupSettings.lastBackupAt && (
                       <p className={cn(
                         "text-xs mt-2",
                         backupSettings.lastBackupStatus === 'error' ? "text-red-400" : "text-vault-accent"
                       )}>
                         Last backup: {dateTimeFormatter.format(backupSettings.lastBackupAt)}
                         {backupSettings.lastBackupStatus === 'error' ? ` - ${backupSettings.lastBackupError || 'failed'}` : ''}
                       </p>
                     )}
                   </div>
                   <label className="flex items-center gap-2 text-xs font-bold text-vault-text whitespace-nowrap cursor-pointer">
                     <input
                       type="checkbox"
                       checked={backupSettings.enabled}
                       onChange={(e) => void handleToggleDailyBackup(e.target.checked)}
                       className="accent-vault-accent"
                     />
                     Daily automatic backup
                   </label>
                 </div>
                 <div className="flex flex-col md:flex-row gap-3">
                   <input
                     type="text"
                     value={backupFolderDraft}
                     onChange={(e) => setBackupFolderDraft(e.target.value)}
                     placeholder="Downloads root"
                     className="flex-1 bg-vault-bg border border-vault-border rounded px-3 py-2 text-xs text-vault-text focus:border-vault-accent outline-none"
                   />
                   <button
                     onClick={() => void handleSaveBackupSettings()}
                     className="vault-btn py-2 px-4 text-xs font-bold bg-vault-cardBg text-vault-text border-vault-border hover:border-vault-accent hover:text-vault-accent transition-colors"
                   >
                     Save Folder
                   </button>
                   <button
                     onClick={() => void handleRunFullBackup()}
                     disabled={isBackupBusy}
                     className="vault-btn py-2 px-5 text-xs font-bold bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                     {isBackupBusy ? "Backing Up..." : "Run Full Backup"}
                   </button>
                 </div>
                </div>

                <div className="col-span-1 md:col-span-2 bg-vault-cardBg border border-vault-border rounded p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex-1">
                    <h4 className="text-vault-text font-bold flex items-center gap-2">
                      <Icons.DebugIcon size={16} className="text-vault-accent"/> Debug Logs
                    </h4>
                    <p className="text-xs text-vault-muted mt-1">Download background capture logs for troubleshooting extension issues.</p>
                  </div>
                  <button 
                     onClick={() => {
                       browser.runtime.sendMessage({ action: "download_debug_logs" });
                       onShowToast("Downloading debug logs...", "success");
                     }} 
                     className="vault-btn py-2 px-6 text-xs font-bold bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors shrink-0"
                  >
                    Download Logs
                  </button>
                </div>
             </div>
           </section>

           {/* Danger Zone */}
           <section>
             <h3 className="text-sm font-black uppercase text-red-500/80 mb-4 border-b border-red-900/30 pb-2 tracking-widest">Danger Zone</h3>
             <div className="bg-red-900/10 border border-red-900/30 rounded p-4 flex flex-col md:flex-row items-center justify-between gap-4">
               <div>
                 <h4 className="text-red-400 font-bold flex items-center gap-2"><Icons.AlertIcon size={16}/> Wipe Vault Data</h4>
                 <p className="text-xs text-red-400/70 mt-1">Permanently obliterate all bookmarks, metadata, and locally stored previews.</p>
               </div>
               <button onClick={onWipeVault} className="vault-btn py-2 px-4 shadow-[0_0_15px_-3px_var(--vault-signal-alert)] text-xs font-black uppercase tracking-widest bg-red-600 hover:bg-red-500 text-white border border-red-400/60 whitespace-nowrap">
                 Wipe Database
               </button>
             </div>
           </section>

        </div>
      </div>
    </div>
  );
};
