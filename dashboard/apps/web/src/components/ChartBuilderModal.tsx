import React, { useMemo, useState, useEffect } from 'react'
import { Modal } from './Modal'
import { useApp } from '../context/AppContext'
import { ChartRenderer } from './ChartRenderer'
import { API_BASE, ensureApiBase } from '../api'

type ChartType =
  | 'line' | 'bar' | 'column' | 'area' | 'stackedBar' | 'stackedArea'
  | 'pie' | 'donut' | 'funnel' | 'scatter' | 'bubble' | 'heatmap' | 'radar' | 'treemap'
  | 'gauge' | 'number' | 'candlestick' | 'histogram' | 'table'

interface Props {
  isOpen: boolean
  onClose: () => void
  chart?: any
  initialTitle?: string
  initialType?: ChartType
  lockType?: ChartType
  initialFields?: { x?: string; y?: string; y2?: string }
  initialPalette?: string
  initialTable?: string
  initialSql?: string
  columnsOverride?: string[]
  lockTable?: boolean
  initialShowLegend?: boolean
  initialShowGrid?: boolean
  initialSmooth?: boolean
  initialArea?: boolean
  initialStack?: boolean
  dataOverride?: { columns: (string | { name: string })[]; rows: any[] }
  disableSave?: boolean
}

const TABS = ['Data', 'Transform', 'Visual'] as const
type Tab = typeof TABS[number]

