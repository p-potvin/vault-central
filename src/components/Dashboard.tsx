import { getSavedVideos } from '../lib/storage-vault';
import { type VideoData } from '../types/schemas';
import { Heart, Search, Shield, LayoutGrid, List } from 'lucide-react';
import { cn } from '../lib/utils';
import React from 'react';

export const Dashboard: React.FC = () => {
  const [items, setItems] = React.useState<VideoData[]>([]);
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    const load = async () => {
      const all = await getSavedVideos();
      setItems(all || []);
    };
    load();
  }, []);

  const filtered = items.filter(f => 
    f.title.toLowerCase().includes(search.toLowerCase()) ||
    f.url.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen p-4 md:p-8 space-y-8 bg-[#050505] text-white font-sans antialiased">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-[#1a1a1a] pb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 border border-[#00f3ff] text-[#00f3ff] rounded-lg shadow-[0_0_15px_rgba(0,243,255,0.2)]">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter uppercase italic text-white">
              Vault<span className="text-[#00f3ff]">Central</span>
            </h1>
            <p className="text-[10px] text-[#888888] font-mono uppercase tracking-[3px]">
              Favorites Management System // Secure-Alpha
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#888888] group-focus-within:text-[#00f3ff] transition-colors" size={16} />
            <input 
              type="text"
              placeholder="QUERY_STORAGE..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-transparent border border-[#1a1a1a] rounded focus:outline-none focus:border-[#00f3ff] text-sm w-full md:w-64 font-mono transition-all placeholder:text-[#1a1a1a]"
            />
          </div>
          <button 
            onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            className="px-4 py-2 rounded border border-[#1a1a1a] bg-transparent text-[#888888] hover:text-[#00f3ff] hover:border-[#00f3ff] transition-all uppercase tracking-widest text-[10px] font-bold flex items-center gap-2"
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
        {filtered.map((fav, idx) => (
          <div key={`${fav.url}-${idx}`} className="group border border-[#1a1a1a] bg-black/40 backdrop-blur-sm rounded-lg overflow-hidden transition-all duration-300 hover:border-[#00f3ff]/40 hover:shadow-[0_0_20px_-5px_rgba(0,243,255,0.2)] p-4 flex flex-col justify-between h-full">
            <div>
              <div className="flex justify-between items-start mb-4">
                <span className="text-[9px] font-mono text-[#888888] uppercase tracking-widest bg-[#1a1a1a]/30 px-2 py-0.5 rounded border border-[#1a1a1a]">
                  EXT-{idx.toString().padStart(3, '0')}
                </span>
                <Heart className="text-[#00f3ff] fill-[#00f3ff]/10 group-hover:fill-[#00f3ff]/30 transition-all" size={16} />
              </div>
              
              <h3 className="font-bold text-lg mb-1 truncate group-hover:text-[#00f3ff] transition-colors">
                {fav.title}
              </h3>
              <p className="text-xs text-[#888888] truncate font-mono mb-6 italic opacity-60">
                {fav.url}
              </p>
            </div>
            
            <div className="flex items-center justify-between border-t border-[#1a1a1a] pt-4 mt-auto">
              <span className="text-[9px] font-mono text-[#888888] uppercase tracking-tighter">
                {new Date(fav.timestamp).toLocaleDateString()}
              </span>
              <a 
                href={fav.url} 
                target="_blank" 
                rel="noreferrer"
                className="text-[10px] font-black text-[#00f3ff] hover:text-white transition-colors uppercase tracking-widest flex items-center gap-1"
              >
                ACCESS <span className="group-hover:translate-x-1 transition-transform">→</span>
              </a>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-32 text-center border border-dashed border-[#1a1a1a] rounded-xl bg-black/20">
            <p className="text-[#888888] font-mono text-sm tracking-[5px] uppercase">
              NO ENCRYPTED ENTRIES FOUND IN CURRENT SCOPE
            </p>
          </div>
        )}
      </main>
    </div>
  );
};
