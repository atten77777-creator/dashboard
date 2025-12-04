import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext'
import { ChartRenderer } from './ChartRenderer'
import ChartBuilderModal from './ChartBuilderModal'
import LineChartBuilder from './builders/LineChartBuilder'
import BarChartBuilder from './builders/BarChartBuilder'
import ColumnChartBuilder from './builders/ColumnChartBuilder'
import AreaChartBuilder from './builders/AreaChartBuilder'
import StackedBarChartBuilder from './builders/StackedBarChartBuilder'
import StackedAreaChartBuilder from './builders/StackedAreaChartBuilder'
import PieChartBuilder from './builders/PieChartBuilder'
import DonutChartBuilder from './builders/DonutChartBuilder'
import FunnelChartBuilder from './builders/FunnelChartBuilder'
import ScatterChartBuilder from './builders/ScatterChartBuilder'
import HeatmapChartBuilder from './builders/HeatmapChartBuilder'
import RadarChartBuilder from './builders/RadarChartBuilder'
import TreemapChartBuilder from './builders/TreemapChartBuilder'
import GaugeChartBuilder from './builders/GaugeChartBuilder'
import NumberChartBuilder from './builders/NumberChartBuilder'
import CandlestickChartBuilder from './builders/CandlestickChartBuilder'
import HistogramChartBuilder from './builders/HistogramChartBuilder'
import TableChartBuilder from './builders/TableChartBuilder'
import RGL, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { API_BASE, ensureApiBase } from '../api'
import { Modal } from './Modal'
import SQLEditModal from './SQLEditModal'

// Define ChartType locally to avoid dependency on placeholder module
export type ChartType =
  | 'line' | 'bar' | 'column' | 'area' | 'stackedBar' | 'stackedArea'
  | 'pie' | 'donut' | 'funnel' | 'scatter' | 'heatmap' | 'radar' | 'treemap'
  | 'gauge' | 'number' | 'candlestick' | 'histogram' | 'table'

type ColumnMeta = { name: string; type?: string }
type QueryResult = { columns: ColumnMeta[]; rows: any[] }

const ReactGridLayout = WidthProvider(RGL as any)
type RGLLayout = { i: string; x: number; y: number; w: number; h: number }

