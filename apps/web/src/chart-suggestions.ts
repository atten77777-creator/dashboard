// Intelligent chart selection and configuration builder
// Analyzes dataset columns and rows to propose up to 8 chart types

export type ColumnMeta = { name: string; type?: string };
export type QueryResult = { columns: ColumnMeta[]; rows: any[] };

export interface ChartConfig {
  palette?: string;
  paletteInvert?: boolean;
  primaryColor?: string;
  showLegend?: boolean;
  showGrid?: boolean;
  smooth?: boolean;
  area?: boolean;
  stack?: boolean;
  bins?: number;
  labelOn?: boolean;
  xRotate?: number;
  legendPosition?: 'top' | 'bottom' | 'left' | 'right';
  dataZoom?: boolean;
  showSymbol?: boolean;
  connectNulls?: boolean;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed';
  areaOpacity?: number;
  barGap?: number;
  barBorderRadius?: number;
  labelPosition?: 'top' | 'inside' | 'right';
  pieLabelMode?: 'percent' | 'value' | 'category';
  donutThickness?: number;
  rotationAngle?: number;
  sliceExplode?: boolean;
  topN?: number;
  scatterSymbol?: 'circle' | 'rect';
  scatterSymbolSize?: number;
  trendline?: boolean;
  densityMode?: boolean;
  normalCurve?: boolean;
  radarFill?: boolean;
  // Aggregation config for AI suggestions and dual-axis charts
  yAgg?: 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max';
  y2Agg?: 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max';
}

export interface SuggestedChart {
  type: string;
  title: string;
  config?: ChartConfig;
  data: QueryResult;
  validation?: { valid: boolean; reason?: string };
}

function isNumeric(val: any): boolean {
  if (val == null) return false;
  if (typeof val === 'number') return isFinite(val);
  if (typeof val === 'string') {
    const n = Number(val);
    return !isNaN(n) && isFinite(n);
  }
  return false;
}

function isTemporal(val: any): boolean {
  if (val == null) return false;
  if (val instanceof Date) return true;
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return false;
    // ISO-like patterns
    if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(:\d{2})?)?/.test(s)) return true;
    // Oracle/SQL date-like
    if (/^\d{1,2}-[A-Za-z]{3}-\d{2,4}/.test(s)) return true;
    // Generic parseable
    const t = Date.parse(s);
    return !isNaN(t);
  }
  return false;
}

function inferColumnType(values: any[]): 'numeric' | 'temporal' | 'categorical' {
  const total = Math.max(1, values.length);
  const numCount = values.filter(isNumeric).length;
  const timeCount = values.filter(isTemporal).length;
  if (numCount / total >= 0.7) return 'numeric';
  if (timeCount / total >= 0.6) return 'temporal';
  return 'categorical';
}

function uniqueCount(values: any[]): number {
  const s = new Set(values.map(v => String(v)));
  return s.size;
}

function variance(values: number[]): number {
  const arr = values.filter(v => isFinite(v));
  if (!arr.length) return 0;
  const mean = arr.reduce((a,b)=>a+b,0) / arr.length;
  const vari = arr.reduce((a,b)=>a + Math.pow(b-mean,2), 0) / arr.length;
  return vari;
}

function pickBestTemporal(cols: string[], rows: any[]): string | null {
  const candidates = cols.map(name => ({ name, type: inferColumnType(rows.map(r => r?.[name])) }));
  const temporal = candidates.filter(c => c.type === 'temporal');
  if (!temporal.length) return null;
  // Prefer higher cardinality
  const scored = temporal.map(c => ({ name: c.name, score: uniqueCount(rows.map(r => r?.[c.name])) }));
  scored.sort((a,b)=>b.score-a.score);
  return scored[0]?.name || temporal[0]?.name || null;
}

function pickNumericByVariance(cols: string[], rows: any[]): string | null {
  const nums = cols.filter(name => inferColumnType(rows.map(r => r?.[name])) === 'numeric');
  if (!nums.length) return null;
  const scored = nums.map(name => ({ name, score: variance(rows.map(r => Number(r?.[name])) as number[]) }));
  scored.sort((a,b)=>b.score-a.score);
  return scored[0]?.name || nums[0] || null;
}

