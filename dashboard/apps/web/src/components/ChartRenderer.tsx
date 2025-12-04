import React, { useMemo, useEffect, useLayoutEffect, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import '../styles/echarts-theme'
import { FiEdit2, FiTrash2, FiRefreshCw, FiDownload, FiImage, FiGrid, FiMaximize, FiList, FiZoomIn } from 'react-icons/fi'

type ColumnMeta = { name: string; type?: string }
type QueryResult = { columns: ColumnMeta[]; rows: any[] }

// Define a typed config for visual options used in this renderer
interface ChartConfig {
  // Field mapping (optional)
  xField?: string
  yField?: string
  y2Field?: string
  yAgg?: 'none'|'sum'|'avg'|'count'|'min'|'max'
  y2Agg?: 'none'|'sum'|'avg'|'count'|'min'|'max'
  palette?: string
  paletteInvert?: boolean
  primaryColor?: string
  showLegend?: boolean
  showGrid?: boolean
  smooth?: boolean
  area?: boolean
  stack?: boolean
  bins?: number
  labelOn?: boolean
  xRotate?: number
  // New settings
  legendPosition?: 'top' | 'bottom' | 'left' | 'right'
  dataZoom?: boolean
  showSymbol?: boolean
  connectNulls?: boolean
  lineWidth?: number
  lineStyle?: 'solid' | 'dashed'
  areaOpacity?: number
  barGap?: number
  barBorderRadius?: number
  labelPosition?: 'top' | 'inside' | 'right'
  pieLabelMode?: 'percent' | 'value' | 'category'
  donutThickness?: number
  rotationAngle?: number
  sliceExplode?: boolean
  topN?: number
  minLabelPercent?: number
  pieSort?: 'desc' | 'asc' | 'none'
  legendCompact?: boolean
  legendOrient?: 'horizontal' | 'vertical'
  scatterSymbol?: 'circle' | 'rect'
  scatterSymbolSize?: number
  trendline?: boolean
  densityMode?: boolean
  normalCurve?: boolean
  radarFill?: boolean
  treemapDrilldown?: boolean
  gaugeMin?: number
  gaugeMax?: number
  gaugeTarget?: number
  gaugeArcThickness?: number
  gaugeSemi?: boolean
  numberPrefix?: string
  numberSuffix?: string
  numberFontSize?: number
}

interface ChartRendererProps {
  title: string
  type?: string
  config?: ChartConfig
  data?: QueryResult
  height?: number
  responsive?: boolean
  minWidth?: number
  minHeight?: number
  maxHeight?: number
  aspectRatio?: number // width / height
  loading?: boolean
  error?: string
  onRefresh?: () => void
  onEdit?: () => void
  onEditSQL?: () => void
  onDelete?: () => void
  onChartReady?: (instance: any) => void
  sourceQuery?: string
  extraActions?: React.ReactNode
}

function isNumeric(n: any) {
  if (typeof n === 'number') return Number.isFinite(n)
  if (typeof n === 'string') {
    const parsed = parseFloat(n)
    return Number.isFinite(parsed)
  }
  return false
}

export function ChartRenderer({ title, type, config, data, height, responsive, minWidth, minHeight, maxHeight, aspectRatio, loading, error, onRefresh, onEdit, onEditSQL, onDelete, onChartReady, sourceQuery, extraActions }: ChartRendererProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const headerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<any>(null);
  const [legendOn, setLegendOn] = React.useState<boolean>(config?.showLegend ?? false);
  const [gridOn, setGridOn] = React.useState<boolean>(config?.showGrid ?? true);
  const [zoomOn, setZoomOn] = React.useState<boolean>(config?.dataZoom ?? false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);
  const [computedHeight, setComputedHeight] = useState<number>(height ?? 260);
  const [padPx, setPadPx] = useState<number>(0);
  const [fontScale, setFontScale] = useState<number>(10);

  const effectiveConfig = React.useMemo<ChartConfig>(() => ({
    ...(config || {}),
    showLegend: legendOn,
    showGrid: gridOn,
    dataZoom: zoomOn,
  }), [config, legendOn, gridOn, zoomOn]);

  const numericSeries = useMemo(() => {
    if (!data || data.columns.length < 1) return null
    const colNames = data.columns.map(c => c.name)
    const norm = (s: string) => s.replace(/["'`]/g, '').replace(/[_\s-]+/g, '').toLowerCase()
    const findCol = (desired?: string, fallbackIndex = 0): string | undefined => {
      if (!colNames.length) return undefined
      if (desired) {
        // exact match
        const exact = colNames.find(n => n === desired)
        if (exact) return exact
        // case-insensitive match
        const ci = colNames.find(n => n.toLowerCase() === desired.toLowerCase())
        if (ci) return ci
        // normalized match (strip quotes/underscores/spaces)
        const nm = colNames.find(n => norm(n) === norm(desired))
        if (nm) return nm
      }
      // Common aliases from generated SQL
      const aliasHit = desired ? colNames.find(n => n.toLowerCase() === desired.toLowerCase()) : undefined
      if (aliasHit) return aliasHit
      const byIndex = data.columns[fallbackIndex]?.name
      return byIndex
    }

    const aliasX = colNames.find(n => n.toLowerCase() === 'x')
    const aliasY = colNames.find(n => n.toLowerCase() === 'y')
    const xCol = findCol(config?.xField) || aliasX || data.columns[0]?.name
    const yCol = findCol(config?.yField, 1) || aliasY || data.columns[1]?.name
    // Only respect Y2 when explicitly provided in config; do not auto-detect
    const y2Col = config?.y2Field ? findCol(config?.y2Field) : undefined

    if (!xCol || !yCol) return null
    const values = data.rows.map(r => ({ x: String(r[xCol]), y: Number(r[yCol]) })).filter(v => isNumeric(v.y))
    const values2 = y2Col ? data.rows.map(r => ({ x: String(r[xCol]), y2: Number(r[y2Col!]) })).filter(v => isNumeric(v.y2)) : undefined
    if (!values.length) return null
    const maxY = Math.max(...values.map(v => v.y)) || 1
    const maxY2 = values2 && values2.length ? Math.max(...values2.map(v => v.y2!)) || 1 : undefined
    const minY = Math.min(...values.map(v => v.y))
    const minY2 = values2 && values2.length ? Math.min(...values2.map(v => v.y2!)) : undefined
    const droppedY = (data.rows?.length || 0) - values.length
    const droppedY2 = y2Col ? ((data.rows?.length || 0) - (values2?.length || 0)) : 0
    return { values, values2, maxY, maxY2, minY, minY2, droppedY, droppedY2, xCol, yCol, y2Col }
  }, [data, config])

  // Determine default aspect ratios by chart type (width / height)
  const defaultAspect: number = useMemo(() => {
    switch (type) {
      case 'pie':
      case 'donut':
      case 'radar':
      case 'treemap':
      case 'gauge':
      case 'heatmap':
        return 1; // square
      case 'bar':
      case 'column':
      case 'histogram':
      case 'stackedBar':
      case 'stackedArea':
      case 'line':
      case 'area':
      default:
        return 16 / 9; // widescreen
    }
  }, [type]);

  // Debounced ResizeObserver for container (width + height)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !responsive) return;
    let handle: any;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      clearTimeout(handle);
      handle = setTimeout(() => {
        setContainerWidth(w);
        setContainerHeight(h);
      }, 100);
    });
    obs.observe(el);
    return () => { obs.disconnect(); clearTimeout(handle); };
  }, [responsive]);

  // Compute height, padding, font scaling based on width and available vertical space
  // Use layout effect to avoid flicker on initial mount and during rapid resizes
  useLayoutEffect(() => {
    const w = containerWidth || (containerRef.current?.clientWidth ?? 0);
    const hAvail = containerHeight || (containerRef.current?.clientHeight ?? 0);
    const minW = Math.max(300, minWidth ?? 0);
    const minH = Math.max(200, minHeight ?? 0);
    const maxH = maxHeight ?? (responsive ? 2000 : 600);
    const ar = aspectRatio || defaultAspect;
    const effW = Math.max(minW, w || 300);
    const headerH = Math.max(0, headerRef.current?.offsetHeight ?? 0);
    const verticalRoom = Math.max(0, hAvail - headerH);
    const arHeight = Math.floor(effW / ar);
    
    // If responsive and we have vertical room, fill it. Otherwise use aspect ratio.
    const heightBasis = (responsive && verticalRoom > 0) ? verticalRoom : arHeight;
    const targetH = Math.max(minH, Math.min(maxH, heightBasis));
    
    setComputedHeight(responsive ? targetH : (height ?? targetH));
    // add a tiny inner padding to create subtle spacing
    setPadPx(6);
    // small axis font for compact labels
    const f = Math.max(9, Math.min(11, Math.floor(targetH * 0.02)));
    setFontScale(f);
  }, [containerWidth, containerHeight, responsive, height, minWidth, minHeight, maxHeight, aspectRatio, defaultAspect]);

  // Resize ECharts instance when computed height changes
  useEffect(() => {
    if (chartRef.current) {
      try { chartRef.current.resize(); } catch {}
    }
  }, [computedHeight, containerWidth]);

  // Window resize debounce to trigger echarts resize for quality
  useEffect(() => {
    const onResize = () => { chartRef.current?.resize?.(); };
    let t: any;
    const handler = () => { clearTimeout(t); t = setTimeout(onResize, 120); };
    window.addEventListener('resize', handler);
    return () => { window.removeEventListener('resize', handler); clearTimeout(t); };
  }, []);

  const option = useMemo(() => {
    if (!data) return null
    // Render plain table when type is explicitly requested
    if (type === 'table') return null;
    const cols = data.columns.map(c => c.name)
    const norm = (s: string) => s.replace(/["'`]/g, '').replace(/[_\s-]+/g, '').toLowerCase()
    const resolveField = (desired?: string, fallbackIdx = 0): string | undefined => {
      if (desired) {
        const exact = cols.find(n => n === desired)
        if (exact) return exact
        const ci = cols.find(n => n.toLowerCase() === desired.toLowerCase())
        if (ci) return ci
        const nm = cols.find(n => norm(n) === norm(desired))
        if (nm) return nm
      }
      const alias = desired ? cols.find(n => n.toLowerCase() === desired.toLowerCase()) : undefined
      if (alias) return alias
      return data.columns[fallbackIdx]?.name
    }
    const aliasX = cols.find(n => n.toLowerCase() === 'x')
    const aliasY = cols.find(n => n.toLowerCase() === 'y')
    const xField = resolveField(config?.xField) || aliasX || cols[0]
    const yField = resolveField(config?.yField, 1) || aliasY || cols[1]
    const categories = numericSeries ? numericSeries.values.map(v => v.x) : data.rows.map(r => String(r[xField]))
    const values = numericSeries ? numericSeries.values.map(v => v.y) : data.rows.map(r => Number(r[yField]))
    // Only include Y2 when explicitly set in config
    const y2Field = config?.y2Field ? resolveField(config?.y2Field) : undefined
    const values2 = (y2Field && numericSeries?.values2)
      ? numericSeries.values2.map(v => v.y2!)
      : (y2Field ? data.rows.map(r => Number(r[y2Field])) : undefined)
    const isAlpha = (s: string) => /[a-zA-Z]/.test(s)
    const xHasAlpha = categories.some(c => isAlpha(String(c)))
    const xFont = Math.max(9, Math.min(11, fontScale))
    const yFont = Math.max(9, Math.min(11, fontScale))
    let colors = effectiveConfig?.palette === 'neon'
      ? ['#22d3ee','#a78bfa','#f472b6','#fbbf24','#34d399','#60a5fa']
      : effectiveConfig?.palette === 'cool'
      ? ['#60a5fa','#34d3ee','#22d3ee','#a78bfa']
      : effectiveConfig?.palette === 'warm'
      ? ['#fbbf24','#f472b6','#fb7185','#f59e0b']
      : undefined

    if (effectiveConfig?.primaryColor) {
      if (colors && colors.length) {
        const filtered = colors.filter(c => c.toLowerCase() !== effectiveConfig.primaryColor!.toLowerCase())
        colors = [effectiveConfig.primaryColor!, ...filtered]
      } else {
        colors = [effectiveConfig.primaryColor!]
      }
    }
    if (effectiveConfig?.paletteInvert && colors) {
      colors = colors.slice().reverse()
    }

    const legendPos = effectiveConfig?.legendPosition;
    const legendOpts: any = { show: effectiveConfig?.showLegend ?? false };
    if (legendPos === 'top') legendOpts.top = 0;
    else if (legendPos === 'bottom') legendOpts.bottom = 0;
    else if (legendPos === 'left') legendOpts.left = 'left';
    else if (legendPos === 'right') legendOpts.right = 'right';

    const common: any = {
      color: colors,
      tooltip: { trigger: (type === 'line' || type === 'area' || type === 'column' || type === 'bar') ? 'axis' : 'item' },
      legend: legendOpts,
      grid: effectiveConfig?.showGrid === false
        ? { show: false, containLabel: true, top: 6, right: 6, bottom: 6, left: 6 }
        : { containLabel: true, top: 6, right: 6, bottom: 6, left: 6 },
      ...(effectiveConfig?.dataZoom ? { dataZoom: [{ type: 'inside' }, { type: 'slider' }] } : {})
    }
    // Axis label helpers
    const xName = xField ? String(xField) : 'X';
    const yName = yField ? String(yField) : 'Y';
    const y2Name = y2Field ? String(y2Field) : undefined;

    switch (type) {
      case 'table':
        return null;
      case 'line': {
        const baseLineStyle = { width: effectiveConfig?.lineWidth ?? 2, type: effectiveConfig?.lineStyle ?? 'solid' } as any;
        const labelOpt = effectiveConfig?.labelOn ? { show: true, position: 'top' } : undefined;
        const series: any[] = [
          { type: 'line', name: 'Y', data: values, smooth: !!effectiveConfig?.smooth, showSymbol: effectiveConfig?.showSymbol ?? true, connectNulls: effectiveConfig?.connectNulls ?? false, lineStyle: baseLineStyle, areaStyle: effectiveConfig?.area ? { opacity: effectiveConfig?.areaOpacity ?? 0.3 } : undefined, label: labelOpt },
          ...(values2 ? [{ type: 'line', name: 'Y2', yAxisIndex: 1, data: values2, showSymbol: effectiveConfig?.showSymbol ?? true, connectNulls: effectiveConfig?.connectNulls ?? false, lineStyle: baseLineStyle, label: labelOpt }] : [])
        ];
        if (effectiveConfig?.trendline && values.length > 1) {
          const xs = values.map((_, i) => i);
          const ys = values;
          const n = xs.length;
          const sumX = xs.reduce((a,b)=>a+b,0);
          const sumY = ys.reduce((a,b)=>a+b,0);
          const sumXY = xs.reduce((a,b,i)=>a + b * ys[i], 0);
          const sumXX = xs.reduce((a,b)=>a + b*b, 0);
          const denom = n * sumXX - sumX * sumX || 1;
          const slope = (n * sumXY - sumX * sumY) / denom;
          const intercept = (sumY - slope * sumX) / n;
          const reg = xs.map(x => intercept + slope * x);
          series.push({ type: 'line', name: 'Trend', data: reg, smooth: true, symbol: 'none', lineStyle: { width: 2, type: 'dashed' } });
        }
        return {
          ...common,
          xAxis: { type: 'category', data: categories, name: xName, nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: xFont + 1 }, axisLabel: { rotate: effectiveConfig?.xRotate ?? 0, fontSize: xFont, margin: 4, hideOverlap: true } },
          yAxis: y2Field ? [
            { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: numericSeries ? Math.min(0, numericSeries.minY) : undefined, max: numericSeries ? numericSeries.maxY : undefined },
            { type: 'value', name: y2Name, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: (numericSeries?.minY2 !== undefined) ? Math.min(0, numericSeries.minY2) : undefined, max: (numericSeries?.maxY2 !== undefined) ? numericSeries.maxY2 : undefined }
          ] : { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: numericSeries ? Math.min(0, numericSeries.minY) : undefined, max: numericSeries ? numericSeries.maxY : undefined },
          series
        }
      }
      case 'area': {
        const baseLineStyle = { width: effectiveConfig?.lineWidth ?? 2, type: effectiveConfig?.lineStyle ?? 'solid' } as any;
        const hasY2 = !!y2Field && !!values2;
        const labelOpt = effectiveConfig?.labelOn ? { show: true, position: 'top' } : undefined;
        const series: any[] = [
          { type: 'line', name: 'Y', data: values, smooth: !!effectiveConfig?.smooth, showSymbol: effectiveConfig?.showSymbol ?? true, connectNulls: effectiveConfig?.connectNulls ?? false, lineStyle: baseLineStyle, areaStyle: { opacity: effectiveConfig?.areaOpacity ?? 0.3 }, label: labelOpt },
          ...(hasY2 ? [{ type: 'line', name: 'Y2', yAxisIndex: 1, data: values2, showSymbol: effectiveConfig?.showSymbol ?? true, connectNulls: effectiveConfig?.connectNulls ?? false, lineStyle: baseLineStyle, areaStyle: { opacity: (effectiveConfig?.areaOpacity ?? 0.3) * 0.8 }, label: labelOpt }] : [])
        ];
        return {
          ...common,
          xAxis: { type: 'category', data: categories, name: xName, nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: xFont + 1 }, axisLabel: { rotate: effectiveConfig?.xRotate ?? 0, fontSize: xFont, margin: 4, hideOverlap: true } },
          yAxis: hasY2 ? [
            { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: numericSeries ? Math.min(0, numericSeries.minY) : undefined, max: numericSeries ? numericSeries.maxY : undefined },
            { type: 'value', name: y2Name, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: (numericSeries?.minY2 !== undefined) ? Math.min(0, numericSeries.minY2) : undefined, max: (numericSeries?.maxY2 !== undefined) ? numericSeries.maxY2 : undefined }
          ] : { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: numericSeries ? Math.min(0, numericSeries.minY) : undefined, max: numericSeries ? numericSeries.maxY : undefined },
          series
        }
      }
      case 'column':
        return { 
          ...common,
          xAxis: { type: 'category', data: categories, name: xName, nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: xFont + 1 }, axisLabel: { rotate: effectiveConfig?.xRotate ?? 0, fontSize: xFont, margin: 4, hideOverlap: true } },
          yAxis: y2Field ? [
            { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: numericSeries ? Math.min(0, numericSeries.minY) : undefined, max: numericSeries ? numericSeries.maxY : undefined },
            { type: 'value', name: y2Name, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: (numericSeries?.minY2 !== undefined) ? Math.min(0, numericSeries.minY2) : undefined, max: (numericSeries?.maxY2 !== undefined) ? numericSeries.maxY2 : undefined }
          ] : { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: numericSeries ? Math.min(0, numericSeries.minY) : undefined, max: numericSeries ? numericSeries.maxY : undefined },
          series: [
            { 
              type: 'bar', 
              name: 'Y', 
              data: values, 
              stack: effectiveConfig?.stack ? 'total' : undefined, 
              label: effectiveConfig?.labelOn ? { show: true, position: effectiveConfig?.labelPosition ?? 'top' } : undefined,
              itemStyle: { borderRadius: effectiveConfig?.barBorderRadius ?? 0 },
              barCategoryGap: `${effectiveConfig?.barGap ?? 20}%`
            },
            ...(values2 ? [{ 
              type: 'bar', 
              name: 'Y2', 
              yAxisIndex: 1, 
              data: values2, 
              stack: effectiveConfig?.stack ? 'total' : undefined, 
              label: effectiveConfig?.labelOn ? { show: true, position: effectiveConfig?.labelPosition ?? 'top' } : undefined,
              itemStyle: { borderRadius: effectiveConfig?.barBorderRadius ?? 0 },
              barCategoryGap: `${effectiveConfig?.barGap ?? 20}%`
            }] : [])
          ]
        }
      case 'bar':
        return { 
          ...common,
          xAxis: { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: Math.max(10, fontScale + 1) }, axisLabel: { fontSize: Math.max(9, fontScale), margin: 4, hideOverlap: true }, min: numericSeries ? Math.min(0, numericSeries.minY) : undefined, max: numericSeries ? numericSeries.maxY : undefined },
          yAxis: { type: 'category', data: categories, name: xName, nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: Math.max(10, fontScale + 1) }, axisLabel: { rotate: effectiveConfig?.xRotate ?? 0, fontSize: Math.max(9, fontScale), margin: 4, hideOverlap: true } },
          series: [
            { 
              type: 'bar', 
              name: 'Y', 
              data: values, 
              stack: effectiveConfig?.stack ? 'total' : undefined, 
              label: effectiveConfig?.labelOn ? { show: true, position: effectiveConfig?.labelPosition ?? 'right' } : undefined,
              itemStyle: { borderRadius: effectiveConfig?.barBorderRadius ?? 0 },
              barCategoryGap: `${effectiveConfig?.barGap ?? 20}%`
            },
            ...(values2 ? [{ 
              type: 'bar', 
              name: 'Y2', 
              data: values2, 
              stack: effectiveConfig?.stack ? 'total' : undefined, 
              label: effectiveConfig?.labelOn ? { show: true, position: effectiveConfig?.labelPosition ?? 'right' } : undefined,
              itemStyle: { borderRadius: effectiveConfig?.barBorderRadius ?? 0 },
              barCategoryGap: `${effectiveConfig?.barGap ?? 20}%`
            }] : [])
          ]
        }
      case 'pie':
      case 'donut': {
        let pieData = categories.map((name, i) => ({ name: String(name), value: Number(values[i]) }));
        // Optional sorting to make analysis easier
        const sortMode = effectiveConfig?.pieSort ?? 'desc';
        if (sortMode !== 'none') {
          pieData = pieData.slice().sort((a,b)=> sortMode==='desc' ? (b.value - a.value) : (a.value - b.value));
        }
        const topN = effectiveConfig?.topN;
        if (topN && pieData.length > topN) {
          const sorted = [...pieData].sort((a,b)=>b.value - a.value);
          const top = sorted.slice(0, topN);
          const others = sorted.slice(topN);
          const othersSum = others.reduce((a,b)=>a + (b.value || 0), 0);
          pieData = [...top, { name: 'Others', value: othersSum }];
        }
        if (effectiveConfig?.sliceExplode && pieData.length) {
          pieData[0] = { ...pieData[0], selected: true } as any;
        }
        // Appearance improvements
        const totalSum = pieData.reduce((a,b)=>a + (Number(b.value) || 0), 0);
        const labelMode = effectiveConfig?.pieLabelMode ?? (effectiveConfig?.labelOn ? 'percent' : undefined);
        const minPct = Math.max(0, Math.min(100, effectiveConfig?.minLabelPercent ?? 4));
        const labelFormatter = labelMode === 'percent' ? (p: any) => (p.percent < minPct ? '' : `${p.name}: ${p.percent}%`)
          : labelMode === 'value' ? (p: any) => (p.percent < minPct ? '' : `${p.name}: ${p.value}`)
          : labelMode === 'category' ? (p: any) => (p.percent < minPct ? '' : `${p.name}`)
          : undefined;
        const thickness = Math.max(10, Math.min(90, effectiveConfig?.donutThickness ?? 30));
        const radius = type === 'donut' ? [`${thickness}%`, '70%'] : '55%';
        const labelOn = effectiveConfig?.labelOn ?? (labelMode ? true : false);
        const labelFont = Math.max(10, fontScale);
        const numberPrefix = effectiveConfig?.numberPrefix ?? '';
        const numberSuffix = effectiveConfig?.numberSuffix ?? '';
        const tooltipFmt = (p: any) => `${p.name}: ${numberPrefix}${p.value}${numberSuffix}${labelMode==='percent' ? ` (${p.percent}%)` : ''}`;
        return { 
          ...common, 
          tooltip: { trigger: 'item', formatter: tooltipFmt },
          // Compact legend handling to avoid spreading over the chart area
          legend: {
            ...(effectiveConfig?.showLegend ? { show: true } : { show: false }),
            type: 'scroll',
            orient: effectiveConfig?.legendOrient ?? 'vertical',
            right: (effectiveConfig?.legendPosition === 'left') ? undefined : 0,
            left: (effectiveConfig?.legendPosition === 'left') ? 'left' : undefined,
            top: 'middle',
            itemWidth: 12,
            itemHeight: 12,
            padding: [0,0,0,0]
          },
          // Center text for donut showing total
          ...(type === 'donut' ? { graphic: [{
            type: 'text',
            left: 'center',
            top: 'center',
            style: {
              text: `${numberPrefix}${totalSum}${numberSuffix}`,
              fontSize: Math.max(12, labelFont + 2),
              fontWeight: 600,
              fill: '#666'
            }
          }] } : {}),
          series: [{ 
            type: 'pie', 
            radius, 
            startAngle: effectiveConfig?.rotationAngle ?? 90, 
            selectedMode: effectiveConfig?.sliceExplode ? 'single' : undefined,
            avoidLabelOverlap: true,
            label: { show: labelOn, formatter: labelFormatter, fontSize: labelFont },
            labelLine: { show: labelOn, length: 12, length2: 8 },
            itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 1 },
            emphasis: { scale: true, itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.25)' } },
            data: pieData 
          }] 
        }
      }
      case 'scatter': {
        const points = data.rows.map(r => [Number(r[xField]), Number(r[yField])]).filter(([xx,yy]) => Number.isFinite(xx) && Number.isFinite(yy));
        const series: any[] = [{ type: 'scatter', data: points, symbol: effectiveConfig?.scatterSymbol ?? 'circle', symbolSize: effectiveConfig?.scatterSymbolSize ?? 8 }];
        if (effectiveConfig?.trendline && points.length > 1) {
          const xs = points.map(p=>p[0]);
          const ys = points.map(p=>p[1]);
          const n = xs.length;
          const sumX = xs.reduce((a,b)=>a+b,0);
          const sumY = ys.reduce((a,b)=>a+b,0);
          const sumXY = xs.reduce((a,b,i)=>a + b * ys[i], 0);
          const sumXX = xs.reduce((a,b)=>a + b*b, 0);
          const denom = n * sumXX - sumX * sumX || 1;
          const slope = (n * sumXY - sumX * sumY) / denom;
          const intercept = (sumY - slope * sumX) / n;
          const minX = Math.min(...xs); const maxX = Math.max(...xs);
          const regPoints = [minX, maxX].map(x => [x, intercept + slope * x]);
          series.push({ type: 'line', data: regPoints, symbol: 'none', lineStyle: { width: 2, type: 'dashed' }, name: 'Trend' });
        }
        return { ...common, xAxis: { type: 'value', name: xName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: Math.max(12, fontScale + 1) }, axisLabel: { fontSize: Math.max(12, fontScale) } }, yAxis: { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: Math.max(12, fontScale + 1) }, axisLabel: { fontSize: Math.max(12, fontScale) } }, series } 
      }
      case 'histogram': {
        const sorted = [...values].sort((a,b)=>a-b); const bins = effectiveConfig?.bins ?? 10; const min = sorted[0] ?? 0; const max = sorted[sorted.length-1] ?? 0; const step = (max-min)/bins || 1; const edges = Array.from({length: bins+1},(_,i)=>min+i*step); const counts = Array.from({length: bins},()=>0); sorted.forEach(v=>{ const idx = Math.min(bins-1, Math.floor((v-min)/step)); counts[idx]++ });
        const total = sorted.length || 1;
        const densityMode = !!effectiveConfig?.densityMode;
        const valuesForBars = densityMode ? counts.map(c => c/(total*step)) : counts;
        const labels = counts.map((_,i)=>`${edges[i].toFixed(1)}-${edges[i+1].toFixed(1)}`);
        const series: any[] = [{ type: 'bar', data: valuesForBars }];
        if (effectiveConfig?.normalCurve && total > 1) {
          const mean = sorted.reduce((a,b)=>a+b,0)/total;
          const variance = sorted.reduce((a,b)=>a + Math.pow(b-mean,2),0)/total;
          const std = Math.sqrt(variance) || 1;
          const mids = edges.slice(0,-1).map((e,i)=>e + step/2);
          const normalVals = mids.map(x => {
            const coef = 1/(std*Math.sqrt(2*Math.PI));
            const z = (x-mean)/std;
            const density = coef * Math.exp(-0.5*z*z);
            return densityMode ? density : density * total * step; // scale to counts if not density mode
          });
          series.push({ type: 'line', data: normalVals, smooth: true, symbol: 'none', lineStyle: { width: 2, type: 'dashed' }, name: 'Normal' });
        }
        return { ...common, xAxis: { type: 'category', data: labels, name: `${yName} bins`, nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: Math.max(10, fontScale + 1) }, axisLabel: { fontSize: Math.max(9, fontScale), margin: 4, hideOverlap: true } }, yAxis: { type: 'value', name: densityMode ? 'Density' : 'Count', nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: Math.max(10, fontScale + 1) }, axisLabel: { fontSize: Math.max(9, fontScale), margin: 4, hideOverlap: true }, min: 0 }, series }
      }
      case 'radar':
        return { 
          ...common, 
          radar: { indicator: categories.map(c=>({ name:c })) }, 
          series: [{ type: 'radar', areaStyle: effectiveConfig?.radarFill ? {} : undefined, data: [{ value: values, name: title }] }] 
        }
      case 'gauge':
        const avg = values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0
        const minG = effectiveConfig?.gaugeMin ?? 0;
        const maxG = effectiveConfig?.gaugeMax ?? Math.max(...values, 100);
        const thick = effectiveConfig?.gaugeArcThickness ?? 12;
        const target = effectiveConfig?.gaugeTarget ?? (minG + (maxG - minG) * 0.7);
        const span = Math.max(1e-6, maxG - minG);
        const targetRatio = Math.max(0, Math.min(1, (target - minG) / span));
        const midRatio = Math.max(targetRatio, Math.min(0.9, targetRatio + 0.2));
        const numberPrefix = effectiveConfig?.numberPrefix ?? '';
        const numberSuffix = effectiveConfig?.numberSuffix ?? '';
        const semi = !!effectiveConfig?.gaugeSemi;
        return { 
          ...common,
          series: [{ 
            type: 'gauge', 
            min: minG, 
            max: maxG, 
            startAngle: semi ? 180 : 225,
            endAngle: semi ? 0 : -45,
            progress: { show: true, roundCap: true }, 
            axisLine: { lineStyle: { width: thick, color: [
              [targetRatio, '#51d88a'],
              [midRatio, '#fac858'],
              [1, '#ee6666']
            ] } }, 
            axisTick: { show: true, distance: 0, splitNumber: 5 },
            splitLine: { show: true, length: 12 },
            axisLabel: { show: true, distance: 12 },
            pointer: { show: true, length: '70%', width: 4 },
            anchor: { show: true, size: 6 },
            detail: { valueAnimation: true, offsetCenter: [0, semi ? '20%' : '35%'], formatter: (val: number) => {
              const v = `${numberPrefix}${val}${numberSuffix}`;
              return effectiveConfig?.gaugeTarget !== undefined ? `${v}\nTarget ${numberPrefix}${target}${numberSuffix}` : v;
            }, fontSize: Math.max(12, (effectiveConfig?.numberFontSize ?? fontScale + 2)) }, 
            data: [{ value: Number(avg.toFixed(2)), name: title }] 
          }] 
        }
      case 'funnel':
        return { ...common, series: [{ type: 'funnel', label: { show: effectiveConfig?.labelOn ?? false }, data: categories.map((name, i) => ({ name: String(name), value: Number(values[i]) })) }] }
      case 'stackedBar':
      case 'stackedArea': {
        const seriesType = type === 'stackedBar' ? 'bar' : 'line';
        const areaStyle = type === 'stackedArea' ? {} : undefined;
        return { 
          ...common,
          xAxis: { type: 'category', data: categories, name: xName, nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: xFont + 1 }, axisLabel: { fontSize: xFont, margin: 4, hideOverlap: true } },
          yAxis: y2Field ? [
            { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: numericSeries ? Math.min(0, numericSeries.minY) : undefined, max: numericSeries ? numericSeries.maxY : undefined },
            { type: 'value', name: y2Name, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: (numericSeries?.minY2 !== undefined) ? Math.min(0, numericSeries.minY2) : undefined, max: (numericSeries?.maxY2 !== undefined) ? numericSeries.maxY2 : undefined }
          ] : { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: numericSeries ? Math.min(0, numericSeries.minY) : undefined, max: numericSeries ? numericSeries.maxY : undefined },
          series: [
            { type: seriesType, data: values, areaStyle, stack: 'total', name: 'Y' },
            ...(values2 ? [{ type: seriesType, data: values2, areaStyle, stack: 'total', name: 'Y2', yAxisIndex: 1 }] : [])
          ]
        }
      }
      default:
        return { ...common, xAxis: { type: 'category', data: categories, name: xName, nameLocation: 'middle', nameGap: 28, nameTextStyle: { fontSize: xFont + 1 }, axisLabel: { fontSize: xFont, margin: 4, hideOverlap: true } }, yAxis: { type: 'value', name: yName, nameLocation: 'middle', nameGap: 32, nameTextStyle: { fontSize: yFont + 1 }, axisLabel: { fontSize: yFont, margin: 4, hideOverlap: true }, min: numericSeries ? Math.min(0, numericSeries.minY) : undefined, max: numericSeries ? numericSeries.maxY : undefined }, series: [{ type: 'bar', data: values }] }
    }
  }, [data, type, effectiveConfig, title, fontScale, numericSeries])

  const downloadCSV = React.useCallback(() => {
    if (!data || !data.rows?.length) return;
    const headers = data.columns.map(c => c.name).join(',');
    const rows = data.rows.map(r => data.columns.map(c => JSON.stringify(r[c.name] ?? '')).join(',')).join('\n');
    const blob = new Blob([headers + '\n' + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${title || 'chart'}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [data, title]);

  const downloadPNG = React.useCallback(() => {
    const inst = chartRef.current;
    try {
      const dataUrl = inst?.getDataURL?.({ type: 'png' });
      if (!dataUrl) return;
      const a = document.createElement('a'); a.href = dataUrl; a.download = `${title || 'chart'}.png`; a.click();
    } catch {}
  }, [title]);

  const toggleLegend = React.useCallback(() => setLegendOn(v => !v), []);
  const toggleGrid = React.useCallback(() => setGridOn(v => !v), []);
  const toggleZoom = React.useCallback(() => setZoomOn(v => !v), []);
  const fullscreen = React.useCallback(() => { containerRef.current?.requestFullscreen?.(); }, []);

  const renderTable = () => (
    <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr>
            {data!.columns.map((c) => (
              <th key={c.name} className="text-left px-2 py-1 border-b border-white/10 text-white/70">{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data!.rows.map((row, idx) => (
            <tr key={idx} className="border-b border-white/5">
              {data!.columns.map((c) => (
                <td key={c.name} className="px-2 py-1 text-white/80">{String(row[c.name])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const renderBars = () => (
    <div className="flex-1 overflow-auto">
      <div className="space-y-2">
        {numericSeries!.values.map((v, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="text-white/70 w-24 truncate" title={v.x} style={{ fontSize: fontScale - 2 }}>{v.x}</div>
            <div className="flex-1 glass rounded">
              <div className="bg-cyan-500 rounded" style={{ width: `${(v.y / numericSeries!.maxY) * 100}%`, height: Math.max(12, fontScale) }} />
            </div>
            <div className="text-white/70 w-16 text-right" style={{ fontSize: fontScale - 2 }}>{v.y}</div>
          </div>
        ))}
      </div>
    </div>
  )

  const renderLine = () => (
    <div className="flex-1">
      <svg viewBox="0 0 400 160" className="w-full" style={{ height: computedHeight }}>
        <polyline
          fill="none"
          stroke="#22d3ee"
          strokeWidth="2"
          points={numericSeries!.values.map((v, i) => {
            const x = (i / Math.max(1, numericSeries!.values.length - 1)) * 400
            const vH = Math.max(100, computedHeight - 10);
            const y = 160 - (v.y / numericSeries!.maxY) * Math.min(150, vH)
            return `${x},${y}`
          }).join(' ')}
        />
      </svg>
      <div className="flex justify-between text-white/60 mt-1" style={{ fontSize: fontScale - 2 }}>
        {numericSeries!.values.map((v, i) => (
          <div key={i} className="truncate" title={v.x}>{v.x}</div>
        ))}
      </div>
    </div>
  )

  let content: React.ReactNode = null
  if (loading) {
    content = (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-indigo-400 border-t-transparent" />
      </div>
    )
  } else if (error) {
    content = (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-red-400 text-sm">{error}</div>
      </div>
    )
  } else if (!data) {
    content = (
      <div className="flex-1 flex items-center justify-center text-white/60 text-sm">
        No data yet. Click refresh to load.
      </div>
    )
  } else {
    if (type === 'number' && numericSeries) {
      const total = numericSeries.values.reduce((a,b)=>a+b.y,0)
      content = (
        <div className="flex-1 flex items-center justify-center">
          <div className="font-bold text-cyan-300" style={{ fontSize: Math.max(22, fontScale * 2) }}>{total.toLocaleString()}</div>
        </div>
      )
    } else if (option) {
      content = (
        <div className="flex-1">
          <ReactECharts 
            option={option} 
            theme="traeAurora" 
            style={{ height: computedHeight, width: '100%' }} 
            notMerge
            lazyUpdate
            onChartReady={(inst: any) => { chartRef.current = inst; onChartReady && onChartReady(inst); }} 
          />
        </div>
      )
    } else if ((type === 'bar' || type === 'column') && numericSeries) content = renderBars()
    else if (type === 'line' && numericSeries) content = renderLine()
    else content = renderTable()
  }

  return (
    <div ref={containerRef} className="glass rounded-xl h-full flex flex-col relative transition-all overflow-hidden" style={{ padding: padPx }}>
      <div ref={headerRef} className="flex items-center justify-between mb-0">
        <div className="flex items-center gap-2">
          <div className="font-semibold leading-tight overflow-hidden" title={title} style={{ fontSize: Math.max(12, fontScale) }}>
            <span className="block whitespace-normal break-words" style={{ maxHeight: 2 * (fontScale + 4) }}>
              {title}
            </span>
          </div>
          <span className="text-white/60 px-2 py-0.5 rounded-full border border-white/10" style={{ fontSize: Math.max(10, fontScale - 2) }}>{type || 'chart'}</span>
          {useMemo(() => {
            const parts: string[] = []
            const xCol = numericSeries?.xCol || config?.xField
            const yCol = numericSeries?.yCol || config?.yField
            const y2Col = numericSeries?.y2Col || config?.y2Field
            if (xCol) parts.push(`x: ${xCol}`)
            if (yCol) parts.push(`y: ${yCol}${config?.yAgg ? ` (${config.yAgg})` : ''}`)
            if (y2Col) parts.push(`y2: ${y2Col}${config?.y2Agg ? ` (${config.y2Agg})` : ''}`)
            const label = parts.join(' | ')
            return label ? (
              <span className="text-white/60 px-2 py-0.5 rounded-full border border-white/10" style={{ fontSize: Math.max(9, fontScale - 2) }}>{label}</span>
            ) : null
          }, [numericSeries, config, fontScale])}
        </div>
        <div className="flex gap-2">
          {extraActions}
          {numericSeries && (numericSeries.droppedY > 0 || numericSeries.droppedY2 > 0) && (
            <div className="text-yellow-300/80 text-xs px-2 py-0.5 rounded-full border border-yellow-300/30 bg-yellow-300/10">
              Filtered {(numericSeries.droppedY + (numericSeries.droppedY2 || 0))} invalid points
            </div>
          )}
          {onEditSQL && <button className="btn-icon" onClick={onEditSQL} title="Edit SQL"><FiList /></button>}
          {/* Simple Edit button removed as requested */}
          {onDelete && <button className="btn-icon" onClick={onDelete} title="Delete"><FiTrash2 /></button>}
          <div className="relative">
            <button className="btn-icon" onClick={() => setExportOpen(v => !v)} title="Export"><FiDownload /></button>
            {exportOpen && (
              <div className="absolute right-0 z-10 glass rounded-md p-2"
                   style={{ top: (containerHeight && headerRef.current) ? (containerHeight - (headerRef.current.offsetHeight + 8) < 120 ? undefined : 32) : 32, bottom: (containerHeight && headerRef.current) ? (containerHeight - (headerRef.current.offsetHeight + 8) < 120 ? 32 : undefined) : undefined }}>
                <button className="btn text-xs" onClick={() => { setExportOpen(false); downloadPNG(); }}><FiImage className="mr-1" /> PNG</button>
                <button className="btn text-xs mt-1" onClick={() => { setExportOpen(false); downloadCSV(); }}><FiDownload className="mr-1" /> CSV</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {content}
    </div>
  )
}