export function ChartContainer() {
  const { dashboards, activeDashboardId, loadDashboards } = useApp()
  const dashboard = useMemo(() => dashboards.find(d => d.id === activeDashboardId), [dashboards, activeDashboardId])

  const [chartData, setChartData] = useState<Record<string, QueryResult | undefined>>({})
  const [chartLoading, setChartLoading] = useState<Record<string, boolean>>({})
  const [chartError, setChartError] = useState<Record<string, string | undefined>>({})
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editChart, setEditChart] = useState<any | null>(null)
  const [sqlEditOpen, setSqlEditOpen] = useState(false)
  const [sqlEditChart, setSqlEditChart] = useState<any | null>(null)
  const [sqlEditSQL, setSqlEditSQL] = useState<string>('')
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [confirmDeleteChart, setConfirmDeleteChart] = useState<any | null>(null)
  const [deletingChart, setDeletingChart] = useState(false)
  const [initialTitle, setInitialTitle] = useState<string | undefined>(undefined)
  const [initialType, setInitialType] = useState<ChartType | undefined>(undefined)
  const [initialFields, setInitialFields] = useState<{ x?: string; y?: string; y2?: string } | undefined>(undefined)
  const [columnsOverride, setColumnsOverride] = useState<string[] | undefined>(undefined)
  const [dataOverride, setDataOverride] = useState<{ columns: (string | { name: string })[]; rows: any[] } | undefined>(undefined)
  const saveTimer = useRef<any>(null)
  const dashboardRef = useRef<any | null>(null)
  const dashboardIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    dashboardRef.current = dashboard || null
    dashboardIdRef.current = dashboard?.id
  }, [dashboard])

  useEffect(() => {
    // clear state when dashboard changes
    setChartData({})
    setChartLoading({})
    setChartError({})
    if (dashboard?.charts?.length) {
      // auto-load for small number of charts
      dashboard.charts.forEach((c) => fetchChartData(c.id))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.id])

  useEffect(() => {
    const handler = (e: any) => {
      const detail = e?.detail || {}
      setEditChart(null)
      setInitialTitle(detail.title)
      setInitialType(detail.type as ChartType)
      setInitialFields(detail.fields)
      setColumnsOverride(detail.columnsOverride)
      setDataOverride(detail.dataOverride)
      setIsAddOpen(true)
    }
    window.addEventListener('open-chart-modal', handler)
    const refreshAll = () => {
      const d = dashboardRef.current
      if (!d?.charts?.length) return
      d.charts.forEach((c: any) => fetchChartData(c.id))
    }
    window.addEventListener('refresh-all-charts', refreshAll)
    const onChartSaved = (e: any) => {
      const id = e?.detail?.chartId
      if (id) fetchChartData(id)
    }
    window.addEventListener('chart-saved', onChartSaved)
    return () => {
      window.removeEventListener('open-chart-modal', handler)
      window.removeEventListener('refresh-all-charts', refreshAll)
      window.removeEventListener('chart-saved', onChartSaved)
    }
  }, [])

  const fetchChartData = async (chartId: string) => {
    const dashId = dashboardIdRef.current || dashboard?.id
    if (!dashId) return
    setChartLoading(prev => ({ ...prev, [chartId]: true }))
    setChartError(prev => ({ ...prev, [chartId]: undefined }))
    try {
      await ensureApiBase()
      const res = await fetch(`${API_BASE}/dashboards/${dashId}/charts/${chartId}/data`)
      const json = await res.json()
      const colsRaw = json.columns || json.meta || []
      const cols: ColumnMeta[] = Array.isArray(colsRaw)
        ? colsRaw.map((c: any) => (typeof c === 'string' ? { name: c } : c))
        : []
      const data: QueryResult = { columns: cols, rows: json.rows || json.data || [] }
      setChartData(prev => ({ ...prev, [chartId]: data }))
    } catch (e: any) {
      setChartError(prev => ({ ...prev, [chartId]: e?.message || 'Failed to load data' }))
    } finally {
      setChartLoading(prev => ({ ...prev, [chartId]: false }))
    }
  }

  const buildSqlFromConfig = (cfg: any): string => {
    try {
      const table = cfg?.table || 'your_table'
      const x = cfg?.xField || 'x'
      const y = cfg?.yField || 'y'
      const yAgg = (cfg?.aggregator || cfg?.yAgg || 'sum') as string
      const yExpr = yAgg && yAgg.toLowerCase() !== 'none' ? `${yAgg}(${y})` : y
      const y2 = cfg?.y2Field
      const y2Agg = (cfg?.aggregator2 || cfg?.y2Agg || 'none') as string
      const y2Expr = y2 ? (y2Agg && y2Agg.toLowerCase() !== 'none' ? `${y2Agg}(${y2})` : y2) : null
      const selectParts = [ `${x} as x`, `${yExpr} as y` ]
      if (y2Expr) selectParts.push(`${y2Expr} as y2`)
      let sql = `SELECT ${selectParts.join(', ')}\nFROM ${table}`
      if (cfg?.selection) sql += `\nWHERE ${cfg.selection}`
      if (cfg?.groupByEnabled) sql += `\nGROUP BY ${x}`
      if (cfg?.orderBy) sql += `\nORDER BY ${cfg.orderBy} ${String(cfg?.orderDir || 'ASC').toUpperCase()}`
      // Use Oracle-compatible fetch syntax to align with server execution
      if (cfg?.limit) sql += `\nFETCH FIRST ${cfg.limit} ROWS ONLY`
      return sql
    } catch {
      return '/* No SQL available for this chart. Provide one below. */\nSELECT x, y FROM your_table';
    }
  }

  const onDeleteChart = async (chartId: string) => {
    try {
      await ensureApiBase()
      const res = await fetch(`${API_BASE}/dashboards/${dashboard!.id}/charts/${chartId}`, { method: 'DELETE' })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg || 'Failed to delete chart')
      }
      await loadDashboards()
      setChartData(prev => ({ ...prev, [chartId]: undefined }))
      setChartLoading(prev => ({ ...prev, [chartId]: false }))
      setChartError(prev => ({ ...prev, [chartId]: undefined }))
    } catch (e) {
      // surface error in UI by setting chartError
      setChartError(prev => ({ ...prev, [chartId]: (e as any)?.message || 'Delete failed' }))
    }
  }

  const saveLayout = (layout: RGLLayout[]) => {
    if (!dashboard) return
    if (saveTimer.current) { clearTimeout(saveTimer.current) }
    saveTimer.current = setTimeout(async () => {
      try {
        await ensureApiBase()
        await Promise.all(layout.map(async (it) => {
          const chart = dashboard.charts.find((c: any) => c.id === it.i)
          if (!chart) return
          const body = {
            name: (chart as any).name,
            config: chart.config,
            position: { x: it.x, y: it.y, w: it.w, h: it.h },
          }
          await fetch(`${API_BASE}/dashboards/${dashboard.id}/charts/${chart.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          })
        }))
        await loadDashboards()
      } catch { /* ignore */ }
    }, 300)
  }

  useEffect(() => {
    if (!dashboard?.charts?.length) return
    // fetch data for charts without entries (newly added)
    dashboard.charts.forEach((c: any) => {
      if (!chartData[c.id]) {
        fetchChartData(c.id)
      }
    })
    // only watch length to catch additions; avoids refetch on data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard?.charts?.length])

  if (!dashboard) {
    return (
      <div className="glass rounded-xl p-6 mt-6">
        <div className="text-white/80">Select a dashboard from the sidebar to view charts.</div>
      </div>
    )
  }

  return (
    <div className="mt-2">

      {!dashboard.charts?.length && (
        <div className="glass rounded-xl p-6">
          <div className="text-white/80">No charts yet. Use "Add Chart" in the header.</div>
        </div>
      )}

      {dashboard.charts?.length > 0 && (
        <ReactGridLayout
          className="layout"
          cols={12}
          rowHeight={30}
          margin={[16, 16]}
          containerPadding={[0, 0]}
          compactType={null}
          preventCollision
          isDraggable
          isResizable
          draggableCancel=".btn,.btn-icon,button,input,select"
          layout={(dashboard?.charts || []).map((c: any) => ({
            i: c.id,
            x: Math.max(0, Math.min(11, (c.position?.x ?? 0))),
            y: Math.max(0, (c.position?.y ?? 0)),
            w: Math.max(4, Math.min(12, (c.position?.w ?? 6))),
            h: Math.max(6, Math.min(12, (c.position?.h ?? 6))),
          }))}
          onDragStop={(l: RGLLayout[]) => saveLayout(l as any)}
          onResizeStop={(l: RGLLayout[]) => saveLayout(l as any)}
        >
          {dashboard.charts.map((c: any) => (
            <div key={c.id}>
              <ChartRenderer
                title={(c as any).title ?? (c as any).name}
                type={c.type}
                config={(c as any).config}
                data={chartData[c.id]}
                loading={chartLoading[c.id]}
                error={chartError[c.id]}
                responsive={true}
                onRefresh={() => fetchChartData(c.id)}
                onEdit={() => { setEditChart(c); setIsAddOpen(true) }}
                onEditSQL={() => {
                  setSqlEditChart(c);
                  const cfg = (c as any).config || {}
                  const sql = cfg?.sqlQuery || buildSqlFromConfig(cfg)
                  setSqlEditSQL(String(sql || ''))
                  setSqlEditOpen(true)
                }}
                onDelete={() => { setConfirmDeleteChart(c); setConfirmDeleteOpen(true) }}
              />
            </div>
          ))}
        </ReactGridLayout>
      )}

      {isAddOpen && (
        <>
          {editChart ? (
            <ChartBuilderModal
              isOpen={isAddOpen}
              onClose={() => { setIsAddOpen(false); setEditChart(null); setInitialTitle(undefined); setInitialType(undefined) }}
              chart={editChart}
              initialTitle={initialTitle}
              initialFields={initialFields}
              columnsOverride={columnsOverride}
              dataOverride={dataOverride}
            />
          ) : initialType === 'line' ? (
            <LineChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'bar' ? (
            <BarChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'column' ? (
            <ColumnChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'area' ? (
            <AreaChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'stackedBar' ? (
            <StackedBarChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'stackedArea' ? (
            <StackedAreaChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'pie' ? (
            <PieChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'donut' ? (
            <DonutChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'funnel' ? (
            <FunnelChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'scatter' ? (
            <ScatterChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'heatmap' ? (
            <HeatmapChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'radar' ? (
            <RadarChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'treemap' ? (
            <TreemapChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'gauge' ? (
            <GaugeChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'number' ? (
            <NumberChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'candlestick' ? (
            <CandlestickChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'histogram' ? (
            <HistogramChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : initialType === 'table' ? (
            <TableChartBuilder isOpen={isAddOpen} onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }} chart={undefined} initialTitle={initialTitle} initialFields={initialFields} columnsOverride={columnsOverride} dataOverride={dataOverride} />
          ) : (
            <ChartBuilderModal
              isOpen={isAddOpen}
              onClose={() => { setIsAddOpen(false); setInitialTitle(undefined); setInitialType(undefined) }}
              chart={undefined}
              initialTitle={initialTitle}
              initialFields={initialFields}
              columnsOverride={columnsOverride}
              dataOverride={dataOverride}
            />
          )}
        </>
      )}

      {sqlEditOpen && sqlEditChart && (
        <SQLEditModal
          isOpen={sqlEditOpen}
          sql={sqlEditSQL}
          chartTitle={(sqlEditChart as any).title ?? (sqlEditChart as any).name}
          onClose={() => { setSqlEditOpen(false); setSqlEditChart(null); setSqlEditSQL('') }}
          onSave={async (newSQL: string) => {
            try {
              await ensureApiBase()
              const c = sqlEditChart!
              // Remove any cached dataOverride so the server executes the new SQL
              const currentCfg = (c as any).config || {}
              const { dataOverride: _dropOverride, ...cfgNoOverride } = currentCfg
              const body = {
                name: (c as any).name,
                config: { ...cfgNoOverride, sqlQuery: newSQL },
                position: (c as any).position || { x: 0, y: 0, w: 6, h: 6 },
              }
              const res = await fetch(`${API_BASE}/dashboards/${dashboard!.id}/charts/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
              if (!res.ok) throw new Error(await res.text())
              await loadDashboards()
              // Clear any cached data for this chart before refetch to avoid stale display
              setChartData(prev => ({ ...prev, [c.id]: undefined }))
              setChartError(prev => ({ ...prev, [c.id]: undefined }))
              await fetchChartData(c.id)
              setSqlEditOpen(false); setSqlEditChart(null); setSqlEditSQL('')
            } catch (e: any) {
              // surface error
              setChartError(prev => ({ ...prev, [sqlEditChart!.id]: e?.message || 'Failed to update SQL' }))
            }
          }}
        />
      )}

      {confirmDeleteOpen && confirmDeleteChart && (
        <Modal isOpen={confirmDeleteOpen} onClose={() => { setConfirmDeleteOpen(false); setConfirmDeleteChart(null) }} title="Confirm Delete" width={420}>
          <div className="space-y-4">
            <div className="text-white/80">Delete chart "{(confirmDeleteChart as any).title ?? (confirmDeleteChart as any).name}"? This cannot be undone.</div>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => { setConfirmDeleteOpen(false); setConfirmDeleteChart(null) }} disabled={deletingChart}>Cancel</button>
              <button className="btn bg-red-600 hover:bg-red-700" onClick={async () => {
                const chartId = confirmDeleteChart?.id
                if (!chartId || !dashboard) return
                setDeletingChart(true)
                try {
                  await onDeleteChart(chartId)
                  setConfirmDeleteOpen(false)
                  setConfirmDeleteChart(null)
                } finally {
                  setDeletingChart(false)
                }
              }} disabled={deletingChart}>{deletingChart ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}