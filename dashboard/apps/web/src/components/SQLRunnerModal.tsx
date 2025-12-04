import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { API_BASE, ensureApiBase } from '../api';
import SQLInput from './ui/SQLInput';
import { ChartRenderer } from './ChartRenderer';
import ChartBuilderModal from './ChartBuilderModal'

// Safe formatter to avoid [object Object] in cell rendering
const formatCell = (v: any): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ((v as any).type === 'Buffer' && Array.isArray((v as any).data)) {
      const bytes: number[] = (v as any).data;
      const hex = bytes.slice(0, 32).map(n => n.toString(16).padStart(2,'0')).join('');
      return `0x${hex}${bytes.length>32?'…':''}`;
    }
    try { return JSON.stringify(v); } catch { return Object.prototype.toString.call(v); }
  }
  return String(v);
};

interface TableInfo { name: string }
interface HistoryEntry { id: string; sql: string; createdAt: string; elapsedMs?: number; rowsCount?: number; error?: string }
interface SavedQuery { id: string; name: string; sql: string; description?: string; createdAt: string; updatedAt?: string }

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function SQLRunnerModal({ isOpen, onClose }: Props) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [limit, setLimit] = useState(10);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [showChart, setShowChart] = useState(false);
  const [showFullDataset, setShowFullDataset] = useState(false);
  const [xCol, setXCol] = useState<string>('');
  const [yCol, setYCol] = useState<string>('');
  const [y2Col, setY2Col] = useState<string>('');
  const [chartType, setChartType] = useState<string>('line');
  const [palette, setPalette] = useState<string>('default');
  const [chartShowLegend, setChartShowLegend] = useState<boolean>(true);
  const [chartShowGrid, setChartShowGrid] = useState<boolean>(true);
  const [chartSmooth, setChartSmooth] = useState<boolean>(false);
  const [chartArea, setChartArea] = useState<boolean>(false);
  const [chartStack, setChartStack] = useState<boolean>(false);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [saveName, setSaveName] = useState<string>('');
  const [shareUrl, setShareUrl] = useState<string>('');
  const [showHistory, setShowHistory] = useState<boolean>(true);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(true);
  const chartInstanceRef = useRef<any>(null);
  const [isChartConfigOpen, setIsChartConfigOpen] = useState(false);
  const [split, setSplit] = useState<number>(50);
  const splitDraggingRef = useRef<boolean>(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [isAddChartOpen, setIsAddChartOpen] = useState(false);
  const chartColumns = useMemo(() => [xCol, yCol, y2Col].filter(Boolean).map(name => ({ name })), [xCol, yCol, y2Col]);
  const chartData = useMemo(() => ({ columns: chartColumns, rows }), [chartColumns, rows]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try { await ensureApiBase(); } catch {}
      // Load preferences for defaults
      fetch(`${API_BASE}/query/prefs`).then(r => r.json()).then((p) => {
        if (typeof p.defaultLimit === 'number') setLimit(p.defaultLimit);
        if (typeof p.pageSize === 'number') setPageSize(p.pageSize);
      }).catch(() => {});
      // Load tables
      fetch(`${API_BASE}/data/tables`).then(r => r.json()).then((data) => {
        const items: TableInfo[] = (data.tables || [])
          .map((t: any): TableInfo => ({ name: String(t.TABLE_NAME || t.name || '') }))
          .filter((t: TableInfo) => !!t.name);
        const uniqNames: string[] = Array.from(new Set(items.map((it: TableInfo) => it.name)));
        const uniq: TableInfo[] = uniqNames.map((name: string) => ({ name }));
        setTables(uniq);
      }).catch(() => {
        setTables([]);
      });
      // Load saved queries
      fetch(`${API_BASE}/query/saved`).then(r => r.json()).then(d => {
        setSaved(d.saved || []);
      }).catch(()=> setSaved([]));
      // Load history
      fetch(`${API_BASE}/query/history`).then(r => r.json()).then(d => {
        setHistory(d.history || []);
      }).catch(()=> setHistory([]));
    })();
  }, [isOpen]);

  // Refresh suggestions when table changes
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try { await ensureApiBase(); } catch {}
      fetch(`${API_BASE}/query/suggest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: selectedTable || undefined })
      }).then(r => r.json()).then(d => {
        const suggRaw: any[] = (d.suggestions || []);
        const uniqSugg: string[] = Array.from(new Set(suggRaw.filter((s: unknown): s is string => typeof s === 'string')));
        setSuggestions(uniqSugg);
      }).catch(() => setSuggestions([]));
    })();
  }, [isOpen, selectedTable]);

  // Build default query when table/limit changes
  useEffect(() => {
    if (selectedTable) {
      setQuery(`SELECT * FROM ${selectedTable} WHERE ROWNUM <= ${limit}`);
    } else {
      setQuery('');
    }
  }, [selectedTable, limit]);

  // Listen for sidebar-driven SQL Runner actions
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      switch (action) {
        case 'open':
          // no-op inside modal; handled in AppShell
          break;
        case 'run':
          onRun();
          break;
        case 'save':
          saveCurrentQuery();
          break;
        case 'share':
          shareCurrentQuery();
          break;
        case 'export':
          serverExportCSV();
          break;
        case 'format':
          formatSQL();
          break;
        case 'clear':
          clearAll();
          break;
        case 'toggleHistory':
          setShowHistory(s => !s);
          break;
        case 'toggleSuggestions':
          setShowSuggestions(s => !s);
          break;
        case 'toggleChart':
          setIsAddChartOpen(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener('sqlrunner-action', handler as EventListener);
    return () => window.removeEventListener('sqlrunner-action', handler as EventListener);
  }, [isOpen]);
  const onRun = async () => {
    setLoading(true); setError(null); setRows([]); setColumns([]); setElapsedMs(null); setShowChart(false);
    const t0 = performance.now();
    try {
      await ensureApiBase();
      const res = await fetch(`${API_BASE}/query/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: query })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Query failed');
      const rs = data.rows || [];
      setRows(rs);
      const colsRawAny: any[] = Array.isArray(data.columns) ? data.columns : (rs.length ? Object.keys(rs[0]) : []);
      const colsRaw: string[] = colsRawAny.map(c => String(c));
      const cols: string[] = Array.from(new Set(colsRaw));
      setColumns(cols);
      setXCol(cols[0] || '');
      setYCol(cols[1] || '');
      setY2Col(cols[2] || '');
      const t1 = performance.now();
      setElapsedMs(Math.round(t1 - t0));
    } catch (e: any) {
      setError(e.message || 'Failed to run query');
    } finally {
      setLoading(false);
    }
    // Refresh history after run
    try { await ensureApiBase(); } catch {}
    fetch(`${API_BASE}/query/history`).then(r => r.json()).then(d => setHistory(d.history || [])).catch(()=>{});
  }

  const sortedRows = useMemo(() => {
    if (!rows.length || !sortBy) return rows;
    const rs = [...rows];
    rs.sort((a,b) => {
      const av = a[sortBy!]; const bv = b[sortBy!];
      if (av == null && bv == null) return 0; if (av == null) return -1; if (bv == null) return 1;
      const na = typeof av === 'number' ? av : Number(av);
      const nb = typeof bv === 'number' ? bv : Number(bv);
      const bothNumeric = !isNaN(na) && !isNaN(nb);
      if (bothNumeric) return sortDir === 'asc' ? na - nb : nb - na;
      const sa = String(av).toLowerCase(); const sb = String(bv).toLowerCase();
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return rs;
  }, [rows, sortBy, sortDir]);

  const total = sortedRows.length;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);
  const visibleRows = useMemo(() => showFullDataset ? sortedRows : pagedRows, [sortedRows, pagedRows, showFullDataset]);

  const onHeaderClick = (c: string) => {
    if (sortBy === c) setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); else { setSortBy(c); setSortDir('asc'); }
    setPage(1);
  }

  const exportCSV = () => {
    if (!rows.length) return;
    const cols = columns;
    const header = cols.join(',');
    const body = rows.map(r => cols.map(c => {
      const v = r[c];
      const s = v == null ? '' : formatCell(v);
      const escaped = '"' + s.replace(/"/g,'""') + '"';
      return escaped;
    }).join(',')).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'query-results.csv'; a.click(); URL.revokeObjectURL(url);
  }

  const serverExportCSV = async () => {
    try {
      await ensureApiBase();
      const res = await fetch(`${API_BASE}/query/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: query, format: 'csv', filename: 'query-results.csv' })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'query-results.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || 'Export failed');
    }
  }

  const saveCurrentQuery = async () => {
    try {
      await ensureApiBase();
      const name = (saveName || 'Untitled').trim();
      const res = await fetch(`${API_BASE}/query/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sql: query })
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Save failed');
      setSaved(prev => [d, ...prev.filter(sq => sq.id !== d.id)].slice(0, 20));
      setSaveName(d.name || name);
      setShareUrl('');
    } catch (e: any) {
      setError(e.message || 'Save failed');
    }
  }

  const shareCurrentQuery = async () => {
    try {
      await ensureApiBase();
      const name = (saveName || 'Untitled').trim();
      const res = await fetch(`${API_BASE}/query/share`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sql: query })
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Share failed');
      const url = `${API_BASE}/query/share/${d.id}`;
      setShareUrl(url);
    } catch (e: any) {
      setError(e.message || 'Share failed');
    }
  }

  const formatSQL = () => {
    setQuery(prev => prev.trim().replace(/\s+/g, ' '));
  }

  const clearAll = () => {
    setQuery('');
    setRows([]);
    setColumns([]);
    setElapsedMs(null);
    setError(null);
  }

  const reloadPrefs = async () => {
    try {
      await ensureApiBase();
      const p = await (await fetch(`${API_BASE}/query/prefs`)).json();
      if (typeof p.defaultLimit === 'number') setLimit(p.defaultLimit);
      if (typeof p.pageSize === 'number') setPageSize(p.pageSize);
    } catch {}
  }

  const exportChartPNG = () => {
    const inst = chartInstanceRef.current;
    if (!inst) return;
    const dataUrl = inst.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#0b1220' });
    const a = document.createElement('a'); a.href = dataUrl; a.download = 'chart.png'; a.click();
  }

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <Card variant="elevated" className="relative w-[860px] max-w-[92vw] p-3 max-h-[90vh]">
        <div className="max-h-[85vh] overflow-auto pr-2">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-white text-sm">SQL Runner</h3>
              <div className="text-[11px] text-white/50">Compact, fast results with charts</div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Button variant="primary" size="sm" onClick={onRun} disabled={!query} loading={loading}>Run</Button>
            <Button variant="ghost" size="sm" onClick={saveCurrentQuery} disabled={!query}>Save</Button>
            <Button variant="ghost" size="sm" onClick={shareCurrentQuery} disabled={!query}>Share</Button>
            <Button variant="ghost" size="sm" onClick={serverExportCSV} disabled={!query}>Export CSV</Button>
            <Button variant="ghost" size="sm" onClick={formatSQL} disabled={!query}>Format SQL</Button>
            <Button variant="ghost" size="sm" onClick={clearAll}>Clear</Button>
            <Button variant="ghost" size="sm" onClick={()=>setShowHistory(s=>!s)}>{showHistory ? 'Hide' : 'Show'} History</Button>
            <Button variant="ghost" size="sm" onClick={()=>setShowSuggestions(s=>!s)}>{showSuggestions ? 'Hide' : 'Show'} Suggestions</Button>
            {/* Duplicate Add Chart button removed - use the one in results or chart view */}
            <Button variant="ghost" size="sm" onClick={reloadPrefs}>Reload Prefs</Button>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div>
              <div className="text-xs text-white/60 mb-1">Table</div>
              <select value={selectedTable} onChange={(e) => setSelectedTable(e.target.value)} className="glass w-full rounded-md p-2 text-xs">
                <option value="">Select table</option>
                {tables.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <div className="text-xs text-white/60 mb-1">Limit rows</div>
              <input type="number" min={1} max={1000} value={limit} onChange={(e) => setLimit(parseInt(e.target.value || '10', 10))} className="glass w-full rounded-md p-2 text-xs" />
            </div>
            {/* Duplicate Execute button removed */}
          </div>
          <div className="mb-2">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-white/60">SQL</div>
              <div className="flex items-center gap-3 text-[11px] text-white/50">
                {elapsedMs != null && <div>Time: <span className="text-white/70">{elapsedMs} ms</span></div>}
                <div>Rows: <span className="text-white/70">{rows.length}</span></div>
              </div>
            </div>
            <SQLInput value={query} onChange={setQuery} rows={3} />
            {showSuggestions && (
              <div className="flex flex-wrap gap-2 mt-2">
                {suggestions.slice(0,3).map((s, i) => (
                  <button key={i} className="text-[11px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/80" onClick={() => setQuery(s)}>
                    {s.length>80 ? s.slice(0,80)+'…' : s}
                  </button>
                ))}
              </div>
            )}
            {shareUrl && <div className="mt-1 text-[11px]"><span className="text-white/60">Share URL:</span> <a className="text-blue-300 underline" href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a></div>}
          </div>
          {error && <div className="mt-2 text-red-400 text-xs">{error}</div>}
          <div className="mt-2">
            {!rows.length ? (
              <div className="text-white/60 text-xs">Run a query to see results.</div>
            ) : (
              !showChart ? ( <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-white/60">Results</div>
                  <div className="flex items-center gap-3 text-[11px] text-white/60">
                    <div>Sorted by: <span className="text-white/80">{sortBy || 'none'}</span> {sortBy && `(${sortDir})`}</div>
                    {!showFullDataset && <div>Page: <span className="text-white/80">{page}</span> / {maxPage}</div>}
                    <div>Page size:
                      <select className="ml-1 glass rounded px-1 py-0.5 text-[11px]" value={pageSize} onChange={(e)=>{ setPageSize(parseInt(e.target.value,10)); setPage(1); }} disabled={showFullDataset}>
                        {[10,20,50,100].map(n=> <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setShowFullDataset(s => !s)} title="Toggle full dataset">{showFullDataset ? 'Show Paged' : 'Show Full'}</Button>
                    <Button variant="ghost" size="sm" onClick={exportCSV} title="Export results as CSV">Export CSV</Button>
                    {!!columns.length && <Button variant="primary" size="sm" onClick={() => setIsAddChartOpen(true)} title="Add chart from these results">Add Chart</Button>}
                  </div>
                </div>
                <div className="overflow-x-auto overflow-y-auto max-h-[60vh]">
                  <table className="w-max min-w-full border-collapse text-[11px]">
                    <thead>
                      <tr>
                        {columns.map((c) => (
                          <th key={c} onClick={()=>onHeaderClick(c)} className="text-left px-1.5 py-0.5 border-b border-white/10 text-white/70 cursor-pointer select-none whitespace-nowrap">
                            <span>{c}</span>
                            {sortBy === c && <span className="ml-1 text-white/50">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row, idx) => (
                        <tr key={idx} className="odd:bg-background">
                          {columns.map((c) => (
                            <td key={c} className="px-1.5 py-0.5 border-b border-white/5 text-white/80 whitespace-nowrap">{formatCell(row[c])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between text-[11px] text-white/60">
                  <div>Total rows: <span className="text-white/80">{total}</span>. {showFullDataset ? `Showing all ${total}.` : `Showing ${(page-1)*pageSize+1}-${Math.min(page*pageSize,total)}.`}</div>
                  {!showFullDataset && (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1}>Prev</Button>
                      <Button variant="ghost" size="sm" onClick={()=>setPage(p=>Math.min(maxPage,p+1))} disabled={page>=maxPage}>Next</Button>
                    </div>
                  )}
                </div>
              </div>
              ) : (
                <div className="grid gap-4" ref={splitContainerRef} style={{ gridTemplateColumns: `${split}% 6px ${100 - split}%` }}>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-white/60">Results</div>
                      <div className="flex items-center gap-3 text-[11px] text-white/60">
                        <div>Page: <span className="text-white/80">{page}</span> / {maxPage}</div>
                        <div>Page size:
                          <select className="ml-1 glass rounded px-1 py-0.5 text-[11px]" value={pageSize} onChange={(e)=>{ setPageSize(parseInt(e.target.value,10)); setPage(1); }} disabled={showFullDataset}>
                            {[10,20,50,100].map(n=> <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setShowFullDataset(s => !s)} title="Toggle full dataset">{showFullDataset ? 'Show Paged' : 'Show Full'}</Button>
                        <Button variant="ghost" size="sm" onClick={() => setShowChart(false)} title="Hide chart and focus table">Hide Chart</Button>
                      </div>
                    </div>
                    <div className="overflow-x-auto overflow-y-auto max-h-[60vh]">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr>
                            {columns.map((c) => (
                              <th key={c} onClick={()=>onHeaderClick(c)} className="text-left px-2 py-1 border-b border-white/10 text-white/70 cursor-pointer select-none">
                                <span>{c}</span>
                                {sortBy === c && <span className="ml-1 text-white/50">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleRows.map((row, idx) => (
                            <tr key={idx} className="odd:bg-background">
                              {columns.map((c) => (
                                <td key={c} className="px-2 py-1 border-b border-white/5 text-white/80">{formatCell(row[c])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div
                    role="separator"
                    title="Drag to resize panels"
                    onMouseDown={(e) => {
                      splitDraggingRef.current = true
                      const startX = e.clientX
                      const rect = splitContainerRef.current?.getBoundingClientRect()
                      const totalW = rect?.width || window.innerWidth
                      const onMove = (ev: MouseEvent) => {
                        if (!splitDraggingRef.current) return
                        const dx = ev.clientX - startX
                        const startPct = split
                        const deltaPct = (dx / totalW) * 100
                        const next = Math.max(25, Math.min(75, startPct + deltaPct))
                        setSplit(next)
                      }
                      const onUp = () => {
                        splitDraggingRef.current = false
                        window.removeEventListener('mousemove', onMove)
                        window.removeEventListener('mouseup', onUp)
                      }
                      window.addEventListener('mousemove', onMove)
                      window.addEventListener('mouseup', onUp)
                    }}
                    className="w-1 cursor-col-resize bg-white/10 hover:bg-white/20 rounded"
                  />
                  <div className="space-y-4 transition-all min-w-[240px]">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-white/60 mb-1">X Column</div>
                        <select value={xCol} onChange={(e) => setXCol(e.target.value)} className="glass w-full rounded-md p-2 text-xs" title="X axis column">
                          <option value="">Select column</option>
                          {columns.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-white/60 mb-1">Y Column</div>
                        <select value={yCol} onChange={(e) => setYCol(e.target.value)} className="glass w-full rounded-md p-2 text-xs" title="Y axis column">
                          <option value="">Select column</option>
                          {columns.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-white/60 mb-1">Y2 Column</div>
                        <select value={y2Col} onChange={(e) => setY2Col(e.target.value)} className="glass w-full rounded-md p-2 text-xs" title="Optional second Y series">
                          <option value="">Select column</option>
                          {columns.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-white/60 mb-1">Chart Type</div>
                        <select value={chartType} onChange={(e) => setChartType(e.target.value as any)} className="glass w-full rounded-md p-2 text-xs" title="Chart type">
                          <option value="line">Line</option>
                          <option value="bar">Bar</option>
                          <option value="column">Column</option>
                          <option value="scatter">Scatter</option>
                          <option value="pie">Pie</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setChartShowLegend(s => !s)} title="Toggle legend">{chartShowLegend ? 'Hide' : 'Show'} Legend</Button>
                      <Button variant="ghost" size="sm" onClick={() => setChartShowGrid(s => !s)} title="Toggle grid">{chartShowGrid ? 'Hide' : 'Show'} Grid</Button>
                      <Button variant="ghost" size="sm" onClick={() => setChartSmooth(s => !s)} title="Toggle smoothing">{chartSmooth ? 'Disable' : 'Enable'} Smooth</Button>
                      <Button variant="ghost" size="sm" onClick={() => setChartArea(s => !s)} title="Toggle area fill">{chartArea ? 'Disable' : 'Enable'} Area</Button>
                      <Button variant="ghost" size="sm" onClick={() => setChartStack(s => !s)} title="Toggle stacking">{chartStack ? 'Disable' : 'Enable'} Stack</Button>
                      <Button variant="ghost" size="sm" onClick={exportChartPNG} title="Export chart as PNG">Export PNG</Button>
                      <Button variant="primary" size="sm" onClick={() => setIsAddChartOpen(true)} title="Save this chart to dashboard">Add to Dashboard</Button>
                    </div>
                    <div className="h-[400px] transition-all">
                      <ChartRenderer
                        onChartReady={(inst) => { chartInstanceRef.current = inst }}
                        title=""
                        type={chartType}
                        config={{
                          smooth: chartSmooth,
                          area: chartArea,
                          stack: chartStack,
                          showLegend: chartShowLegend,
                          showGrid: chartShowGrid,
                          palette
                        }}
                        data={{ columns: [xCol, yCol, y2Col].filter(Boolean).map(name => ({ name })), rows }}
                        loading={loading}
                        error={error ?? undefined}
                      />
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
          {!!rows.length && (
            <></>
          )}

          {/* Add-to-dashboard chart builder modal */}
          <ChartBuilderModal
            isOpen={isAddChartOpen}
            onClose={() => setIsAddChartOpen(false)}
            initialTitle={'SQL Runner Chart'}
            lockType={chartType as any}
            initialTable={selectedTable || ''}
            initialFields={{ x: xCol || undefined, y: yCol || undefined, y2: y2Col || undefined }}
            initialPalette={palette}
            initialShowLegend={chartShowLegend}
            initialShowGrid={chartShowGrid}
            initialSmooth={chartSmooth}
            initialArea={chartArea}
            initialStack={chartStack}
            lockTable={true}
            columnsOverride={Array.from(new Set(columns))}
            dataOverride={{ columns: Array.from(new Set(columns)), rows }}
          />
          {/* History list */}
          {!!history.length && showHistory && (
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-white/60">Recent Queries</div>
                <Button variant="ghost" size="sm" onClick={()=>setShowHistory(s=>!s)}>{showHistory ? 'Hide' : 'Show'}</Button>
              </div>
              <div className="max-h-24 overflow-auto border border-white/10 rounded">
                {history.slice(0,8).map(h => (
                  <div key={h.id} className="px-2 py-1 text-[11px] text-white/70 hover:bg-white/5 cursor-pointer" onClick={()=> setQuery(h.sql)}>
                    <span className="mr-2 text-white/50">{new Date(h.createdAt).toLocaleTimeString()}</span>
                    <span className="mr-2">{(h.rowsCount ?? 0)} rows</span>
                    <span className="mr-2">{(h.elapsedMs ?? 0)} ms</span>
                    <span className="text-white/80">{h.sql.slice(0, 80)}{h.sql.length>80?'…':''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}