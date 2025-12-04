import React, { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { useApp } from '../context/AppContext'
import { ChartRenderer } from './ChartRenderer'
import { API_BASE, ensureApiBase } from '../api'

type ChartType =
  | 'line'
  | 'bar'
  | 'column'
  | 'area'
  | 'stackedBar'
  | 'stackedArea'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'radar'
  | 'gauge'
  | 'number'
  | 'histogram'
  | 'table'
  | 'funnel'

// Scrollable chart type catalog
const CHART_TYPES: { id: ChartType; label: string; desc: string }[] = [
  { id: 'line', label: 'Line', desc: 'Trends over time' },
  { id: 'area', label: 'Area', desc: 'Filled trend' },
  { id: 'bar', label: 'Bar', desc: 'Horizontal bars' },
  { id: 'column', label: 'Column', desc: 'Vertical bars' },
  { id: 'stackedBar', label: 'Stacked Bar', desc: 'Parts of whole (H)' },
  { id: 'stackedArea', label: 'Stacked Area', desc: 'Parts of whole (T)' },
  { id: 'pie', label: 'Pie', desc: 'Composition' },
  { id: 'donut', label: 'Donut', desc: 'Composition (ring)' },
  { id: 'scatter', label: 'Scatter', desc: 'Correlation' },
  { id: 'radar', label: 'Radar', desc: 'Multi-axis' },
  { id: 'gauge', label: 'Gauge', desc: 'Single KPI' },
  { id: 'number', label: 'Number', desc: 'Total KPI' },
  { id: 'histogram', label: 'Histogram', desc: 'Distribution' },
  { id: 'table', label: 'Table', desc: 'Data table' },
  { id: 'funnel', label: 'Funnel', desc: 'Process flow' },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  chart?: any
  initialQuery?: string
  initialTitle?: string
  initialType?: ChartType
}

export function AddEditChartModal({ isOpen, onClose, chart, initialQuery, initialTitle, initialType }: Props) {
  const { activeDashboardId, loadDashboards } = useApp()
  const [title, setTitle] = useState('Orders by Month')
  const [type, setType] = useState<ChartType>('line')
  const [query, setQuery] = useState('SELECT month, total_orders FROM orders_summary ORDER BY month')
  const [width, setWidth] = useState(6)
  const [height, setHeight] = useState(6)
  const [xField, setXField] = useState('category')
  const [yField, setYField] = useState('value')
  const [seriesField, setSeriesField] = useState('')
  const [palette, setPalette] = useState('default')
  const [showLegend, setShowLegend] = useState(true)
  const [showGrid, setShowGrid] = useState(true)
  const [smooth, setSmooth] = useState(false)
  const [area, setArea] = useState(false)
  const [stack, setStack] = useState(false)
  const [labelOn, setLabelOn] = useState(false)
  const [dataZoom, setDataZoom] = useState(false)
  const [trendline, setTrendline] = useState(false)
  const [xRotate, setXRotate] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewOverride, setPreviewOverride] = useState<{ columns: Array<{ name: string; type?: string }>; rows: any[] } | undefined>(undefined)

  const previewConfig = useMemo(() => ({
    xField,
    yField,
    seriesField: seriesField || undefined,
    palette,
    showLegend,
    showGrid,
    smooth,
    area,
    stack,
    labelOn,
    dataZoom,
    trendline,
    xRotate,
  }), [xField, yField, seriesField, palette, showLegend, showGrid, smooth, area, stack, labelOn, dataZoom, trendline, xRotate])

  const previewData = useMemo(() => {
    const cols = [{ name: xField }, { name: yField }]
    const makeTrend = (n: number) => Array.from({ length: n }, (_, i) => Math.round(60 + 20 * Math.sin(i / 2) + Math.random() * 20))
    const makeRandoms = (n: number) => Array.from({ length: n }, () => Math.round(50 + Math.random() * 100))
    const names = (n: number, base: string) => Array.from({ length: n }, (_, i) => `${base} ${i + 1}`)
    let rows: any[] = []
    switch (type) {
      case 'line':
      case 'area': {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        const vals = makeTrend(months.length)
        rows = months.map((m, i) => ({ [xField]: m, [yField]: vals[i] }))
        break
      }
      case 'stackedBar':
      case 'stackedArea':
      case 'bar':
      case 'column':
      case 'pie':
      case 'donut':
      case 'radar': {
        const cats = names(8, 'Category')
        const vals = makeRandoms(cats.length)
        rows = cats.map((c, i) => ({ [xField]: c, [yField]: vals[i] }))
        break
      }
      case 'scatter': {
        const cats = names(20, 'Point')
        const vals = makeRandoms(cats.length)
        rows = cats.map((c, i) => ({ [xField]: c, [yField]: vals[i] }))
        break
      }
      case 'histogram': {
        const cats = names(30, 'Value')
        const vals = cats.map(() => Math.round(Math.random() * 100))
        rows = cats.map((c, i) => ({ [xField]: c, [yField]: vals[i] }))
        break
      }
      case 'gauge':
      case 'number': {
        const cats = names(12, 'Step')
        const vals = makeTrend(cats.length)
        rows = cats.map((c, i) => ({ [xField]: c, [yField]: vals[i] }))
        break
      }
      case 'table':
      default: {
        const cats = names(6, 'Row')
        const vals = makeRandoms(cats.length)
        rows = cats.map((c, i) => ({ [xField]: c, [yField]: vals[i] }))
        break
      }
    }
    return { columns: cols, rows }
  }, [type, xField, yField])

  const runPreview = async () => {
    setError(null)
    setPreviewLoading(true)
    try {
      const res = await fetch(`${API_BASE}/query/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: query, full: true }),
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || 'Preview failed')
      }
      const json = await res.json()
      const data = { columns: json.columns || json.meta || [], rows: json.rows || json.data || [] }
      setPreviewOverride(data)
    } catch (e: any) {
      setError(e?.message || 'Error generating preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  const canSubmit = useMemo(() => !!activeDashboardId && title.trim().length > 2 && query.trim().length > 10, [activeDashboardId, title, query])

  React.useEffect(() => {
    if (isOpen) {
      if (chart) {
        setTitle(chart.name || chart.title || '')
        setType((chart.type as ChartType) || 'line')
        const cfg = chart.config || {}
        setQuery(cfg.sqlQuery || chart.query || '')
        const pos = chart.position || { w: 6, h: 6 }
        setWidth(pos.w || 6)
        setHeight(pos.h || 6)
        setXField(cfg.xField || 'category')
        setYField(cfg.yField || 'value')
        setSeriesField(cfg.seriesField || '')
        setPalette(cfg.palette || 'default')
        setShowLegend(cfg.showLegend ?? true)
        setShowGrid(cfg.showGrid ?? true)
        setSmooth(cfg.smooth ?? false)
        setArea(cfg.area ?? false)
        setStack(cfg.stack ?? false)
        setLabelOn(cfg.labelOn ?? false)
        setDataZoom(cfg.dataZoom ?? false)
        setTrendline(cfg.trendline ?? false)
        setXRotate(cfg.xRotate ?? 0)
      } else {
        setTitle(initialTitle || 'Orders by Month')
        setType(initialType || 'line')
        setQuery(initialQuery || 'SELECT month, total_orders FROM orders_summary ORDER BY month')
        setWidth(6)
        setHeight(6)
        setXField('category')
        setYField('value')
        setSeriesField('')
        setPalette('default')
        setShowLegend(true)
        setShowGrid(true)
        setSmooth(false)
        setArea(false)
        setStack(false)
        setLabelOn(false)
        setDataZoom(false)
        setTrendline(false)
        setXRotate(0)
      }
      setError(null)
    }
  }, [isOpen, chart, initialQuery, initialTitle, initialType])

  const onSave = async () => {
    if (!activeDashboardId) return
    setError(null)
    setLoading(true)
    try {
      const body = {
        type,
        name: title,
        config: {
          sqlQuery: query,
          xField,
          yField,
          seriesField: seriesField || undefined,
          palette,
          showLegend,
          showGrid,
          smooth,
          area,
          stack,
          labelOn,
          dataZoom,
          trendline,
          xRotate,
        },
        position: { x: 0, y: 0, w: width, h: height },
      }
      let res: Response
      if (chart?.id) {
        await ensureApiBase()
        res = await fetch(`${API_BASE}/dashboards/${activeDashboardId}/charts/${chart.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        await ensureApiBase()
        res = await fetch(`${API_BASE}/dashboards/${activeDashboardId}/charts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || 'Failed to save chart')
      }
      const saved = await res.json().catch(() => null)
      await loadDashboards()
      try {
        const chartId = (saved?.chart?.id) || (chart?.id)
        if (chartId) {
          window.dispatchEvent(new CustomEvent('chart-saved', { detail: { chartId } }))
        } else {
          window.dispatchEvent(new CustomEvent('refresh-all-charts'))
        }
      } catch {}
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Error saving chart')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Chart" width={780} minWidth={720} minHeight={520}>
      <div className="flex flex-col">
        <div className="overflow-y-auto space-y-5 pb-2">
          <label className="block">
            <div className="text-sm text-white/80">Title</div>
            <input value={title} onChange={e => setTitle(e.target.value)} className="mt-1 w-full glass p-2 rounded-md" />
          </label>

          <div className="block">
            <div className="text-sm text-white/80">Type</div>
            <div className="mt-1 max-h-40 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {CHART_TYPES.map(t => (
                <button
                  key={t.id}
                  className={`glass rounded-md p-3 text-left text-xs hover:ring-2 hover:ring-cyan-400 ${type === t.id ? 'ring-2 ring-cyan-400 bg-white/5' : ''}`}
                  onClick={() => setType(t.id)}
                >
                  <div className="font-medium text-white/90">{t.label}</div>
                  <div className="text-white/60">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <div className="text-sm text-white/80">SQL Query</div>
            <textarea value={query} onChange={e => setQuery(e.target.value)} className="mt-1 w-full glass p-2 rounded-md h-28"></textarea>
            <div className="mt-2">
              <button className="btn" disabled={!query.trim() || previewLoading} onClick={runPreview}>{previewLoading ? 'Previewing...' : 'Run Preview'}</button>
            </div>
          </label>

          <div className="flex gap-4">
            <div className="flex-1">
              <div className="text-sm text-white/80">Width (grid cols)</div>
              <input type="number" min={3} max={12} value={width} onChange={e => setWidth(Number(e.target.value))} className="mt-1 w-full glass p-2 rounded-md" />
            </div>
            <div className="flex-1">
              <div className="text-sm text-white/80">Height (grid rows)</div>
              <input type="number" min={3} max={12} value={height} onChange={e => setHeight(Number(e.target.value))} className="mt-1 w-full glass p-2 rounded-md" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <div className="text-sm text-white/80">X Field</div>
              <input value={xField} onChange={e => setXField(e.target.value)} className="mt-1 w-full glass p-2 rounded-md" />
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Y Field</div>
              <input value={yField} onChange={e => setYField(e.target.value)} className="mt-1 w-full glass p-2 rounded-md" />
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Series Field</div>
              <input value={seriesField} onChange={e => setSeriesField(e.target.value)} className="mt-1 w-full glass p-2 rounded-md" placeholder="Optional" />
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Palette</div>
              <select value={palette} onChange={e => setPalette(e.target.value)} className="mt-1 glass p-2 rounded-md">
                <option value="default">Default</option>
                <option value="cool">Cool</option>
                <option value="warm">Warm</option>
                <option value="neon">Neon</option>
              </select>
            </label>
            <div className="flex items-center gap-3 mt-2">
              <input id="legend" type="checkbox" checked={showLegend} onChange={e => setShowLegend(e.target.checked)} />
              <label htmlFor="legend" className="text-sm text-white/80">Show Legend</label>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <input id="grid" type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
              <label htmlFor="grid" className="text-sm text-white/80">Show Grid</label>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <input id="smooth" type="checkbox" checked={smooth} onChange={e => setSmooth(e.target.checked)} />
              <label htmlFor="smooth" className="text-sm text-white/80">Smooth Lines</label>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <input id="area" type="checkbox" checked={area} onChange={e => setArea(e.target.checked)} />
              <label htmlFor="area" className="text-sm text-white/80">Fill Area</label>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <input id="stack" type="checkbox" checked={stack} onChange={e => setStack(e.target.checked)} />
              <label htmlFor="stack" className="text-sm text-white/80">Stack Series</label>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <input id="labelOn" type="checkbox" checked={labelOn} onChange={e => setLabelOn(e.target.checked)} />
              <label htmlFor="labelOn" className="text-sm text-white/80">Show Values</label>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <input id="dataZoom" type="checkbox" checked={dataZoom} onChange={e => setDataZoom(e.target.checked)} />
              <label htmlFor="dataZoom" className="text-sm text-white/80">Enable Zoom</label>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <input id="trendline" type="checkbox" checked={trendline} onChange={e => setTrendline(e.target.checked)} />
              <label htmlFor="trendline" className="text-sm text-white/80">Show Trendline</label>
            </div>
            <label className="block">
              <div className="text-sm text-white/80">X-Axis Rotation</div>
              <select value={xRotate} onChange={e => setXRotate(Number(e.target.value))} className="mt-1 glass p-2 rounded-md w-full">
                <option value={0}>0°</option>
                <option value={45}>45°</option>
                <option value={90}>90°</option>
              </select>
            </label>
          </div>

          {error && <div className="text-red-400 text-sm px-1">{error}</div>}

          <div className="mt-2">
            <div className="text-sm text-white/80 mb-2">Preview</div>
            <div className="glass rounded-md p-3">
              <ChartRenderer title={title || 'Preview'} type={type} config={previewConfig} data={previewOverride || previewData} />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-black/40 backdrop-blur-sm px-6 pt-3 border-t border-white/10">
          <div className="flex justify-between gap-3">
            <div>
              {chart?.id ? (
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      await ensureApiBase()
                      const res = await fetch(`${API_BASE}/dashboards/${activeDashboardId}/charts/${chart.id}`, { method: 'DELETE' })
                      if (!res.ok) {
                        const msg = await res.text()
                        throw new Error(msg || 'Failed to delete chart')
                      }
                      await loadDashboards()
                      onClose()
                    } catch (e: any) {
                      setError(e?.message || 'Error deleting chart')
                    }
                  }}
                >Delete</button>
              ) : null}
            </div>
            <div className="flex gap-3">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn" disabled={!canSubmit || loading} onClick={onSave}>{loading ? 'Saving...' : (chart?.id ? 'Save' : 'Add to Dashboard')}</button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// Conditionally render visual toggles where they make sense
// Smooth/Area for line & area; Stack for bar/column variants
// (Adjust existing checkbox block down the file)