export default function ChartBuilderModal(props: Props) {
  const { isOpen, onClose, chart, initialTitle, initialType, lockType, initialFields, initialPalette, initialTable, initialSql, columnsOverride, lockTable, initialShowLegend, initialShowGrid, initialSmooth, initialArea, initialStack, dataOverride, disableSave } = props
  const { activeDashboardId, loadDashboards } = useApp()

  const [tab, setTab] = useState<Tab>('Data')

  // Data
  const [table, setTable] = useState<string>(initialTable || '')
  const [columns, setColumns] = useState<string[]>([])
  const [tables, setTables] = useState<string[]>([])
  const [xField, setXField] = useState<string>(initialFields?.x || '')
  const [yField, setYField] = useState<string>(initialFields?.y || '')
  const [yAgg, setYAgg] = useState<'none'|'sum'|'avg'|'count'|'min'|'max'>('none')
  const [selection, setSelection] = useState<string>('') // simple filter string

  // Transform
  const [y2Field, setY2Field] = useState<string>(initialFields?.y2 || '')
  const [y2Agg, setY2Agg] = useState<'none'|'sum'|'avg'|'count'|'min'|'max'>('none')
  const [orderBy, setOrderBy] = useState<string>('')
  const [orderDir, setOrderDir] = useState<'ASC'|'DESC'>('ASC')
  const [limit, setLimit] = useState<number>(0)
  const [groupByY1Enabled, setGroupByY1Enabled] = useState<boolean>(false)
  const [groupByEnabled, setGroupByEnabled] = useState<boolean>(true)

  // Visual
  const [type, setType] = useState<ChartType>(lockType || initialType || 'line')
  const [title, setTitle] = useState<string>(initialTitle || 'New Chart')
  const [palette, setPalette] = useState<string>(initialPalette || 'default')
  const [primaryColor, setPrimaryColor] = useState<string>('#4f46e5')
  const [liveMode, setLiveMode] = useState<boolean>(true)
  const [activePreviewMode, setActivePreviewMode] = useState<'live'|'static'|null>(null)
  const [showLegend, setShowLegend] = useState(initialShowLegend ?? true)
  const [showGrid, setShowGrid] = useState(initialShowGrid ?? true)
  const [smooth, setSmooth] = useState(initialSmooth ?? false)
  const [area, setArea] = useState(initialArea ?? false)
  const [stack, setStack] = useState(initialStack ?? false)
  const [lineWidth, setLineWidth] = useState<number>(2)
  const [areaOpacity, setAreaOpacity] = useState<number>(0.4)
  const [barWidth, setBarWidth] = useState<number>(0.8)
  const [borderRadius, setBorderRadius] = useState<number>(4)
  const [tooltip, setTooltip] = useState<boolean>(true)
  const [animation, setAnimation] = useState<boolean>(true)
  const [xTickRotate, setXTickRotate] = useState<number>(0)
  const [yFormat, setYFormat] = useState<string>('0,0')
  const [titleEdited, setTitleEdited] = useState<boolean>(false)

  const [width, setWidth] = useState<number>(6)
  const [height, setHeight] = useState<number>(6)

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewData, setPreviewData] = useState<{ columns: { name: string }[], rows: any[] } | null>(null)
  // Derived preview after applying client-side aggregation/validation when using result-only data (dataOverride)
  const derivedPreview = useMemo(() => {
    if (!previewData) return { data: null as any, error: null as string | null }
    // Live mode (dashboard header): use backend preview as-is, no client transforms
    if (!dataOverride) return { data: previewData, error: null }
    // If backend already returned aliased columns (x/y[/y2]), use as-is (case-insensitive)
    const colNames = previewData.columns.map(c => c.name)
    const colNamesLC = colNames.map(n => String(n).toLowerCase())
    const hasAliased = colNamesLC.includes('x') && colNamesLC.includes('y')
    if (hasAliased) return { data: previewData, error: null }

    // When working with result-only data, require selected X/Y to exist
    if (!xField || !yField) return { data: null, error: null }
    const xExists = colNames.includes(xField) || colNamesLC.includes(String(xField).toLowerCase())
    const yExists = colNames.includes(yField) || colNamesLC.includes(String(yField).toLowerCase())
    const y2Exists = !!y2Field && (colNames.includes(y2Field) || colNamesLC.includes(String(y2Field).toLowerCase()))
    if (!xExists || !yExists) return { data: null, error: 'Select X and Y columns present in the result.' }

    const toNum = (v: any): number | null => {
      if (v === null || v === undefined) return null
      if (typeof v === 'number') return isFinite(v) ? v : null
      if (typeof v === 'string') { const s = v.trim(); if (!s.length) return null; const n = Number(s); return isFinite(n) ? n : null }
      return null
    }

    const yNumsAll = previewData.rows.map(r => toNum(r[yField])).filter(v => v !== null) as number[]
    const xNumsAll = previewData.rows.map(r => toNum(r[xField])).filter(v => v !== null) as number[]
    const requiresNumericY = ['line','area','bar','column','stackedBar','stackedArea','pie','donut','radar','treemap','gauge','histogram','candlestick','heatmap']
    const requiresNumericXForScatter = ['scatter','bubble']
    if (requiresNumericY.includes(type) && yAgg !== 'count' && yAgg !== 'none' && yNumsAll.length === 0) {
      return { data: null, error: `Y column '${yField}' must be numeric for ${yAgg} and chart type '${type}'. Consider using 'count' or picking a numeric column.` }
    }
    if ((type === 'scatter' || type === 'bubble') && yNumsAll.length === 0) {
      return { data: null, error: `Y column '${yField}' must be numeric for chart type '${type}'.` }
    }
    if (requiresNumericXForScatter.includes(type) && xNumsAll.length === 0) {
      return { data: null, error: `X column '${xField}' must be numeric for chart type '${type}'.` }
    }
    if (type === 'histogram' && yNumsAll.length === 0) {
      return { data: null, error: `Histogram requires numeric Y values in '${yField}'.` }
    }

    // Decide whether to aggregate. In result-only mode, pass-through when both ops are 'none'
    const usesAggregation = (yAgg !== 'none') || (!!y2Field && y2Agg !== 'none')
    if (!usesAggregation) {
      const rows = previewData.rows.map(r => {
        const xVal = r[xField]
        const yRaw = r[yField]
        const yValNum = toNum(yRaw)
        const out: any = { x: xVal, y: (yValNum !== null ? yValNum : yRaw) }
        if (y2Exists) {
          const y2Raw = r[y2Field!]
          const y2ValNum = toNum(y2Raw)
          out.y2 = (y2ValNum !== null ? y2ValNum : y2Raw)
        }
        return out
      })
      if ((type === 'scatter' || type === 'bubble') && rows.some(r => toNum(r.x) === null)) {
        return { data: null, error: `X values must be numeric for chart type '${type}'.` }
      }
      if (!rows.length) return { data: null, error: 'No data points available.' }
      const columns = [{ name: 'x' }, { name: 'y' }, ...(y2Exists ? [{ name: 'y2' }] : [])]
      return { data: { columns, rows }, error: null }
    }

    // In result-only mode, do not mix raw ('none') with aggregated counterpart.
    if (yAgg === 'none' && y2Exists && y2Agg !== 'none') {
      return { data: null, error: `Cannot combine raw Y with aggregated Y2 in result-only mode. Set both to 'none' or aggregate both.` }
    }
    if (yAgg !== 'none' && y2Exists && y2Agg === 'none') {
      return { data: null, error: `Cannot combine aggregated Y with raw Y2 in result-only mode. Set both to 'none' or aggregate both.` }
    }

    // Aggregation helpers
    type Acc = { sum: number; count: number; min: number; max: number }
    const initAcc = (): Acc => ({ sum: 0, count: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY })
    const up = (acc: Acc, n: number | null) => { if (n === null) return acc; acc.sum += n; acc.count += 1; acc.min = Math.min(acc.min, n); acc.max = Math.max(acc.max, n); return acc }
    type AggOpStrict = 'sum'|'avg'|'count'|'min'|'max'
    const val = (acc: Acc, op: AggOpStrict): number => {
      if (op === 'count') return acc.count
      if (op === 'sum') return acc.sum
      if (op === 'avg') return acc.count ? (acc.sum / acc.count) : 0
      if (op === 'min') return acc.count ? acc.min : 0
      if (op === 'max') return acc.count ? acc.max : 0
      return acc.count ? acc.sum : 0
    }

    // Group rows by X when grouping enabled; else aggregate across all rows
    const groups: Map<string, { y: Acc; y2?: Acc }> = new Map()
    if (groupByEnabled) {
      for (const r of previewData.rows) {
        const gx = String(r[xField])
        const g = groups.get(gx) || { y: initAcc(), y2: y2Exists ? initAcc() : undefined }
        if (yAgg === 'count') {
          const raw = r[yField]
          const present = raw !== null && raw !== undefined && !(typeof raw === 'string' && String(raw).trim().length === 0)
          if (present) g.y.count += 1
        } else {
          g.y = up(g.y, toNum(r[yField]))
        }
        if (y2Exists) {
          if (y2Agg === 'count') {
            const raw2 = r[y2Field!]
            const present2 = raw2 !== null && raw2 !== undefined && !(typeof raw2 === 'string' && String(raw2).trim().length === 0)
            if (present2) g.y2!.count += 1
          } else {
            g.y2 = up(g.y2!, toNum(r[y2Field!]))
          }
        }
        groups.set(gx, g)
      }
    } else {
      const g: { y: Acc; y2?: Acc } = { y: initAcc(), y2: y2Exists ? initAcc() : undefined }
      for (const r of previewData.rows) {
        if (yAgg === 'count') {
          const raw = r[yField]
          const present = raw !== null && raw !== undefined && !(typeof raw === 'string' && String(raw).trim().length === 0)
          if (present) g.y.count += 1
        } else {
          g.y = up(g.y, toNum(r[yField]))
        }
        if (y2Exists) {
          if (y2Agg === 'count') {
            const raw2 = r[y2Field!]
            const present2 = raw2 !== null && raw2 !== undefined && !(typeof raw2 === 'string' && String(raw2).trim().length === 0)
            if (present2) g.y2!.count += 1
          } else {
            g.y2 = up(g.y2!, toNum(r[y2Field!]))
          }
        }
      }
      groups.set('All', g)
    }

    const rows: any[] = []
    for (const [gx, g] of groups.entries()) {
      const row: any = { x: gx, y: val(g.y, yAgg as AggOpStrict) }
      if (y2Exists) row.y2 = val(g.y2!, y2Agg as AggOpStrict)
      rows.push(row)
    }

    const columns = [{ name: 'x' }, { name: 'y' }, ...(y2Exists ? [{ name: 'y2' }] : [])]
    const finalData = { columns, rows }

    const toNumPost = (v: any): number | null => { if (v === null || v === undefined) return null; if (typeof v === 'number') return isFinite(v) ? v : null; if (typeof v === 'string') { const s = v.trim(); if (!s.length) return null; const n = Number(s); return isFinite(n) ? n : null } return null }
    if ((type === 'scatter' || type === 'bubble') && rows.some(r => toNumPost(r.x) === null)) {
      return { data: null, error: `X values must be numeric for chart type '${type}'.` }
    }
    if (!rows.length) return { data: null, error: 'No data points after applying aggregation.' }
    return { data: finalData, error: null }
  }, [previewData, dataOverride, xField, yField, y2Field, yAgg, y2Agg, groupByEnabled, type])

  // Populate from chart when editing
  useEffect(() => {
    if (!isOpen) return
    setError(null)
    if (chart?.id) {
      const cfg = chart.config || {}
      setTitle(chart.title || chart.name || title)
      setType((chart.type as ChartType) || type)
      setTable(cfg.table || table)
      setXField(cfg.xField || xField)
      setYField(cfg.yField || yField)
      setYAgg(cfg.yAgg || yAgg)
      setY2Field(cfg.y2Field || '')
      setY2Agg(cfg.y2Agg || 'none')
      setSelection(cfg.selection || '')
      setOrderBy(cfg.orderBy || '')
      setOrderDir((cfg.orderDir as 'ASC'|'DESC') || 'ASC')
      setLimit(cfg.limit ?? 50)
      setGroupByEnabled(cfg.groupByEnabled ?? true)
      setPalette(cfg.palette || palette)
      setShowLegend(cfg.showLegend ?? showLegend)
      setShowGrid(cfg.showGrid ?? showGrid)
      setSmooth(cfg.smooth ?? smooth)
      setArea(cfg.area ?? area)
      setStack(cfg.stack ?? stack)
      setLineWidth(cfg.lineWidth ?? lineWidth)
      setAreaOpacity(cfg.areaOpacity ?? areaOpacity)
      setBarWidth(cfg.barWidth ?? barWidth)
      setBorderRadius(cfg.borderRadius ?? borderRadius)
      setTooltip(cfg.tooltip ?? tooltip)
      setAnimation(cfg.animation ?? animation)
      setXTickRotate(cfg.xTickRotate ?? xTickRotate)
      setYFormat(cfg.yFormat ?? yFormat)
      const pos = chart.position || { w: 6, h: 6 }
      setWidth(pos.w || 6)
      setHeight(pos.h || 6)
    } else {
      // defaults for new
      setTitle(initialTitle || 'New Chart')
      setType(lockType || initialType || 'line')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, chart])

  // Load tables when modal opens (mirror SQL Runner)
  useEffect(() => {
    if (!isOpen) return
    ;(async () => {
      try {
        await ensureApiBase()
        const res = await fetch(`${API_BASE}/data/tables`)
        if (!res.ok) return
        const data: any = await res.json()
        const raw = ((data?.tables || []) as any[])
        const items: string[] = raw
          .map((t: any) => String(t?.TABLE_NAME ?? t?.name ?? ''))
          .filter((s: string) => s.length > 0)
        const uniq: string[] = Array.from(new Set<string>(items))
        setTables(uniq as string[])
      } catch (e: any) {
        setError(e?.message || 'Failed to load tables')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Discover columns from table via API (prefer override from SQL Runner)
  useEffect(() => {
    if (columnsOverride && columnsOverride.length) {
      setColumns(Array.from(new Set(columnsOverride.filter(Boolean))))
      return
    }
    if (!table) { setColumns([]); return }
    ;(async () => {
      try {
        await ensureApiBase()
        const res = await fetch(`${API_BASE}/data/tables/${encodeURIComponent(table)}/columns`)
        if (!res.ok) throw new Error(await res.text())
        const data: any = await res.json()
        const raw: any[] = Array.isArray(data) ? data : (data?.columns || data?.meta || [])
        const cols: string[] = raw
          .map((c: any) => String(c?.COLUMN_NAME ?? c?.column_name ?? c?.name ?? c?.column ?? c ?? ''))
          .filter((s: string) => s.length > 0)
        const uniq: string[] = Array.from(new Set<string>(cols))
        setColumns(uniq)
      } catch (e: any) {
        setColumns([])
        setError(e?.message || `Failed to load columns for table ${table}`)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, columnsOverride])

  // Use provided result data from SQL Runner to show immediate preview (no table required)
  useEffect(() => {
    if (!isOpen) return
    if (!dataOverride) return
    const cols = (dataOverride.columns || []).map((c: any) => typeof c === 'string' ? { name: c } : c)
    if (cols.length && Array.isArray(dataOverride.rows)) {
      setPreviewData({ columns: cols, rows: dataOverride.rows })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dataOverride])

  // Generated SQL from Data + Transform
  const generatedSQL = useMemo(() => {
    if (!table || !xField || !yField) return ''
    const selParts: string[] = []
    const aggExpr = yAgg === 'none'
      ? `${yField} AS y`
      : `${yAgg.toUpperCase()}(${yField}) AS y`
    const y2Expr = y2Field
      ? `, ${y2Agg === 'none' ? `${y2Field} AS y2` : `${y2Agg.toUpperCase()}(${y2Field}) AS y2`}`
      : ''
    const base = `SELECT ${xField} AS x, ${aggExpr}${y2Expr} FROM ${table}`
    if (selection?.trim()) selParts.push(selection.trim())
    const where = selParts.length ? ` WHERE ${selParts.join(' AND ')}` : ''
    const groupFields: string[] = []
    if (groupByEnabled) {
      groupFields.push(xField)
    }
    if (groupByY1Enabled || (groupByEnabled && yAgg === 'none')) {
      groupFields.push(yField)
    }
    if (groupByEnabled && y2Field && y2Agg === 'none') {
      groupFields.push(y2Field)
    }
    const groupBy = groupFields.length ? ` GROUP BY ${Array.from(new Set(groupFields)).filter(Boolean).join(', ')}` : ''
    const order = orderBy ? ` ORDER BY ${orderBy} ${String(orderDir).toUpperCase()}` : ''
    const lim = limit && limit > 0 ? ` FETCH FIRST ${limit} ROWS ONLY` : ''
    return `${base}${where}${groupBy}${order}${lim}`
  }, [table, xField, yField, yAgg, y2Field, y2Agg, selection, groupByEnabled, groupByY1Enabled, orderBy, orderDir, limit])

  // Auto-title generation (only when user hasn't edited title and default title remains)
  useEffect(() => {
    if (!isOpen) return
    if (titleEdited) return
    const defaultTitle = initialTitle || 'New Chart'
    const isDefault = title === defaultTitle
    if (!isDefault) return
    const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
    const aggLabel = (op: 'none'|'sum'|'avg'|'count'|'min'|'max'): string => {
      if (!op || op === 'none') return ''
      const map: Record<string,string> = { sum: 'Sum', avg: 'Average', count: 'Count', min: 'Min', max: 'Max' }
      return map[op] || cap(op)
    }
    const measures: string[] = []
    if (yField) {
      const yl = aggLabel(yAgg)
      measures.push(`${yl ? yl + ' of ' : ''}${yField}`)
    }
    if (y2Field) {
      const y2l = aggLabel(y2Agg)
      measures.push(`${y2l ? y2l + ' of ' : ''}${y2Field}`)
    }
    const measurePart = measures.join(' and ')
    const byPart = xField ? ` by ${xField}` : ''
    const typeLabel = cap(type)
    const auto = measurePart ? `${typeLabel ? typeLabel + ': ' : ''}${measurePart}${byPart}` : defaultTitle
    setTitle(auto)
  }, [isOpen, titleEdited, title, initialTitle, xField, yField, yAgg, y2Field, y2Agg, type])

  // Visual config passed to renderer
  const renderConfig = useMemo(() => ({
    xField,
    yField,
    y2Field: y2Field || undefined,
    yAgg,
    y2Agg,
    palette,
    primaryColor,
    showLegend,
    showGrid,
    smooth,
    area,
    stack,
    lineWidth,
    areaOpacity,
    barWidth,
    borderRadius,
    tooltip,
    animation,
    xTickRotate,
    yFormat,
  }), [xField, yField, y2Field, yAgg, y2Agg, palette, primaryColor, showLegend, showGrid, smooth, area, stack, lineWidth, areaOpacity, barWidth, borderRadius, tooltip, animation, xTickRotate, yFormat])

  const runPreview = async () => {
    if (!generatedSQL) return
    setPreviewLoading(true); setError(null)
    setActivePreviewMode(liveMode ? 'live' : 'static')
    try {
      await ensureApiBase()
      const endpoint = liveMode ? '/query/execute' : '/query/preview'
      // Use partial fetch mode (full=false) to respect any FETCH FIRST limits for fast previews
      const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: generatedSQL, full: false }) })
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      const colsRaw = json.columns || json.meta || []
      const columns = Array.isArray(colsRaw)
        ? colsRaw.map((c: any) => ({ name: (typeof c === 'string' ? c : (c.name || c.column || c)).toString() }))
        : []
      const rows = json.rows || json.data || []
      setPreviewData({ columns, rows })
    } catch (e: any) {
      setPreviewData(null)
      setError(liveMode ? (e?.message || 'Live query failed') : (e?.message || 'Preview failed'))
    } finally {
      setPreviewLoading(false)
      setActivePreviewMode(null)
    }
  }

  // Auto-preview on changes (debounced) for real-time updates
  // Run only when SQL or mode changes; do not depend on loading to avoid loops
  useEffect(() => {
    if (!isOpen) return
    if (!!dataOverride) return // when using provided data, do not auto-run backend preview
    if (!generatedSQL) return
    if (!liveMode) return
    if (previewLoading) return
    const id = setTimeout(() => { runPreview() }, 350)
    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedSQL, isOpen, liveMode])

  const canSave = !disableSave && !!activeDashboardId && (!!generatedSQL || !!initialSql) && title.trim().length > 1 && (!!initialSql || (!!xField && !!yField))

  const onSave = async () => {
    if (!canSave) return
    setSaving(true); setError(null)
    try {
      const body = {
        type,
        name: title,
        config: {
          table, xField, yField, yAgg, y2Field, y2Agg,
          // Map aggregators to backend expectations
          aggregator: yAgg ? yAgg.toUpperCase() : undefined,
          aggregator2: y2Field ? (y2Agg ? y2Agg.toUpperCase() : undefined) : undefined,
          // Map sort to backend format (value vs category)
          sort: { by: (orderBy && (orderBy === yField || orderBy.toLowerCase() === 'y')) ? 'value' : 'category', direction: String(orderDir).toLowerCase() },
          selection, orderBy, orderDir, limit,
          groupBy: [
            ...(groupByEnabled ? [xField] : []),
            ...(groupByY1Enabled ? [yField] : []),
            ...((groupByEnabled && y2Field && y2Agg === 'none') ? [y2Field] : []),
          ].filter(Boolean),
          sqlQuery: (initialSql && initialSql.trim().length > 0) ? initialSql : (generatedSQL || ''),
          palette, primaryColor, showLegend, showGrid, smooth, area, stack,
          lineWidth, areaOpacity, barWidth, borderRadius, tooltip, animation,
          xTickRotate, yFormat,
        },
        position: { x: 0, y: 0, w: width, h: height },
      }
      await ensureApiBase()
      const url = chart?.id
        ? `${API_BASE}/dashboards/${activeDashboardId}/charts/${chart.id}`
        : `${API_BASE}/dashboards/${activeDashboardId}/charts`
      const method = chart?.id ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(await res.text())
      await loadDashboards()
      try {
        const payload = await res.json().catch(() => null)
        const chartId = (payload?.chart?.id) || (chart?.id)
        window.dispatchEvent(new CustomEvent(chartId ? 'chart-saved' : 'refresh-all-charts', { detail: chartId ? { chartId } : undefined }))
      } catch {}
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to save chart')
    } finally {
      setSaving(false)
    }
  }

  const typeLocked = !!lockType

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={chart?.id ? 'Edit Chart' : 'Add Chart'} width={760} minWidth={720} minHeight={560}>
      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <input className="glass p-1 rounded-md w-2/3 text-sm h-8" value={title} onChange={e => { setTitle(e.target.value); setTitleEdited(true) }} placeholder="Chart title" />
          <div className="flex gap-2">
            <input type="number" min={3} max={12} className="glass p-1 rounded-md w-20 text-xs h-8" value={width} onChange={e => setWidth(Number(e.target.value))} />
            <input type="number" min={3} max={12} className="glass p-1 rounded-md w-20 text-xs h-8" value={height} onChange={e => setHeight(Number(e.target.value))} />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {TABS.map(t => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {/* Panels */}
        {tab === 'Data' && (
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <div className="text-sm text-white/80">Table</div>
              <select className="glass p-1 rounded-md w-full text-xs h-8" value={table} onChange={e => setTable(e.target.value)} disabled={!!lockTable}>
                <option value="">{tables.length ? 'Select a table…' : 'Loading tables…'}</option>
                {tables.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 col-span-2">
              <button className="btn px-2 py-1 text-xs" onClick={() => { const xx = xField; const yy = yField; setXField(yy); setYField(xx); }}>Swap X/Y</button>
              <button className="btn px-2 py-1 text-xs" onClick={() => setLimit(10)}>Top 10</button>
              <button className="btn px-2 py-1 text-xs" onClick={() => { if (xField) setOrderBy(xField); setOrderDir('ASC'); }}>Auto Order</button>
              <button className="btn px-2 py-1 text-xs" onClick={() => setSelection('')}>Clear Filters</button>
            </div>
            <div className="grid grid-cols-2 gap-2 col-span-2">
              <label className="block">
                <div className="text-sm text-white/80">X</div>
                <select className="glass p-1 rounded-md w-full text-xs h-8" value={xField} onChange={e => setXField(e.target.value)} disabled={!columns.length}>
                  <option value="">{columns.length ? 'Select…' : '—'}</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="block">
                <div className="text-sm text-white/80">Y (measure)</div>
                <div className="flex gap-2">
                  <select className="glass p-1 rounded-md w-full text-xs h-8" value={yField} onChange={e => setYField(e.target.value)} disabled={!columns.length}>
                    <option value="">{columns.length ? 'Select…' : '—'}</option>
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select className="glass p-1 rounded-md w-24 text-xs h-8" value={yAgg} onChange={e => setYAgg(e.target.value as any)}>
                    <option value="none">none</option>
                    <option value="sum">sum</option>
                    <option value="avg">avg</option>
                    <option value="count">count</option>
                    <option value="min">min</option>
                    <option value="max">max</option>
                  </select>
                </div>
              </label>
            </div>
            <label className="block col-span-2">
              <div className="text-sm text-white/80">Selection (filters)</div>
              <input className="glass p-1 rounded-md w-full text-xs" value={selection} onChange={e => setSelection(e.target.value)} placeholder="e.g. status = 'COMPLETED' AND region = 'EU'" />
            </label>
          </div>
        )}

        {tab === 'Transform' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <div className="text-sm text-white/80">Y2 (optional)</div>
              <div className="flex gap-2">
                <select className="glass p-1 rounded-md w-full text-xs h-8" value={y2Field} onChange={e => setY2Field(e.target.value)}>
                  <option value="">—</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="glass p-1 rounded-md w-24 text-xs h-8" value={y2Agg} onChange={e => setY2Agg(e.target.value as any)}>
                  <option value="none">none</option>
                  <option value="sum">sum</option>
                  <option value="avg">avg</option>
                  <option value="count">count</option>
                  <option value="min">min</option>
                  <option value="max">max</option>
                </select>
              </div>
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Order By</div>
              <div className="flex gap-2">
                <select className="glass p-1 rounded-md w-full text-xs h-8" value={orderBy} onChange={e => setOrderBy(e.target.value)}>
                  <option value="">—</option>
                  {[xField, yField, y2Field].filter(Boolean).map(c => <option key={c!} value={c!}>{c}</option>)}
                </select>
                <select className="glass p-1 rounded-md w-24 text-xs h-8" value={orderDir} onChange={e => setOrderDir(e.target.value as any)}>
                  <option value="ASC">ASC</option>
                  <option value="DESC">DESC</option>
                </select>
              </div>
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Limit (rows)</div>
              <input type="number" min={0} max={1000000} className="glass p-1 rounded-md w-full text-xs h-8" value={limit} onChange={e => setLimit(Number(e.target.value))} placeholder="0 = all" />
            </label>
            <div className="flex items-center gap-3">
              <input id="groupX" type="checkbox" checked={groupByEnabled} onChange={e => setGroupByEnabled(e.target.checked)} />
              <label htmlFor="groupX" className="text-sm text-white/80">Group By X</label>
            </div>
            <div className="flex items-center gap-3">
              <input id="groupY1" type="checkbox" checked={groupByY1Enabled} onChange={e => setGroupByY1Enabled(e.target.checked)} />
              <label htmlFor="groupY1" className="text-sm text-white/80">Group By Y1</label>
            </div>
          </div>
        )}

        {tab === 'Visual' && (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-wrap gap-2 col-span-2">
              <button className="btn px-2 py-1 text-xs" onClick={() => { setShowLegend(true); setShowGrid(true); setSmooth(false); setArea(false); setStack(false); setLineWidth(2); setAreaOpacity(0.4); setBarWidth(0.8); setBorderRadius(4); setTooltip(true); setAnimation(true); setXTickRotate(0); setYFormat('0,0'); }}>Reset Visual</button>
            </div>
            <label className="block">
              <div className="text-sm text-white/80">Type {typeLocked ? '(locked)' : ''}</div>
              <select className="glass p-1 rounded-md w-full text-xs h-8" value={type} onChange={e => !typeLocked && setType(e.target.value as ChartType)} disabled={typeLocked}>
                {['line','area','bar','column','stackedBar','stackedArea','pie','donut','scatter','bubble','histogram','heatmap','radar','treemap','gauge','number','candlestick','table'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Palette</div>
              <select className="glass p-1 rounded-md w-full text-xs h-8" value={palette} onChange={e => setPalette(e.target.value)}>
                <option value="default">default</option>
                <option value="cool">cool</option>
                <option value="warm">warm</option>
                <option value="neon">neon</option>
              </select>
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Color</div>
              <input type="color" className="w-8 h-8 p-0 bg-transparent" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} />
            </label>
            <div className="flex items-center gap-3">
              <input id="legend" type="checkbox" checked={showLegend} onChange={e => setShowLegend(e.target.checked)} />
              <label htmlFor="legend" className="text-sm text-white/80">Show Legend</label>
            </div>
            <div className="flex items-center gap-3">
              <input id="grid" type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
              <label htmlFor="grid" className="text-sm text-white/80">Show Grid</label>
            </div>
            <div className="flex items-center gap-3">
              <input id="smooth" type="checkbox" checked={smooth} onChange={e => setSmooth(e.target.checked)} />
              <label htmlFor="smooth" className="text-sm text-white/80">Smooth Lines</label>
            </div>
            <div className="flex items-center gap-3">
              <input id="area" type="checkbox" checked={area} onChange={e => setArea(e.target.checked)} />
              <label htmlFor="area" className="text-sm text-white/80">Fill Area</label>
            </div>
            <div className="flex items-center gap-3">
              <input id="stack" type="checkbox" checked={stack} onChange={e => setStack(e.target.checked)} />
              <label htmlFor="stack" className="text-sm text-white/80">Stack Series</label>
            </div>
            <label className="block">
              <div className="text-sm text-white/80">Line Width</div>
              <input type="number" min={1} max={10} className="glass p-1 rounded-md w-full text-xs h-8" value={lineWidth} onChange={e => setLineWidth(Number(e.target.value))} />
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Area Opacity</div>
              <input type="number" min={0} max={1} step={0.05} className="glass p-1 rounded-md w-full text-xs h-8" value={areaOpacity} onChange={e => setAreaOpacity(Number(e.target.value))} />
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Bar Width</div>
              <input type="number" min={0.2} max={1.2} step={0.1} className="glass p-1 rounded-md w-full text-xs h-8" value={barWidth} onChange={e => setBarWidth(Number(e.target.value))} />
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Border Radius</div>
              <input type="number" min={0} max={16} className="glass p-1 rounded-md w-full text-xs h-8" value={borderRadius} onChange={e => setBorderRadius(Number(e.target.value))} />
            </label>
            <div className="flex items-center gap-3">
              <input id="tooltip" type="checkbox" checked={tooltip} onChange={e => setTooltip(e.target.checked)} />
              <label htmlFor="tooltip" className="text-sm text-white/80">Tooltip</label>
            </div>
            <div className="flex items-center gap-3">
              <input id="animation" type="checkbox" checked={animation} onChange={e => setAnimation(e.target.checked)} />
              <label htmlFor="animation" className="text-sm text-white/80">Animation</label>
            </div>
            <label className="block">
              <div className="text-sm text-white/80">X Tick Rotate</div>
              <input type="number" min={-90} max={90} className="glass p-2 rounded-md w-full" value={xTickRotate} onChange={e => setXTickRotate(Number(e.target.value))} />
            </label>
            <label className="block">
              <div className="text-sm text-white/80">Y Axis Format</div>
              <input className="glass p-2 rounded-md w-full" value={yFormat} onChange={e => setYFormat(e.target.value)} placeholder="e.g. 0,0.00" />
            </label>
          </div>
        )}

        {/* Preview */}
        <div className="mt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-sm text-white/80">Preview</div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={liveMode} onChange={e => setLiveMode(e.target.checked)} disabled={previewLoading} />
                <span>{liveMode ? 'Live' : 'Static'}</span>
              </label>
            </div>
            <button className="btn w-28" disabled={!generatedSQL || previewLoading || !!dataOverride || !xField || !yField} onClick={runPreview}>
              {previewLoading ? (activePreviewMode === 'live' ? 'Running…' : 'Previewing…') : (liveMode ? 'Run Live' : 'Run Preview')}
            </button>
          </div>
          <div className="glass rounded-md p-3 mt-1">
            {derivedPreview.data && xField && yField ? (
              <ChartRenderer
                title={title || 'Preview'}
                type={type}
                config={renderConfig}
                data={derivedPreview.data || undefined}
                loading={previewLoading}
                error={derivedPreview.error || error || undefined}
              />
            ) : (
              <div className="text-white/70 text-sm">Select X and Y columns to see the chart preview.</div>
            )}
          </div>
        </div>

        {(derivedPreview.error || error) && <div className="text-red-400 text-sm px-1">{derivedPreview.error || error}</div>}

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-2 border-t border-white/10">
          <button className="btn" onClick={onClose}>Close</button>
          {!disableSave && (
            <button className="btn" disabled={!canSave || saving} onClick={onSave}>{saving ? 'Saving…' : (chart?.id ? 'Save' : 'Add to Dashboard')}</button>
          )}
        </div>
      </div>
    </Modal>
  )
}
