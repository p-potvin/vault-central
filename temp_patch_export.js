const fs = require('fs');
const path = 'src/components/VaultDashboard.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add Icons
content = content.replace("UploadCloud, Loader2 } from 'lucide-react'", "UploadCloud, Loader2, Download, Upload } from 'lucide-react'");

// 2. Add Export/Import Functions
const funcTarget = "const [uploadingItem, setUploadingItem] = useState<string | null>(null);";
const funcInjection = const [uploadingItem, setUploadingItem] = useState<string | null>(null);

  const handleExportVault = async () => {
    try {
      const videos = await getSavedVideos();
      const exportData = {
        version: 1,
        timestamp: Date.now(),
        videos,
      };
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const dlAnchorElem = document.createElement('a');
      dlAnchorElem.setAttribute("href", dataStr);
      dlAnchorElem.setAttribute("download", \ault-backup-\.json\);
      dlAnchorElem.click();
    } catch(e) {
      console.error(e);
      alert("Failed to export vault data.");
    }
  };

  const handleImportVault = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        let importedVideos: VideoData[] = [];
        if (Array.isArray(json)) {
          importedVideos = json;
        } else if (json.videos && Array.isArray(json.videos)) {
          importedVideos = json.videos;
        }

        if (importedVideos.length === 0) {
          alert("No valid vault items found in JSON.");
          return;
        }

        const confirmMode = window.confirm(
          \Found \ items.\\nClick OK to OVERWRITE your current vault.\\nClick Cancel to MERGE with current items.\
        );

        let finalSet = importedVideos;
        
        if (!confirmMode) {
           const existing = await getSavedVideos();
           const merged = [...existing, ...importedVideos];
           finalSet = Array.from(new Map(merged.map(item => [item.url, item])).values());
        }

        await saveVideos(finalSet);
        setItems(finalSet);
        alert(\Successfully imported! Vault now has \ items.\);

      } catch (err) {
        console.error(err);
        alert("Invalid or corrupted JSON backup file.");
      }
      if (e.target) e.target.value = '';
    };
    reader.readAsText(file);
  };;

content = content.replace(funcTarget, funcInjection);

// 3. Add UI Elements
const uiTarget =               <hr className="border-vault-border opacity-50 my-2" />

              <div className="text-xs text-vault-muted space-y-2">;
const uiInjection =               <hr className="border-vault-border opacity-50 my-2" />

              {/* Portability */}
              <div className="pt-2">
                <label className="text-xs font-bold text-vault-muted uppercase tracking-widest flex items-center gap-2 mb-2">
                  <Download size={14} className="text-vault-accent" /> Portability
                </label>
                <div className="flex gap-2">
                  <button 
                    onClick={handleExportVault}
                    className="flex-1 vault-btn p-2 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1 border-vault-border text-vault-text hover:border-vault-accent hover:text-vault-accent transition-all"
                  >
                    <Download size={12} /> Export
                  </button>
                  <label className="flex-1 vault-btn p-2 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1 border-vault-border text-vault-text hover:border-vault-accent hover:text-vault-accent transition-all cursor-pointer">
                    <Upload size={12} /> Import
                    <input type="file" accept=".json" className="hidden" onChange={handleImportVault} />
                  </label>
                </div>
              </div>

              <hr className="border-vault-border opacity-50 my-2" />

              <div className="text-xs text-vault-muted space-y-2">;

content = content.replace(uiTarget, uiInjection);

fs.writeFileSync(path, content, 'utf8');
console.log("Success patching VaultDashboard.tsx");
