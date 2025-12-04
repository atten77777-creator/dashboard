// Intelligent chart selection and configuration builder
// Analyzes dataset columns and rows to propose up to 8 chart types

export type ColumnMeta = { name: string; type?: string };
export type QueryResult = { columns: ColumnMeta[]; rows: any[] };

export interface ChartConfig {
  // Field mapping (optional)
  xField?: string;
  yField?: string;
  y2Field?: string;
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
  gaugeArcThickness?: number;
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

function isIntegerLike(val: any): boolean {
  if (!isNumeric(val)) return false;
  const n = Number(val);
  return Math.abs(n - Math.round(n)) < 1e-9;
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
// Aggregate rows by a categorical/temporal X column with optional Y/Y2 aggregators
function aggregateByX(
  rows: any[],
  xCol: string,
  yCol: string | undefined,
  yAgg: 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max',
  y2Col?: string,
  y2Agg: 'none' | 'sum' | 'avg' | 'count' | 'min' | 'max' = 'none'
): any[] {
  const groups = new Map<string, { ys: number[]; y2s: number[] }>();
  for (const r of rows) {
    const key = String(r?.[xCol]);
    const g = groups.get(key) || { ys: [], y2s: [] };
    if (yCol) {
      const yv = Number(r?.[yCol]);
      if (Number.isFinite(yv)) g.ys.push(yv);
    }
    if (y2Col) {
      const y2v = Number(r?.[y2Col]);
      if (Number.isFinite(y2v)) g.y2s.push(y2v);
    }
    groups.set(key, g);
  }
  const apply = (fn: typeof yAgg, arr: number[]) => {
    if (!arr.length) return 0;
    switch (fn) {
      case 'sum': return arr.reduce((a,b)=>a+b,0);
      case 'avg': return arr.reduce((a,b)=>a+b,0) / arr.length;
      case 'count': return arr.length;
      case 'min': return arr.reduce((m,b)=>Math.min(m,b), Number.POSITIVE_INFINITY);
      case 'max': return arr.reduce((m,b)=>Math.max(m,b), Number.NEGATIVE_INFINITY);
      case 'none': default: return arr[0] ?? 0;
    }
  };
  const out: any[] = [];
  for (const [key, g] of groups.entries()) {
    const row: any = { [xCol]: key };
    if (yCol) row[yCol] = apply(yAgg, g.ys);
    if (y2Col) row[y2Col] = apply(y2Agg, g.y2s);
    out.push(row);
  }
  return out;
}
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

// Rotation helpers to avoid repeating the same chart type every time.
function getRotationIndex(key: string, modulo: number): number {
  try {
    const k = `trae_chart_rot_v1:${key}`;
    const raw = (typeof window !== 'undefined') ? window.localStorage.getItem(k) : null;
    const prev = raw ? parseInt(raw, 10) : -1;
    const next = ((isNaN(prev) ? -1 : prev) + 1) % Math.max(1, modulo);
    if (typeof window !== 'undefined') window.localStorage.setItem(k, String(next));
    return next;
  } catch {
    return 0;
  }
}

function datasetSignature(columns: string[], rows: any[]): string {
  const names = columns.join('|');
  const count = rows.length;
  const ck = rows.slice(0, 30).reduce((acc, r, idx) => acc + (Object.values(r).join('|').length % 101) * (idx + 1), 0);
  return `${names}#${count}#${ck}`;
}

export function buildChartSuggestions(rawRows: any[], rawColumns: (string | ColumnMeta)[]): SuggestedChart[] {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  if (!rows.length) return [];
  const columns: string[] = Array.isArray(rawColumns) && rawColumns.length
    ? Array.from(new Set(rawColumns.map((c: any) => (typeof c === 'string' ? c : String(c?.name || ''))).filter(Boolean)))
    : Object.keys(rows[0]);

  if (columns.length < 1) return [];

  const suggestions: SuggestedChart[] = [];
  const sig = datasetSignature(columns, rows);

  // Time series: line & area
  const timeCol = pickBestTemporal(columns, rows);
  const numForTime = pickNumericByVariance(columns, rows);
  if (timeCol && numForTime) {
    const sorted = sortByTemporal(rows, timeCol);
    const baseData = { columns: columnsFromNames([timeCol, numForTime]), rows: capRows(sorted) };
    const lineValid = capRows(sorted).filter(r => isTemporal(r?.[timeCol]) && isNumeric(r?.[numForTime])).length >= 3;
    // Prefer a single time series chart; rotate between line and area
    if (lineValid) {
      const timeOptions: SuggestedChart[] = [
        { type: 'line', title: `Time Series: ${numForTime} over ${timeCol}`, config: { smooth: true, dataZoom: true, showLegend: false, showGrid: true, lineWidth: 2 }, data: baseData, validation: { valid: true } },
        { type: 'area', title: `Area Trend: ${numForTime} over ${timeCol}`, config: { smooth: true, dataZoom: true, areaOpacity: 0.25, showLegend: false, showGrid: true }, data: baseData, validation: { valid: true } }
      ];
      const idx = getRotationIndex(`${sig}:time:${timeCol}:${numForTime}`, timeOptions.length);
      suggestions.push(timeOptions[idx]);
    }
  }

  // Category totals: column (vertical) and bar (horizontal)
  const catCol = pickCategorical(columns, rows);
  const numForCat = pickNumericByVariance(columns, rows);
  if (catCol && numForCat) {
    const aggregated = aggregateByCategory(rows, catCol, numForCat, 12);
    const valid = aggregated.length >= 2;
    if (valid) {
      const dataAgg = { columns: columnsFromNames([catCol, numForCat]), rows: aggregated };
      const nCats = aggregated.length;
      const barCandidates: SuggestedChart[] = [
        { type: 'bar', title: `Totals (Horizontal): ${numForCat} by ${catCol}`, config: { labelOn: true, labelPosition: 'right', barBorderRadius: 2, palette: 'warm', showLegend: false }, data: dataAgg, validation: { valid: true } },
        { type: 'column', title: `Totals: ${numForCat} by ${catCol}`, config: { labelOn: true, xRotate: 0, barBorderRadius: 2, palette: 'cool', showLegend: false }, data: dataAgg, validation: { valid: true } }
      ];
      const barIdxBase = nCats > 10 ? 0 : 1;
      const barIdxRot = getRotationIndex(`${sig}:catBars:${catCol}:${numForCat}:${nCats}`, 2);
      suggestions.push(barCandidates[(barIdxBase + barIdxRot) % 2]);

      const compCandidates: SuggestedChart[] = [];
      if (nCats <= 6) {
        compCandidates.push({ type: 'pie', title: `Composition: ${numForCat} by ${catCol}`, config: { labelOn: true, pieLabelMode: 'percent', palette: 'emerald', showLegend: false }, data: dataAgg, validation: { valid: true } });
        compCandidates.push({ type: 'donut', title: `Composition: ${numForCat} by ${catCol}`, config: { labelOn: true, pieLabelMode: 'percent', donutThickness: 40, palette: 'neon', showLegend: false }, data: dataAgg, validation: { valid: true } });
      } else if (nCats <= 12) {
        compCandidates.push({ type: 'donut', title: `Composition: ${numForCat} by ${catCol}`, config: { labelOn: true, pieLabelMode: 'percent', topN: 8, donutThickness: 40, palette: 'neon', showLegend: false }, data: dataAgg, validation: { valid: true } });
        compCandidates.push({ type: 'funnel', title: `Funnel: ${numForCat} by ${catCol}`, config: { labelOn: true, palette: 'purple', showLegend: false }, data: dataAgg, validation: { valid: true } });
      } else {
        compCandidates.push({ type: 'treemap', title: `Treemap: ${numForCat} by ${catCol}`, config: { palette: 'teal', showLegend: false }, data: dataAgg, validation: { valid: true } });
        compCandidates.push({ type: 'donut', title: `Composition (Top): ${numForCat} by ${catCol}`, config: { labelOn: true, pieLabelMode: 'percent', topN: 10, donutThickness: 35, palette: 'neon', showLegend: false }, data: dataAgg, validation: { valid: true } });
      }
      const compIdx = getRotationIndex(`${sig}:catComp:${catCol}:${numForCat}:${nCats}`, Math.max(1, compCandidates.length));
      suggestions.push(compCandidates[compIdx]);

      if (nCats >= 3 && nCats <= 12) {
        suggestions.push({ type: 'radar', title: `Profile: ${numForCat} by ${catCol}`, config: { radarFill: true, showLegend: false }, data: dataAgg, validation: { valid: true } });
      }
    }
  }

  // Fallback: treat integer-like ID columns + count/sum columns as categorical totals
  if (!catCol) {
    const numericCols = columns.filter(n => inferColumnType(rows.map(r => r?.[n])) === 'numeric');
    const countCol = (numericCols.find(n => isCountColumnName(n)) || columns.find(n => isCountColumnName(n)));
    if (countCol) {
      const xCandidates = columns.filter(n => n !== countCol);
      const xCol = pickCategorical(xCandidates, rows) || xCandidates[0] || columns[0];
      const aggregated = aggregateByCategory(rows, xCol, countCol, 12);
      if (aggregated.length >= 2) {
        const dataAgg = { columns: columnsFromNames([xCol, countCol]), rows: aggregated };
        const nCats = aggregated.length;
        const barCandidates: SuggestedChart[] = [
          { type: 'bar', title: `Totals (Horizontal): ${countCol} by ${xCol}`, config: { labelOn: true, labelPosition: 'right', barBorderRadius: 2, palette: 'warm', showLegend: false }, data: dataAgg, validation: { valid: true } },
          { type: 'column', title: `Totals: ${countCol} by ${xCol}`, config: { labelOn: true, xRotate: 0, barBorderRadius: 2, palette: 'cool', showLegend: false }, data: dataAgg, validation: { valid: true } }
        ];
        const barIdxBase = nCats > 10 ? 0 : 1;
        const barIdxRot = getRotationIndex(`${sig}:catBars:${xCol}:${countCol}:${nCats}`, 2);
        suggestions.push(barCandidates[(barIdxBase + barIdxRot) % 2]);
        const compCandidates: SuggestedChart[] = [];
        if (nCats <= 6) {
          compCandidates.push({ type: 'pie', title: `Composition: ${countCol} by ${xCol}`, config: { labelOn: true, pieLabelMode: 'percent', palette: 'emerald', showLegend: false }, data: dataAgg, validation: { valid: true } });
          compCandidates.push({ type: 'donut', title: `Composition: ${countCol} by ${xCol}`, config: { labelOn: true, pieLabelMode: 'percent', donutThickness: 40, palette: 'neon', showLegend: false }, data: dataAgg, validation: { valid: true } });
        } else if (nCats <= 12) {
          compCandidates.push({ type: 'donut', title: `Composition: ${countCol} by ${xCol}`, config: { labelOn: true, pieLabelMode: 'percent', topN: 8, donutThickness: 40, palette: 'neon', showLegend: false }, data: dataAgg, validation: { valid: true } });
          compCandidates.push({ type: 'funnel', title: `Funnel: ${countCol} by ${xCol}`, config: { labelOn: true, palette: 'purple', showLegend: false }, data: dataAgg, validation: { valid: true } });
        } else {
          compCandidates.push({ type: 'treemap', title: `Treemap: ${countCol} by ${xCol}`, config: { palette: 'teal', showLegend: false }, data: dataAgg, validation: { valid: true } });
          compCandidates.push({ type: 'donut', title: `Composition (Top): ${countCol} by ${xCol}`, config: { labelOn: true, pieLabelMode: 'percent', topN: 10, donutThickness: 35, palette: 'neon', showLegend: false }, data: dataAgg, validation: { valid: true } });
        }
        const compIdx = getRotationIndex(`${sig}:catComp:${xCol}:${countCol}:${nCats}`, Math.max(1, compCandidates.length));
        suggestions.push(compCandidates[compIdx]);
        if (nCats >= 3 && nCats <= 12) {
          suggestions.push({ type: 'radar', title: `Profile: ${countCol} by ${xCol}`, config: { radarFill: true, showLegend: false }, data: dataAgg, validation: { valid: true } });
        }
      }
    } else if (columns.length >= 2) {
      // If both first two columns are numeric but X looks like discrete integers, still plot totals
      const [xCol, yCol] = [columns[0], columns[1]];
      const yIsNumeric = inferColumnType(rows.map(r => r?.[yCol])) === 'numeric';
      const xDiscreteRatio = rows.length ? rows.map(r => r?.[xCol]).filter(isIntegerLike).length / rows.length : 0;
      if (yIsNumeric && xDiscreteRatio >= 0.8) {
        const aggregated = aggregateByCategory(rows, xCol, yCol, 12);
        if (aggregated.length >= 2) {
          const dataAgg = { columns: columnsFromNames([xCol, yCol]), rows: aggregated };
          const nCats = aggregated.length;
          const barCandidates: SuggestedChart[] = [
            { type: 'bar', title: `Totals (Horizontal): ${yCol} by ${xCol}`, config: { labelOn: true, labelPosition: 'right', barBorderRadius: 2, palette: 'warm', showLegend: false }, data: dataAgg, validation: { valid: true } },
            { type: 'column', title: `Totals: ${yCol} by ${xCol}`, config: { labelOn: true, xRotate: 0, barBorderRadius: 2, palette: 'cool', showLegend: false }, data: dataAgg, validation: { valid: true } }
          ];
          const barIdxBase = nCats > 10 ? 0 : 1;
          const barIdxRot = getRotationIndex(`${sig}:catBars:${xCol}:${yCol}:${nCats}`, 2);
          suggestions.push(barCandidates[(barIdxBase + barIdxRot) % 2]);
          const compCandidates: SuggestedChart[] = [];
          if (nCats <= 6) {
            compCandidates.push({ type: 'pie', title: `Composition: ${yCol} by ${xCol}`, config: { labelOn: true, pieLabelMode: 'percent', palette: 'emerald', showLegend: false }, data: dataAgg, validation: { valid: true } });
            compCandidates.push({ type: 'donut', title: `Composition: ${yCol} by ${xCol}`, config: { labelOn: true, pieLabelMode: 'percent', donutThickness: 40, palette: 'neon', showLegend: false }, data: dataAgg, validation: { valid: true } });
          } else if (nCats <= 12) {
            compCandidates.push({ type: 'donut', title: `Composition: ${yCol} by ${xCol}`, config: { labelOn: true, pieLabelMode: 'percent', topN: 8, donutThickness: 40, palette: 'neon', showLegend: false }, data: dataAgg, validation: { valid: true } });
            compCandidates.push({ type: 'funnel', title: `Funnel: ${yCol} by ${xCol}`, config: { labelOn: true, palette: 'purple', showLegend: false }, data: dataAgg, validation: { valid: true } });
          } else {
            compCandidates.push({ type: 'treemap', title: `Treemap: ${yCol} by ${xCol}`, config: { palette: 'teal', showLegend: false }, data: dataAgg, validation: { valid: true } });
            compCandidates.push({ type: 'donut', title: `Composition (Top): ${yCol} by ${xCol}`, config: { labelOn: true, pieLabelMode: 'percent', topN: 10, donutThickness: 35, palette: 'neon', showLegend: false }, data: dataAgg, validation: { valid: true } });
          }
          const compIdx = getRotationIndex(`${sig}:catComp:${xCol}:${yCol}:${nCats}`, Math.max(1, compCandidates.length));
          suggestions.push(compCandidates[compIdx]);
          if (nCats >= 3 && nCats <= 12) {
            suggestions.push({ type: 'radar', title: `Profile: ${yCol} by ${xCol}`, config: { radarFill: true, showLegend: false }, data: dataAgg, validation: { valid: true } });
          }
        }
      }
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
      const thirdNum = columns.filter(name => inferColumnType(rows.map(r => r?.[name])) === 'numeric').find(n => n !== xNum && n !== yNum);
      const corrCandidates: SuggestedChart[] = [
        { type: 'scatter', title: `Correlation: ${yNum} vs ${xNum}`, config: { scatterSymbol: 'circle', scatterSymbolSize: 6, trendline: true, showLegend: false }, data, validation: { valid: true } }
      ];
      if (thirdNum) {
        const data3 = { columns: columnsFromNames([xNum, yNum, thirdNum]), rows: capRows(rows) };
        corrCandidates.push({ type: 'bubble', title: `Bubble: ${yNum} vs ${xNum} sized by ${thirdNum}`, config: { showLegend: false }, data: data3, validation: { valid: true } });
      }
      const corrIdx = getRotationIndex(`${sig}:corr:${xNum}:${yNum}`, corrCandidates.length);
      suggestions.push(corrCandidates[corrIdx]);
    }
  }

  // Distribution: histogram (pick best numeric)
  const numForHist = pickNumericByVariance(columns, rows);
  if (numForHist) {
    const numericVals = rows.filter(r => isNumeric(r?.[numForHist]));
    if (numericVals.length >= 5) {
      const data = { columns: columnsFromNames([numForHist, numForHist]), rows: capRows(rows) };
      const distCandidates: SuggestedChart[] = [
        { type: 'histogram', title: `Distribution: ${numForHist}`, config: { bins: 12, normalCurve: true, densityMode: false, showLegend: false }, data, validation: { valid: true } },
        { type: 'gauge', title: `Average: ${numForHist}`, config: { gaugeArcThickness: 12, showLegend: false }, data, validation: { valid: true } }
      ];
      const distIdx = getRotationIndex(`${sig}:dist:${numForHist}`, distCandidates.length);
      suggestions.push(distCandidates[distIdx]);
    }
  }

  // Limit to max 8 distinct types
  const seen = new Set<string>();
  const unique = suggestions.filter(s => {
    if (seen.has(s.type)) return false; seen.add(s.type); return true;
  }).slice(0, 6);
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
    case 'radar': return 'border-blue-500/40 bg-blue-500/5';
    case 'treemap': return 'border-lime-500/40 bg-lime-500/5';
    case 'funnel': return 'border-purple-500/40 bg-purple-500/5';
    case 'gauge': return 'border-red-500/40 bg-red-500/5';
    case 'bubble': return 'border-rose-500/40 bg-rose-500/5';
    default: return 'border-white/15 bg-background/80';
  }
}

// AI dataset analysis: ask server to analyze dataset via configured LLM
export async function analyzeDatasetAI(
  dataset: QueryResult,
  opts: { llmType: 'openai' | 'gemini' | 'azure' | 'openai_compatible' | 'anthropic' | 'ollama'; conversationId?: string; apiBase?: string }
): Promise<{ suggestions: SuggestedChart[]; llmText?: string }> {
  const apiBase = (opts.apiBase || (typeof window !== 'undefined' ? (window as any).API_BASE : undefined)) as string | undefined;
  // Fallback import to avoid relying on global
  const base = apiBase || '/api';
  try {
    const body = {
      llmType: opts.llmType,
      conversationId: opts.conversationId,
      dataset: {
        // Only pass columns to the backend LLM route
        columns: (dataset.columns || []).map(c => ({ name: c.name, type: c.type }))
      }
    };
    const res = await fetch(`${base}/chat/analyze-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    const suggestions = Array.isArray(json?.suggestions) ? json.suggestions : [];
    // Convert into SuggestedChart format; perform client-side aggregation if requested
    const out: SuggestedChart[] = suggestions.map((s: any) => {
      const x = String(s?.fields?.xField || '');
      const y = s?.fields?.yField ? String(s.fields.yField) : undefined;
      const y2 = s?.fields?.y2Field ? String(s.fields.y2Field) : undefined;
      const cfg = s?.config || {};
      const yAgg = String(cfg?.yAgg || 'none').toLowerCase();
      const y2Agg = String(cfg?.y2Agg || 'none').toLowerCase();
      const needsAgg = (yAgg !== 'none') || (y2Agg !== 'none');
      const cols = [x].concat(y ? [y] : []).concat(y2 ? [y2] : []);
      const rows = needsAgg ? aggregateByX(dataset.rows, x, y, yAgg as any, y2, y2Agg as any) : dataset.rows;
      const data: QueryResult = { columns: columnsFromNames(cols), rows };
      return {
        type: String(s?.type || 'table'),
        title: String(s?.title || 'Chart'),
        config: { ...cfg, xField: x, yField: y, y2Field: y2, yAgg: yAgg as any, y2Agg: y2Agg as any },
        data,
        validation: validateSuggestionDataMapping(data, dataset, x, y, y2, needsAgg)
      };
    });
    return { suggestions: out, llmText: (typeof json?.llmText === 'string') ? json.llmText : undefined };
  } catch (e) {
    console.warn('AI analysis failed:', e);
    return { suggestions: [] };
  }
}

function validateSuggestionDataMapping(suggested: QueryResult, original: QueryResult, xField: string, yField?: string, y2Field?: string, aggregated?: boolean): { valid: boolean; reason?: string } {
  const sx = suggested.columns?.[0]?.name;
  const sy = suggested.columns?.[1]?.name;
  const sy2 = suggested.columns?.[2]?.name;
  if (sx !== xField) return { valid: false, reason: 'x field mismatch' };
  if (!!yField && sy !== yField) return { valid: false, reason: 'y field mismatch' };
  if (!!y2Field && sy2 !== y2Field) return { valid: false, reason: 'y2 field mismatch' };
  if (aggregated) {
    // For aggregated data, just ensure x values match set-wise and y/y2 are numeric
    const xsSuggested = new Set(suggested.rows.map(r => String(r[xField])));
    const xsOriginal = new Set(original.rows.map(r => String(r[xField])));
    for (const x of xsSuggested) { if (!xsOriginal.has(x)) return { valid: false, reason: 'aggregated x keys mismatch' }; }
    if (yField) {
      const allNumeric = suggested.rows.every(r => isNumeric(r[yField!]));
      if (!allNumeric) return { valid: false, reason: 'aggregated y not numeric' };
    }
    if (y2Field) {
      const allNumeric2 = suggested.rows.every(r => isNumeric(r[y2Field!]));
      if (!allNumeric2) return { valid: false, reason: 'aggregated y2 not numeric' };
    }
    return { valid: true };
  }
  // Ensure values are identical for the included rows (no transforms). We compare first N rows.
  const N = Math.min(50, original.rows.length, suggested.rows.length);
  for (let i = 0; i < N; i++) {
    const ro = original.rows[i];
    const rs = suggested.rows[i];
    if (String(rs[sx]) !== String(ro[xField])) return { valid: false, reason: 'x value altered' };
    if (yField && String(rs[sy!]) !== String(ro[yField])) return { valid: false, reason: 'y value altered' };
  }
  return { valid: true };
}
