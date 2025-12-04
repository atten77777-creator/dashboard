import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Button } from './ui/Button'
import { API_BASE, ensureApiBase } from '../api'
import ChartBuilderModal from './ChartBuilderModal'
import ChartSelectModal from './ChartSelectModal'
import { FiDownload, FiPlay, FiPause, FiSkipForward, FiX, FiMaximize, FiDatabase, FiList, FiRefreshCw } from 'react-icons/fi'

type ColumnMeta = { name: string; type?: string }
type QueryResult = { columns: ColumnMeta[]; rows: any[] }

interface Props {
  isOpen: boolean
  sql: string
  onClose: () => void
  disableSave?: boolean
  initialData?: { columns: (string | { name: string; type?: string })[]; rows: any[] }
}

export default function FullDataModal({ isOpen, sql, onClose, disableSave, initialData }: Props) {
  const [data, setData] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isChartOpen, setIsChartOpen] = useState(false)
  const [isSelectOpen, setIsSelectOpen] = useState(false)
  const [lockType, setLockType] = useState<
    | 'line' | 'bar' | 'column' | 'area' | 'stackedBar' | 'stackedArea'
    | 'pie' | 'donut' | 'funnel' | 'scatter' | 'heatmap' | 'radar' | 'treemap'
    | 'gauge' | 'number' | 'candlestick' | 'histogram' | 'table' | undefined
  >(undefined)
  const [selectedColumns, setSelectedColumns] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const [isFullFetch, setIsFullFetch] = useState<boolean>(false)
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState<boolean>(false)
  const [hasMore, setHasMore] = useState<boolean>(false)
  const [totalFetched, setTotalFetched] = useState<number>(0)
  const [autoStreaming, setAutoStreaming] = useState<boolean>(false)

  // Limit rendering to avoid UI freeze for very large datasets
  const DEFAULT_RENDER_LIMIT = 1000
  const [renderLimit, setRenderLimit] = useState<number>(DEFAULT_RENDER_LIMIT)
  const PREVIEW_BUFFER_MAX = 20000

  // Visible rows derived from renderLimit - keeps table performant
  const visibleRows = useMemo(() => {
    const rowsAll = data?.rows || []
    return rowsAll.slice(0, Math.max(0, Math.min(renderLimit, rowsAll.length)))
  }, [data?.rows, renderLimit])

  useEffect(() => { void ensureApiBase() }, [])

  const fetchData = async (full: boolean) => {
    setLoading(true); setError(null); setData(null); setIsFullFetch(full)
    setRenderLimit(DEFAULT_RENDER_LIMIT)
    try { abortRef.current?.abort() } catch { /* ignore */ }
    const ac = new AbortController(); abortRef.current = ac
    try {
      await ensureApiBase()
      const res = await fetch(`${API_BASE}/chat/execute-sql`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sqlQuery: sql, full }), signal: ac.signal
      })
      if (!res.ok) throw new Error(await res.text())
      const json: any = await res.json()
      const colsRaw = json.columns || []
      const columns: ColumnMeta[] = Array.isArray(colsRaw)
        ? colsRaw.map((c: any) => ({ name: (typeof c === 'string' ? c : (c.name || c.column || c)).toString(), type: c.type }))
        : []
      const rows: any[] = json.rows || []
      setData({ columns, rows })
    } catch (e: any) {
      if (e?.name === 'AbortError') setError('Loading cancelled')
      else setError(e?.message || 'Failed to load dataset')
    } finally {
      setLoading(false)
    }
  }

  // Streaming: open server cursor and fetch first page
  const startStreaming = async () => {
    setLoading(true); setError(null); setIsFullFetch(true); setIsStreaming(true); setAutoStreaming(true)
    setTotalFetched(0); setHasMore(false); setCursorId(null)
    try {
      await ensureApiBase()
      const res = await fetch(`${API_BASE}/chat/execute-sql-stream`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sqlQuery: sql, pageSize: 2000 })
      })
      if (!res.ok) throw new Error(await res.text())
      const json: any = await res.json()
      const colsRaw = json.columns || []
      const columns: ColumnMeta[] = Array.isArray(colsRaw)
        ? colsRaw.map((c: any) => ({ name: (typeof c === 'string' ? c : (c.name || c.column || c)).toString(), type: c.type }))
        : []
      const firstRows: any[] = json.rows || []
      setCursorId(json.cursorId || null)
      setHasMore(!!json.hasMore)
      setTotalFetched(firstRows.length)
      setData({ columns, rows: firstRows.slice(0, PREVIEW_BUFFER_MAX) })
    } catch (e: any) {
      setError(e?.message || 'Failed to start streaming')
      setIsStreaming(false); setAutoStreaming(false)
    } finally {
      setLoading(false)
    }
  }

  const fetchNextPage = async () => {
    if (!cursorId) return
    try {
      const res = await fetch(`${API_BASE}/chat/sql-stream-next`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursorId })
      })
      if (!res.ok) throw new Error(await res.text())
      const json: any = await res.json()
      const rows: any[] = json.rows || []
      setHasMore(!!json.hasMore)
      setTotalFetched(t => t + rows.length)
      setData(prev => {
        const cols = prev?.columns || []
        const prevRows = prev?.rows || []
        const nextRows = (prevRows.length >= PREVIEW_BUFFER_MAX)
          ? [...prevRows]
          : [...prevRows, ...rows].slice(0, PREVIEW_BUFFER_MAX)
        return { columns: cols, rows: nextRows }
      })
      if (!json.hasMore) {
        setIsStreaming(false); setAutoStreaming(false)
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch next page')
      setIsStreaming(false); setAutoStreaming(false)
    }
  }

  // Auto-stream loop
  useEffect(() => {
    let timer: any
    if (autoStreaming && hasMore && cursorId) {
      timer = setTimeout(() => { void fetchNextPage() }, 0)
    }
    return () => { if (timer) clearTimeout(timer) }
  }, [autoStreaming, hasMore, cursorId])

  useEffect(() => {
    if (!isOpen || !sql) return
    // If initial preview data is provided, use it to ensure identical dataset
    if (initialData && Array.isArray(initialData.rows)) {
      const colsRaw = initialData.columns || []
      const columns: ColumnMeta[] = Array.isArray(colsRaw)
        ? colsRaw.map((c: any) => ({ name: (typeof c === 'string' ? c : (c.name || c.column || c)).toString(), type: c.type }))
        : []
      setData({ columns, rows: initialData.rows || [] })
      setIsFullFetch(false)
      setLoading(false)
      setRenderLimit(DEFAULT_RENDER_LIMIT)
      return
    }
    // Use streaming by default for better experience with large datasets
    void startStreaming()
  }, [isOpen, sql, initialData])

  function toggleColumn(col: string) {
    setSelectedColumns((prev) => {
      const set = new Set(prev)
      if (set.has(col)) {
        set.delete(col)
      } else {
        set.add(col)
      }
      return Array.from(set)
    })
  }

  function getFilteredColumnsAndRows() {
    const colsAll = (data?.columns || []).map(c => c.name)
    const colsUse = selectedColumns.length ? selectedColumns : colsAll
    // Use only visible rows for charting to keep things responsive
    const rowsAll = visibleRows
    const rowsUse = rowsAll.map((r) => {
      const out: Record<string, any> = {}
      colsUse.forEach((c) => { out[c] = r[c] })
      return out
    })
    const columnsObj = colsUse.map((name) => ({ name }))
    return { colsUse, rowsUse, columnsObj }
  }

  const downloadCSV = () => {
    if (!data || !data.columns.length) return
    const headers = data.columns.map(c => c.name)
    const csvRows = [headers.join(',')]
    for (const row of visibleRows) {
      const vals = headers.map(h => {
        let v = row[h]
        if (v === null || v === undefined) return ''
        v = String(v)
        if (/[,\n"]/.test(v)) v = '"' + v.replace(/"/g,'""') + '"'
        return v
      })
      csvRows.push(vals.join(','))
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'full_data_view.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const downloadJSON = () => {
    if (!data) return
    const blob = new Blob([JSON.stringify(visibleRows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'full_data_view.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Data Analysis" width={1000}>
      <div className="flex flex-col gap-3 text-slate-100">
        {/* Header Controls */}
        <div className="flex items-center justify-between bg-white/5 p-3 rounded-lg border border-white/10">
          <div className="flex items-center gap-3 text-sm">
            <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
              <FiDatabase className="w-4 h-4" />
            </div>
            <div>
              {data ? (
                <div className="flex flex-col">
                  <span className="font-medium text-white/90">
                    {visibleRows.length.toLocaleString()} <span className="text-white/40">rows visible</span>
                  </span>
                  <span className="text-[10px] text-white/40 uppercase tracking-wider">
                    Total: {isFullFetch ? totalFetched.toLocaleString() : (data.rows.length.toLocaleString())} {isStreaming ? '(streaming)' : ''}
                  </span>
                </div>
              ) : (
                <span className="text-white/50 text-xs italic">{isFullFetch ? 'Initializing full data stream...' : 'Loading preview...'}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="xs" onClick={downloadCSV} title="Download CSV" className="gap-1.5 text-white/60 hover:text-white hover:bg-white/5">
              <FiDownload className="w-3.5 h-3.5" /> CSV
            </Button>
            <Button variant="ghost" size="xs" onClick={downloadJSON} title="Download JSON" className="gap-1.5 text-white/60 hover:text-white hover:bg-white/5">
              <FiDownload className="w-3.5 h-3.5" /> JSON
            </Button>
            <div className="h-4 w-px bg-white/10 mx-1" />
            <Button
              variant="primary"
              size="xs"
              onClick={() => setIsSelectOpen(true)}
              disabled={!data || !data.columns.length || !visibleRows.length}
              className="gap-1.5 shadow-lg shadow-blue-500/20"
            >
              <FiMaximize className="w-3.5 h-3.5" /> Create Chart
            </Button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-between p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-xs">
            <div className="flex items-center gap-2">
              <span className="animate-spin"><FiRefreshCw /></span>
              <span>{isFullFetch ? 'Streaming data from database...' : 'Loading preview...'}</span>
            </div>
            <button className="hover:text-white" onClick={() => { try { abortRef.current?.abort() } catch {} }}>Cancel</button>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm flex items-center gap-2">
            <FiX className="shrink-0" /> {error}
          </div>
        )}

        {!!data && data.rows.length === 0 && !loading && (
          <div className="p-8 text-center border border-dashed border-white/10 rounded-lg">
            <div className="text-white/20 mb-2"><FiDatabase className="w-8 h-8 mx-auto" /></div>
            <div className="text-sm text-white/40">No data returned for this query</div>
          </div>
        )}

        {!!data && data.rows.length > 0 && (
          <div className="border border-white/10 rounded-lg overflow-hidden bg-slate-950">
            <div className="overflow-auto max-h-[60vh] scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900 sticky top-0 z-10 shadow-sm">
                    {data.columns.map(c => (
                      <th
                        key={c.name}
                        onClick={() => toggleColumn(c.name)}
                        className={`text-left px-4 py-3 font-semibold text-white/70 border-b border-white/10 cursor-pointer select-none whitespace-nowrap transition-colors hover:bg-white/5 hover:text-white ${selectedColumns.includes(c.name) ? 'bg-blue-500/10 text-blue-300 border-b-blue-500/30' : ''}`}
                        title={selectedColumns.includes(c.name) ? 'Selected for chart' : 'Click to select this column'}
                      >
                        <div className="flex items-center gap-2">
                           {selectedColumns.includes(c.name) && <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                           {c.name}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {visibleRows.map((r, i) => (
                    <tr key={i} className="hover:bg-white/5 transition-colors">
                      {data.columns.map(c => (
                        <td key={c.name} className="px-4 py-2 text-white/60 whitespace-nowrap font-mono">
                          {r[c.name] === null ? <span className="text-white/20 italic">null</span> : String(r[c.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer Controls */}
            <div className="p-2 border-t border-white/10 bg-slate-900 flex items-center justify-between text-xs text-white/60">
               <div className="flex items-center gap-2">
                  {cursorId && hasMore && (
                     <div className="flex items-center gap-1">
                        <button
                           className={`p-1.5 rounded hover:bg-white/10 ${autoStreaming ? 'text-green-400 bg-green-400/10' : ''}`}
                           onClick={() => { setAutoStreaming(s => !s); setIsStreaming(s => !s); }}
                           title={autoStreaming ? 'Pause streaming' : 'Resume streaming'}
                        >
                           {autoStreaming ? <FiPause /> : <FiPlay />}
                        </button>
                        <button
                           className="p-1.5 rounded hover:bg-white/10"
                           onClick={() => { setAutoStreaming(false); setIsStreaming(false); fetchNextPage(); }}
                           title="Fetch next page manually"
                        >
                           <FiSkipForward />
                        </button>
                     </div>
                  )}
                  <span>
                     {visibleRows.length < data.rows.length && (
                        <span className="text-yellow-500/80 mr-2">
                           ⚠️ {data.rows.length - visibleRows.length} rows hidden
                        </span>
                     )}
                  </span>
               </div>

               <div className="flex items-center gap-2">
                  <button
                     className="px-2 py-1 rounded hover:bg-white/10 disabled:opacity-50"
                     onClick={() => setRenderLimit(l => Math.max(DEFAULT_RENDER_LIMIT, l - 1000))}
                     disabled={visibleRows.length <= DEFAULT_RENDER_LIMIT}
                  >
                     Less
                  </button>
                  <span className="px-2 py-1 bg-white/5 rounded min-w-[60px] text-center">
                     {renderLimit} limit
                  </span>
                  <button
                     className="px-2 py-1 rounded hover:bg-white/10 disabled:opacity-50"
                     onClick={() => setRenderLimit(l => Math.min((data?.rows?.length || 0), l + 1000))}
                     disabled={visibleRows.length >= (data?.rows?.length || 0)}
                  >
                     More
                  </button>
                  <button
                     className="px-2 py-1 rounded hover:bg-white/10 text-blue-300"
                     onClick={() => setRenderLimit(data?.rows?.length || DEFAULT_RENDER_LIMIT)}
                     disabled={visibleRows.length >= (data?.rows?.length || 0)}
                  >
                     Show All
                  </button>
               </div>
            </div>
          </div>
        )}

        <ChartSelectModal
          isOpen={isSelectOpen}
          onClose={() => setIsSelectOpen(false)}
          onSelect={(id) => {
            setLockType(id as any)
            const { colsUse, rowsUse, columnsObj } = getFilteredColumnsAndRows()
            setIsSelectOpen(false)
            setIsChartOpen(true)
          }}
        />
        <ChartBuilderModal
          isOpen={isChartOpen}
          onClose={() => setIsChartOpen(false)}
          initialTitle="Data Analysis Chart"
          lockTable
          lockType={lockType as any}
          initialSql={sql}
          dataOverride={(() => {
            if (!data) return { columns: [], rows: [] }
            const { columnsObj, rowsUse } = getFilteredColumnsAndRows()
            return { columns: columnsObj, rows: rowsUse }
          })()}
          columnsOverride={(() => {
            if (!data) return []
            const { colsUse } = getFilteredColumnsAndRows()
            return colsUse
          })()}
          disableSave={!!disableSave}
        />
      </div>
    </Modal>
  )
}