// Shared chart type definitions for LLM-driven and heuristic recommendations
export type ChartType =
  | 'column'
  | 'bar'
  | 'line'
  | 'pie'
  | 'scatter'
  | 'histogram'
  | 'number'
  | 'table'

export interface ChartDefinition {
  chartType: ChartType;
  chartName: string;
  justification?: string;
  table: string;
  xField?: string;
  yField?: string;
  y2Field?: string;
  aggregation?: {
    y?: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX'
    y2?: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX'
  };
  groupBy?: string[];
  sort?: { by: 'key' | 'value'; direction: 'asc' | 'desc' };
  limit?: number;
}

export async function recommendChartsForTables(tables: string[], goal?: string) {
  const defs = tables.map(t => ({
    id: `chart_${t.toLowerCase()}`,
    type: 'bar',
    title: `${t} Overview`,
    encodings: { x: 'CATEGORY', y: 'VALUE' },
    goal: goal || undefined
  }));
  return {
    dashboardName: 'Suggested Dashboard',
    dashboardDescription: 'Auto-generated based on provided tables',
    chartDefinitions: defs
  };
}