import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { FiGrid, FiPlus, FiSearch, FiStar, FiLayout } from 'react-icons/fi'

export function Sidebar({ width, onResizeStart }: { width: number; onResizeStart: (e: React.MouseEvent<HTMLDivElement>) => void }) {
  const { dashboards, activeDashboardId, openDashboardModal, selectDashboard } = useApp()

  // Local UI state for sidebar enhancements
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'updatedDesc' | 'createdDesc' | 'nameAsc' | 'nameDesc'>('createdDesc')
  const [compact, setCompact] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  // Load favorites and recents from localStorage
  useEffect(() => {
    try {
      const favRaw = localStorage.getItem('favorites_dashboards')
      if (favRaw) setFavorites(new Set(JSON.parse(favRaw)))
    } catch {}
  }, [])

  const saveFavorites = (next: Set<string>) => {
    setFavorites(next)
    try { localStorage.setItem('favorites_dashboards', JSON.stringify(Array.from(next))) } catch {}
  }


  const onToggleFavorite = (id: string) => {
    const next = new Set(Array.from(favorites))
    if (next.has(id)) next.delete(id); else next.add(id)
    saveFavorites(next)
  }

  const onSelectDashboard = (id: string) => {
    selectDashboard(id)
  }

  const sorted = useMemo(() => {
    const arr = [...dashboards]
    switch (sort) {
      case 'nameAsc': arr.sort((a,b) => a.name.localeCompare(b.name)); break
      case 'nameDesc': arr.sort((a,b) => b.name.localeCompare(a.name)); break
      case 'createdDesc': arr.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); break
      case 'updatedDesc': default: arr.sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()); break
    }
    return arr
  }, [dashboards, sort])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(d => d.name.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q))
  }, [sorted, query])

  const favoriteList = filtered.filter(d => favorites.has(d.id))
  const otherList = filtered.filter(d => !favorites.has(d.id))

  return (
    <aside className="relative flex flex-col h-full bg-slate-950 border-r border-white/10 select-none" style={{ width }}>
       {/* Header */}
       <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-900/50 backdrop-blur-md">
          <div className="flex items-center gap-2 overflow-hidden">
             <div className="p-1.5 bg-blue-600 rounded-lg shadow-[0_0_10px_rgba(37,99,235,0.5)]">
               <FiLayout className="w-5 h-5 text-white" />
             </div>
             <span className="font-bold text-lg text-white tracking-tight truncate">SmartAnalytics</span>
          </div>
          <button 
            onClick={() => openDashboardModal()}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors border border-transparent hover:border-white/10"
            title="New Dashboard"
          >
            <FiPlus className="w-5 h-5" />
          </button>
       </div>

       {/* Search & Filter */}
       <div className="p-3 space-y-2">
          <div className="relative group">
             <FiSearch className="absolute left-2.5 top-2.5 w-4 h-4 text-white/40 group-focus-within:text-blue-400 transition-colors" />
             <input 
               value={query}
               onChange={e => setQuery(e.target.value)}
               placeholder="Search dashboards..." 
               className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all"
             />
          </div>
          <div className="flex gap-1">
            <select 
               value={sort}
               onChange={e => setSort(e.target.value as any)}
               className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 focus:outline-none hover:bg-white/10 transition-colors cursor-pointer"
            >
              <option value="createdDesc">Newest First</option>
              <option value="updatedDesc">Recently Updated</option>
              <option value="nameAsc">Name (A-Z)</option>
              <option value="nameDesc">Name (Z-A)</option>
            </select>
          </div>
       </div>

       {/* Dashboard List */}
       <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-4 space-y-4">
          {/* Favorites Section */}
          {favoriteList.length > 0 && (
             <div>
                <div className="px-2 py-1 text-[10px] font-bold text-white/40 uppercase tracking-wider flex items-center gap-1 mb-1">
                   <FiStar className="w-3 h-3" /> Favorites
                </div>
                <div className="space-y-0.5">
                   {favoriteList.map(d => (
                      <div 
                        key={d.id}
                        onClick={() => onSelectDashboard(d.id)}
                        className={`group relative px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${activeDashboardId === d.id ? 'bg-blue-600/10 border-blue-500/20 text-blue-100 shadow-inner' : 'border-transparent hover:bg-white/5 text-white/70 hover:text-white'}`}
                      >
                         <div className="flex items-center justify-between">
                            <div className="truncate font-medium text-sm">{d.name}</div>
                            <button 
                              onClick={(e) => { e.stopPropagation(); onToggleFavorite(d.id); }}
                              className="opacity-0 group-hover:opacity-100 text-yellow-500 hover:text-yellow-400 transition-opacity"
                              title="Remove from favorites"
                            >
                              <FiStar className="w-3 h-3 fill-current" />
                            </button>
                         </div>
                         {d.description && <div className="text-xs opacity-50 truncate mt-0.5">{d.description}</div>}
                      </div>
                   ))}
                </div>
             </div>
          )}

          {/* All Dashboards */}
          <div>
             <div className="px-2 py-1 text-[10px] font-bold text-white/40 uppercase tracking-wider flex items-center gap-1 mb-1">
                <FiGrid className="w-3 h-3" /> Dashboards
             </div>
             <div className="space-y-0.5">
                {otherList.map(d => (
                   <div 
                     key={d.id}
                     onClick={() => onSelectDashboard(d.id)}
                     className={`group relative px-3 py-2.5 rounded-lg cursor-pointer transition-all border ${activeDashboardId === d.id ? 'bg-blue-600/10 border-blue-500/20 text-blue-100 shadow-inner' : 'border-transparent hover:bg-white/5 text-white/70 hover:text-white'}`}
                   >
                      <div className="flex items-center justify-between">
                         <div className="truncate font-medium text-sm">{d.name}</div>
                         <button 
                              onClick={(e) => { e.stopPropagation(); onToggleFavorite(d.id); }}
                              className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-yellow-500 transition-all"
                              title="Add to favorites"
                            >
                              <FiStar className="w-3 h-3" />
                            </button>
                      </div>
                      {d.description && <div className="text-xs opacity-50 truncate mt-0.5">{d.description}</div>}
                   </div>
                ))}
                {otherList.length === 0 && favoriteList.length === 0 && (
                   <div className="px-3 py-12 text-center border border-dashed border-white/10 rounded-lg m-2">
                      <div className="text-white/20 mb-2"><FiGrid className="w-8 h-8 mx-auto" /></div>
                      <div className="text-xs text-white/40">No dashboards found</div>
                   </div>
                )}
             </div>
          </div>
       </div>

      {/* Resize Handle */}
      <div
        className="absolute top-0 right-0 h-full w-1 cursor-ew-resize hover:bg-blue-500/50 transition-colors z-50"
        onMouseDown={onResizeStart}
      />
    </aside>
  )
}
