const fs = require('fs');
const path = 'src/components/VaultDashboard.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add isSettingsOpen state
const stateMatch = /const \[isSidebarOpen, setSidebarOpen\] = useState\(true\);/;
if (stateMatch.test(content)) {
    content = content.replace(stateMatch, `const [isSidebarOpen, setSidebarOpen] = useState(true);\n  const [isSettingsOpen, setIsSettingsOpen] = useState(false);`);
    console.log("State injected");
} else {
    console.log("STATE NOT FOUND");
}

// 2. Add Settings Icon to Header
// We look for: <Shield size={16} className="text-vault-accent group-hover:scale-110 transition-transform duration-300" />
const headerMatch = /<button className="vault-btn flex items-center justify-center p\.1\.5 rounded-full.*?Shield size=\{16\}.*?<\/button>/s;

if (headerMatch.test(content)) {
    const replacement = `<button onClick={() => setIsSettingsOpen(true)} className="vault-btn flex items-center justify-center p-1.5 rounded-full h-8 w-8 group" title="Advanced Options & Export">
            <Settings size={16} className="text-vault-accent group-hover:rotate-90 transition-transform duration-300" />
          </button>
          $&`;
    content = content.replace(headerMatch, (...args) => {
        return `<button onClick={() => setIsSettingsOpen(true)} className="vault-btn flex items-center justify-center p-1.5 rounded-full h-8 w-8 group" title="Advanced Options & Export">\n            <Settings size={16} className="text-vault-accent group-hover:rotate-90 transition-transform duration-300" />\n          </button>\n          ` + args[0];
    });
    console.log("Header injected");
} else {
    // Let's try finding the cycleTheme button
    const fallbackHeaderMatch = /<button\s+onClick=\{cycleTheme\}([\s\S]*?)<\/button>/;
    if (fallbackHeaderMatch.test(content)) {
        content = content.replace(fallbackHeaderMatch, (...args) => {
            return args[0] + `\n            <button onClick={() => setIsSettingsOpen(true)} className="vault-btn flex items-center justify-center p-1.5 rounded-full h-8 w-8 group" title="Advanced Options & Export">\n              <Settings size={16} className="text-vault-accent group-hover:rotate-90 transition-transform duration-300" />\n            </button>`;
        });
        console.log("Header injected (fallback)");
    } else {
        console.log("HEADER NOT FOUND");
    }
}

// 3. Add handleWipeVault
// insert after handleExportVault
const wipeMatch = /const handleImportVault = \(e: React\.ChangeEvent<HTMLInputElement>\) => \{/;
if (wipeMatch.test(content)) {
    const wipeLogic = `
  const handleWipeVault = async () => {
    if (window.confirm("WARNING: This will permanently delete ALL items in your Vault! This cannot be undone. Are you sure?")) {
      if (window.confirm("Are you REALLY sure? Type 'DELETE' to confirm.") || true) { // We skip prompt bypass for simplicity in extension 
          const confirmText = window.prompt("Type DELETE to confirm wiping the entire vault:");
          if (confirmText === "DELETE") {
             await saveVideos([]);
             setItems([]);
             setIsSettingsOpen(false);
          }
      }
    }
  };

  const handleImportVault = (e: React.ChangeEvent<HTMLInputElement>) => {`;
    content = content.replace(wipeMatch, wipeLogic);
    console.log("Wipe handler injected");
} else {
    console.log("WIPE HANDLER SPOT NOT FOUND");
}

// 4. Add the Settings Modal Layout
// Look for {/* SCANNER MODAL */} or {/* VIDEO PLAYER MODAL */}
const modalMatch = /\{\/\* VIDEO PLAYER MODAL \*\/\}/;
if (modalMatch.test(content)) {
    const settingsModal = `{/* SETTINGS & EXPORT MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-vault-bg border border-vault-border rounded-lg shadow-2xl w-full max-w-2xl p-0 relative flex flex-col animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-vault-border bg-vault-cardBg">
              <h2 className="text-lg font-bold text-vault-text flex items-center gap-2">
                <Settings size={20} className="text-vault-accent" /> Advanced Options & Export
              </h2>
              <button 
                onClick={() => setIsSettingsOpen(false)} 
                className="vault-btn p-1.5 h-8 w-8 flex items-center justify-center rounded-full hover:bg-vault-bg border-none"
              >
                <X size={16} className="text-vault-muted" />
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
                       <Download size={18} className="text-vault-accent"/> Export Vault JSON
                     </div>
                     <p className="text-xs text-vault-muted leading-relaxed flex-1">
                       Download a complete JSON backup of all metadata, tags, and references safely to your local machine.
                     </p>
                     <button onClick={handleExportVault} className="vault-btn py-2 text-xs font-bold w-full bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors">
                       Generate Backup
                     </button>
                   </div>

                   <div className="bg-vault-cardBg border border-vault-border rounded p-4 flex flex-col gap-3">
                     <div className="flex items-center gap-2 text-vault-text font-bold">
                       <Upload size={18} className="text-vault-accent"/> Import Vault Backup
                     </div>
                     <p className="text-xs text-vault-muted leading-relaxed flex-1">
                       Restore a previously exported Vault JSON file. Note: Pre-existing duplicate URLs will be skipped.
                     </p>
                     <label className="vault-btn py-2 text-xs font-bold w-full bg-vault-accent/10 text-vault-accent border-vault-accent/30 hover:bg-vault-accent hover:text-vault-bg transition-colors text-center cursor-pointer">
                        Select JSON File
                        <input type="file" accept=".json" onChange={(e) => { handleImportVault(e); setIsSettingsOpen(false); }} className="hidden" />
                     </label>
                   </div>
                 </div>
               </section>

               {/* Danger Zone */}
               <section>
                 <h3 className="text-sm font-black uppercase text-red-500/80 mb-4 border-b border-red-900/30 pb-2 tracking-widest">Danger Zone</h3>
                 <div className="bg-red-900/10 border border-red-900/30 rounded p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                   <div>
                     <h4 className="text-red-400 font-bold flex items-center gap-2"><AlertTriangle size={16}/> Wipe Vault Data</h4>
                     <p className="text-xs text-red-400/70 mt-1">Permanently obliterate all bookmarks, metadata, and blob previews from IndexedDB.</p>
                   </div>
                   <button onClick={handleWipeVault} className="vault-btn py-2 px-4 shadow-[0_0_15px_-3px_var(--color-red-500)] text-xs font-black uppercase tracking-widest bg-red-600 hover:bg-red-500 text-white border-none whitespace-nowrap">
                     Wipe Database
                   </button>
                 </div>
               </section>

            </div>
          </div>
        </div>
      )}

      {/* VIDEO PLAYER MODAL */}`;
    content = content.replace(modalMatch, settingsModal);
    console.log("Modal Layout injected");
} else {
    console.log("MODAL SPOT NOT FOUND");
}

fs.writeFileSync(path, content, 'utf8');
console.log('Done!');
