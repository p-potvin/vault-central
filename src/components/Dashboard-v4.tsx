import { StorageVault } from '../lib/storage-vault';
import { type Favorite } from '../types/schemas';
import { Heart, Search, Shield, LayoutGrid, List } from 'lucide-react';
import { cn } from '../lib/utils';
import React from 'react';

export const Dashboard: React.FC = () => {
  const [favorites, setFavorites] = React.useState<Favorite[]>([]);
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    const load = async () => {
      const all = await StorageVault.getAll();
      setFavorites(all);
    };
    load();
  }, []);

  const filtered = favorites.filter(f => 
    f.title.toLowerCase().includes(search.toLowerCase()) ||
    f.url.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen p-4 md:p-8 space-y-8 bg-vault-bg text-white font-sans antialiased">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-vault-border pb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 border border-vault-accent text-vault-accent rounded-lg shadow-[0_0_15px_rgba(0,243,255,0.2)]">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter uppercase italic text-white">
              Vault<span className="text-vault-accent">Central</span>
            </h1>
            <p className="text-[10px] text-vault-muted font-mono uppercase tracking-[3px]">
              Favorites Management System // Secure-Alpha
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-vault-muted group-focus-within:text-vault-accent transition-colors" size={16} />
            <input 
              type="text"
              placeholder="QUERY_STORAGE..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-transparent border border-vault-border rounded focus:outline-none focus:border-vault-accent text-sm w-full md:w-64 font-mono transition-all placeholder:text-vault-border"
            />
          </div>
          <button 
            onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            className="px-4 py-2 rounded border border-vault-border bg-transparent text-vault-muted hover:text-vault-accent hover:border-vault-accent transition-all uppercase tracking-widest text-[10px] font-bold flex items-center gap-2"
          >
            {view === 'grid' ? <List size={14} /> : <LayoutGrid size={14} />}
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className={cn(
        "grid gap-6 transition-all duration-500",
        view === 'grid' 
          ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" 
          : "grid-cols-1"
      )}>
        {filtered.map((fav) => (
          <div key={fav.id} className="group border border-vault-border bg-black/40 backdrop-blur-sm rounded-lg overflow-hidden transition-all duration-300 hover:border-vault-accent/40 hover:shadow-[0_0_20px_-5px_rgba(0,243,255,0.2)] p-4 flex flex-col justify-between h-full">
            <div>
              <div className="flex justify-between items-start mb-4">
                <span className="text-[9px] font-mono text-vault-muted uppercase tracking-widest bg-vault-border/30 px-2 py-0.5 rounded border border-vault-border">
                  {fav.id.slice(0, 8)}
                </span>
                <Heart className="text-vault-accent fill-vault-accent/10 group-hover:fill-vault-accent/30 transition-all" size={16} />
              </div>
              
              <h3 className="font-bold text-lg mb-1 truncate group-hover:text-vault-accent transition-colors">
                {fav.title}
              </h3>
              <p className="text-xs text-vault-muted truncate font-mono mb-6 italic opacity-60">
                {fav.url}
              </p>
            </div>
            
            <div className="flex items-center justify-between border-t border-vault-border pt-4 mt-auto">
              <span className="text-[9px] font-mono text-vault-muted uppercase tracking-tighter">
                {new Date(fav.timestamp).toLocaleDateString()}
              </span>
              <a 
                href={fav.url} 
                target="_blank" 
                rel="noreferrer"
                className="text-[10px] font-black text-vault-accent hover:text-white transition-colors uppercase tracking-widest flex items-center gap-1"
              >
                ACCESS <span className="group-hover:translate-x-1 transition-transform">→</span>
              </a>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-32 text-center border border-dashed border-vault-border rounded-xl bg-black/20">
            <p className="text-vault-muted font-mono text-sm tracking-[5px] uppercase">
              NO ENCRYPTED ENTRIES FOUND IN CURRENT SCOPE
            </p>
          </div>
        )}
      </main>
    </div>
  );
};