function pickTwoNumerics(cols: string[], rows: any[]): [string, string] | null {
  const nums = cols.filter(name => inferColumnType(rows.map(r => r?.[name])) === 'numeric');
  if (nums.length < 2) return null;
  // Choose top two by variance
  const scored = nums.map(name => ({ name, score: variance(rows.map(r => Number(r?.[name])) as number[]) }));
  scored.sort((a,b)=>b.score-a.score);
  return [scored[0].name, (scored[1] || scored[0]).name];
}

function pickCategorical(cols: string[], rows: any[]): string | null {
  const cats = cols.filter(name => inferColumnType(rows.map(r => r?.[name])) === 'categorical');
  if (!cats.length) return null;
  // Prefer mid-cardinality (2..50)
  const scored = cats.map(name => {
    const card = uniqueCount(rows.map(r => r?.[name]));
    const score = card >= 2 && card <= 50 ? card : (card < 2 ? 0 : 5 / Math.max(1, card));
    return { name, card, score };
  });
  scored.sort((a,b)=>b.score-a.score);
  return scored[0]?.name || cats[0] || null;
}

function sortByTemporal(rows: any[], timeCol: string): any[] {
  const copy = rows.slice();
  copy.sort((a,b) => {
    const ta = Date.parse(String(a?.[timeCol]));
    const tb = Date.parse(String(b?.[timeCol]));
    return (ta||0) - (tb||0);
  });
  return copy;
}

function aggregateByCategory(rows: any[], catCol: string, numCol: string, topN = 12): any[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = String(r?.[catCol]);
    const val = Number(r?.[numCol]);
    if (!isFinite(val)) continue;
    map.set(key, (map.get(key) || 0) + val);
  }
  const pairs = Array.from(map.entries()).map(([k,v]) => ({ [catCol]: k, [numCol]: v }));
  pairs.sort((a,b)=>Number(b[numCol]) - Number(a[numCol]));
  return pairs.slice(0, topN);
}

function capRows(rows: any[], max = 200): any[] {
  return rows.slice(0, max);
}

function columnsFromNames(names: string[]): ColumnMeta[] { return names.map(name => ({ name })); }
// ---- Helpers for enhanced detection and aggregation ----
function tokenizeName(name: string): string[] {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isCountColumnName(name: string): boolean {
  const tokens = tokenizeName(name);
  if (!tokens.length) return false;
  const has = (t: string) => tokens.includes(t);
  if (has('record') && has('count')) return true; // e.g., RECORD_COUNT
  if (has('records') && has('count')) return true;
  if (has('count') || has('cnt')) return true;
  if (has('total') && (has('count') || has('records'))) return true;
  if (has('qty') || has('quantity')) return true;
  return false;
}

function aggregateByCategoryPair(rows: any[], colA: string, colB: string, valueCol?: string, topN = 12): any[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const a = String(r?.[colA]);
    const b = String(r?.[colB]);
    const key = `${a} | ${b}`;
    const v = valueCol ? Number(r?.[valueCol]) : 1;
    if (!isFinite(v)) continue;
    map.set(key, (map.get(key) || 0) + v);
  }
  const pairKey = `${colA}+${colB}`;
  const pairs = Array.from(map.entries()).map(([k,v]) => ({ [pairKey]: k, RECORD_COUNT: v }));
  pairs.sort((a,b)=>Number(b.RECORD_COUNT) - Number(a.RECORD_COUNT));
  return pairs.slice(0, topN);
}

