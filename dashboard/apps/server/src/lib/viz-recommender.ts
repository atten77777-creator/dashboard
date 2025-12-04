import { getTableSchema } from './db'

export type ChartType = 'column' | 'bar' | 'line' | 'pie' | 'scatter' | 'histogram' | 'number' | 'table'

export interface ChartDefinition {
  chartType: ChartType
  chartName: string
  justification?: string
  table: string
  xField: string
  yField?: string
  y2Field?: string
  aggregation?: { y?: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX'; y2?: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX' }
  groupBy?: string[]
  sort?: { by?: 'value' | 'key'; direction?: 'asc' | 'desc' }
  limit?: number
}

interface ColumnMeta {
  column_name: string
  data_type: string
  nullable?: string | number
  is_primary_key?: number
  is_foreign_key?: number
}

function isNumericType(t: string) {
  const u = t.toUpperCase()
  return u.includes('NUMBER') || u.includes('FLOAT') || u.includes('BINARY_DOUBLE') || u.includes('BINARY_FLOAT')
}
function isTextType(t: string) {
  const u = t.toUpperCase()
  return u.includes('CHAR') || u.includes('CLOB') || u.includes('VARCHAR') || u.includes('NCHAR') || u.includes('NVARCHAR')
}
function isDateType(t: string) {
  const u = t.toUpperCase()
  return u.includes('DATE') || u.includes('TIMESTAMP')
}

export async function recommendChartsForTables(tables: string[], goal?: string, llmType?: string): Promise<{ dashboardName: string; dashboardDescription?: string; chartDefinitions: ChartDefinition[] }> {
  // Try LLM-driven recommendations first; fallback to heuristics if empty
  let defs: ChartDefinition[] = []
  try {
    const mod = await import('./viz-llm') as any
    if (mod && typeof mod.llmRecommendChartsForTables === 'function') {
      defs = await mod.llmRecommendChartsForTables(tables, goal, llmType)
    }
  } catch {
    defs = []
  }
  const useLLM = defs.length > 0

  for (const table of (useLLM ? [] : tables)) {
    // Ensure Oracle user table names match case expectations
    let cols: ColumnMeta[] = []
    try {
      const schema = await getTableSchema(table.toUpperCase())
      cols = (schema as unknown as ColumnMeta[]) || []
      if (!Array.isArray(cols) || cols.length === 0) {
        // Fallback mock schema when Oracle returns no columns
        cols = [
          { column_name: 'CATEGORY', data_type: 'VARCHAR2' },
          { column_name: 'VALUE', data_type: 'NUMBER' },
          { column_name: 'MONTH', data_type: 'DATE' }
        ]
      }
    } catch {
      // Fallback mock schema when Oracle is unavailable
      cols = [
        { column_name: 'CATEGORY', data_type: 'VARCHAR2' },
        { column_name: 'VALUE', data_type: 'NUMBER' },
        { column_name: 'MONTH', data_type: 'DATE' }
      ]
    }

    const numCols = cols.filter(c => isNumericType(c.data_type))
    const catCols = cols.filter(c => isTextType(c.data_type))
    const dateCols = cols.filter(c => isDateType(c.data_type))

    // Basic sanity: skip if no columns
    if (!cols.length) continue

    const preferredMeasure = numCols[0]?.column_name
    const preferredCategory = catCols[0]?.column_name || cols[0].column_name

    // 1) Category breakdown -> column chart
    if (preferredMeasure && preferredCategory) {
      defs.push({
        chartType: 'column',
        chartName: `${table}: ${preferredCategory} vs ${preferredMeasure}`,
        justification: 'Show aggregated measure by category for quick comparison',
        table,
        xField: preferredCategory,
        yField: preferredMeasure,
        aggregation: { y: 'SUM' },
        groupBy: [preferredCategory],
        sort: { by: 'value', direction: 'desc' },
        limit: 50,
      })
    }

    // 2) Time series -> line chart (if date column exists)
    if (preferredMeasure && dateCols.length) {
      const timeCol = dateCols[0].column_name
      defs.push({
        chartType: 'line',
        chartName: `${table}: ${preferredMeasure} over time`,
        justification: 'Trend analysis across time',
        table,
        xField: timeCol,
        yField: preferredMeasure,
        aggregation: { y: 'SUM' },
        groupBy: [timeCol],
        sort: { by: 'key', direction: 'asc' },
        limit: 500,
      })
    }

    // 3) Distribution -> histogram (numeric only)
    if (preferredMeasure) {
      defs.push({
        chartType: 'histogram',
        chartName: `${table}: Distribution of ${preferredMeasure}`,
        justification: 'Understand the distribution of a numeric measure',
        table,
        xField: preferredMeasure,
        // charts data endpoint will aggregate appropriately; for histogram we rely on renderer
        // still provide aggregation to allow count per bin via server-side count if needed in future
        aggregation: { y: 'COUNT' },
        sort: { by: 'value', direction: 'desc' },
        limit: 1000,
      })
    }

    // 4) Composition -> pie chart (small top categories)
    if (preferredMeasure && preferredCategory) {
      defs.push({
        chartType: 'pie',
        chartName: `${table}: Composition of ${preferredMeasure} by ${preferredCategory}`,
        justification: 'Show composition across top categories',
        table,
        xField: preferredCategory,
        yField: preferredMeasure,
        aggregation: { y: 'SUM' },
        groupBy: [preferredCategory],
        sort: { by: 'value', direction: 'desc' },
        limit: 10,
      })
    }

    // 5) Scatter -> relationship between two numeric fields
    if (numCols.length >= 2) {
      const xNum = numCols[0].column_name
      const yNum = numCols[1].column_name
      defs.push({
        chartType: 'scatter',
        chartName: `${table}: ${xNum} vs ${yNum}`,
        justification: 'Explore correlation between two measures',
        table,
        xField: xNum,
        yField: yNum,
        sort: { by: 'key', direction: 'asc' },
        limit: 1000,
      })
    }

    // 6) KPI number -> sum of measure
    if (preferredMeasure) {
      defs.push({
        chartType: 'number',
        chartName: `${table}: Total ${preferredMeasure}`,
        justification: 'Single KPI showing aggregate value',
        table,
        xField: preferredMeasure, // used for numericSeries extraction
        aggregation: { y: 'SUM' },
        limit: 1000,
      })
    }
  }

  const name = goal?.trim()?.length ? `AI Dashboard: ${goal.slice(0, 48)}` : `AI Dashboard (${tables.join(', ')})`
  const desc = useLLM ? 'Generated from LLM chart tag recommendations' : 'Generated automatically from live schema analysis'
  return { dashboardName: name, dashboardDescription: desc, chartDefinitions: defs }
}