export function buildChartSuggestions(rawRows: any[], rawColumns: (string | ColumnMeta)[]): SuggestedChart[] {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  if (!rows.length) return [];
  const columns: string[] = Array.isArray(rawColumns) && rawColumns.length
    ? Array.from(new Set(rawColumns.map((c: any) => (typeof c === 'string' ? c : String(c?.name || ''))).filter(Boolean)))
    : Object.keys(rows[0]);

  if (columns.length < 1) return [];

  const suggestions: SuggestedChart[] = [];

  // Time series: line & area
  const timeCol = pickBestTemporal(columns, rows);
  const numForTime = pickNumericByVariance(columns, rows);
  if (timeCol && numForTime) {
    const sorted = sortByTemporal(rows, timeCol);
    const baseData = { columns: columnsFromNames([timeCol, numForTime]), rows: capRows(sorted) };
    const lineValid = capRows(sorted).filter(r => isTemporal(r?.[timeCol]) && isNumeric(r?.[numForTime])).length >= 3;
    if (lineValid) suggestions.push({ type: 'line', title: `Time Series: ${numForTime} over ${timeCol}`, config: { smooth: true, dataZoom: true, showLegend: true, showGrid: true, lineWidth: 2 }, data: baseData, validation: { valid: true } });
    const areaValid = lineValid;
    if (areaValid) suggestions.push({ type: 'area', title: `Area: ${numForTime} over ${timeCol}`, config: { smooth: true, area: true, dataZoom: true, showLegend: false, showGrid: true, areaOpacity: 0.25 }, data: baseData, validation: { valid: true } });
  }

  // Category totals: column (vertical) and bar (horizontal)
  const catCol = pickCategorical(columns, rows);
  const numForCat = pickNumericByVariance(columns, rows);
  if (catCol && numForCat) {
    const aggregated = aggregateByCategory(rows, catCol, numForCat, 12);
    const valid = aggregated.length >= 2;
    if (valid) {
      const dataAgg = { columns: columnsFromNames([catCol, numForCat]), rows: aggregated };
      suggestions.push({ type: 'column', title: `Totals: ${numForCat} by ${catCol}`, config: { labelOn: true, xRotate: 0, barBorderRadius: 2, palette: 'cool' }, data: dataAgg, validation: { valid: true } });
      suggestions.push({ type: 'bar', title: `Totals (Horizontal): ${numForCat} by ${catCol}`, config: { labelOn: true, labelPosition: 'right', barBorderRadius: 2, palette: 'warm' }, data: dataAgg, validation: { valid: true } });
      // Composition: pie and donut
      suggestions.push({ type: 'pie', title: `Composition: ${numForCat} by ${catCol}`, config: { labelOn: true, pieLabelMode: 'percent', topN: 8, sliceExplode: true, palette: 'neon' }, data: dataAgg, validation: { valid: true } });
      suggestions.push({ type: 'donut', title: `Composition (Donut): ${numForCat} by ${catCol}`, config: { labelOn: true, pieLabelMode: 'percent', topN: 8, donutThickness: 40, palette: 'neon' }, data: dataAgg, validation: { valid: true } });
    }
  }

  // Combined category pairs: count records by pair of categorical fields
  {
    const categoricalCols = columns.filter(name => inferColumnType(rows.map(r => r?.[name])) === 'categorical');
    if (categoricalCols.length >= 2) {
      const scored = categoricalCols.map(name => {
        const card = uniqueCount(rows.map(r => r?.[name]));
        const score = card >= 2 && card <= 30 ? card : (card < 2 ? 0 : 5 / Math.max(1, card));
        return { name, score };
      }).sort((a,b)=>b.score-a.score);
      const a = scored[0]?.name;
      const b = scored.find(s => s.name !== a)?.name;
      if (a && b) {
        const aggregatedPairs = aggregateByCategoryPair(rows, a, b, undefined, 12);
        if (aggregatedPairs.length >= 2) {
          const pairColName = `${a}+${b}`;
          const dataPair = { columns: columnsFromNames([pairColName, 'RECORD_COUNT']), rows: aggregatedPairs };
          suggestions.push({ type: 'column', title: `Totals: RECORD_COUNT by ${a} + ${b}`, config: { labelOn: true, xRotate: 0, barBorderRadius: 2, palette: 'cool', showLegend: false }, data: dataPair, validation: { valid: true } });
          suggestions.push({ type: 'bar', title: `Totals (Horizontal): RECORD_COUNT by ${a} + ${b}`, config: { labelOn: true, labelPosition: 'right', barBorderRadius: 2, palette: 'warm', showLegend: false }, data: dataPair, validation: { valid: true } });
          suggestions.push({ type: 'donut', title: `Composition: RECORD_COUNT by ${a} + ${b}`, config: { labelOn: true, pieLabelMode: 'percent', topN: 8, donutThickness: 40, palette: 'neon', showLegend: false }, data: dataPair, validation: { valid: true } });
        }
      }
    }
  }

  // Additional count detection: token-based names like RECORD_COUNT
  {
    const numericCols = columns.filter(n => inferColumnType(rows.map(r => r?.[n])) === 'numeric');
    const countCol = (numericCols.find(n => isCountColumnName(n)) || columns.find(n => isCountColumnName(n)));
    if (countCol) {
      const xCandidates = columns.filter(n => n !== countCol);
      const xCol = pickCategorical(xCandidates, rows) || xCandidates[0] || columns[0];
      const aggregated = aggregateByCategory(rows, xCol, countCol, 12);
      if (aggregated.length >= 2) {
        const dataAgg = { columns: columnsFromNames([xCol, countCol]), rows: aggregated };
        suggestions.push({ type: 'column', title: `Totals: ${countCol} by ${xCol}`, config: { labelOn: true, xRotate: 0, barBorderRadius: 2, palette: 'cool', showLegend: false }, data: dataAgg, validation: { valid: true } });
        suggestions.push({ type: 'bar', title: `Totals (Horizontal): ${countCol} by ${xCol}`, config: { labelOn: true, labelPosition: 'right', barBorderRadius: 2, palette: 'warm', showLegend: false }, data: dataAgg, validation: { valid: true } });
        suggestions.push({ type: 'donut', title: `Composition: ${countCol} by ${xCol}`, config: { labelOn: true, pieLabelMode: 'percent', topN: 8, donutThickness: 40, palette: 'neon', showLegend: false }, data: dataAgg, validation: { valid: true } });
      }
    }
  }

  // Correlation: scatter
  const twoNums = pickTwoNumerics(columns, rows);
  if (twoNums) {
    const [xNum, yNum] = twoNums;
    const validPoints = rows.filter(r => isNumeric(r?.[xNum]) && isNumeric(r?.[yNum])).length;
    if (validPoints >= 10) {
      const data = { columns: columnsFromNames([xNum, yNum]), rows: capRows(rows) };
      suggestions.push({ type: 'scatter', title: `Correlation: ${yNum} vs ${xNum}`, config: { scatterSymbol: 'circle', scatterSymbolSize: 8, trendline: true, showLegend: false }, data, validation: { valid: true } });
    }
  }

  // Distribution: histogram (pick best numeric)
  const numForHist = pickNumericByVariance(columns, rows);
  if (numForHist) {
    const numericVals = rows.filter(r => isNumeric(r?.[numForHist]));
    if (numericVals.length >= 5) {
      const data = { columns: columnsFromNames([numForHist, numForHist]), rows: capRows(rows) };
      suggestions.push({ type: 'histogram', title: `Distribution: ${numForHist}`, config: { bins: 12, normalCurve: true, densityMode: false, showLegend: false }, data, validation: { valid: true } });
    }
  }

  // Limit to max 8 distinct types
  const seen = new Set<string>();
  const unique = suggestions.filter(s => {
    if (seen.has(s.type)) return false; seen.add(s.type); return true;
  }).slice(0, 8);
  return unique;
}

export function suggestionAccent(type: string): string {
  switch (type) {
    case 'line': return 'border-cyan-500/40 bg-cyan-500/5';
    case 'area': return 'border-sky-500/40 bg-sky-500/5';
    case 'column': return 'border-indigo-500/40 bg-indigo-500/5';
    case 'bar': return 'border-violet-500/40 bg-violet-500/5';
    case 'pie': return 'border-emerald-500/40 bg-emerald-500/5';
    case 'donut': return 'border-teal-500/40 bg-teal-500/5';
    case 'scatter': return 'border-pink-500/40 bg-pink-500/5';
    case 'histogram': return 'border-amber-500/40 bg-amber-500/5';
    default: return 'border-white/15 bg-background/80';
  }
}