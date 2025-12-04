import { SchemaGraph } from './queryBuilder';

export type ColumnStat = {
  name: string;
  distinct: number;
  nulls: number;
  min?: number | Date;
  max?: number | Date;
  type: 'temporal' | 'categorical' | 'quantitative';
};

export type TableSchemaPreview = {
  table: string;
  columns: ColumnStat[];
};

export function analyzeSchemaForCharting(graph: SchemaGraph, previews: TableSchemaPreview[]) {
  const relationships = graph.relationships.map(r => ({ ...r }));
  const tables = graph.tables;
  return { relationships, tables, previews };
}

export type ChartRecommendation = {
  table: string;
  chartType: 'bar' | 'line' | 'pie' | 'scatter' | 'table' | 'heatmap';
  dimensions: string[];
  measures: { field: string; agg: 'sum' | 'avg' | 'count' }[];
  rationale: string;
};

export function recommendCharts(previews: TableSchemaPreview[]): ChartRecommendation[] {
  const recs: ChartRecommendation[] = [];
  for (const p of previews) {
    const temporal = p.columns.filter(c => c.type === 'temporal');
    const numeric = p.columns.filter(c => c.type === 'quantitative');
    const categorical = p.columns.filter(c => c.type === 'categorical');
    if (temporal.length && numeric.length) {
      recs.push({
        table: p.table,
        chartType: 'line',
        dimensions: [temporal[0].name],
        measures: [{ field: numeric[0].name, agg: 'sum' }],
        rationale: 'Temporal trend with quantitative measure suggests line chart.',
      });
    }
    if (categorical.length && numeric.length) {
      recs.push({
        table: p.table,
        chartType: 'bar',
        dimensions: [categorical[0].name],
        measures: [{ field: numeric[0].name, agg: 'sum' }],
        rationale: 'Categorical distribution with totals suits a bar chart.',
      });
    }
    if (categorical.length && categorical[0].distinct <= 12) {
      recs.push({
        table: p.table,
        chartType: 'pie',
        dimensions: [categorical[0].name],
        measures: [{ field: numeric[0]?.name ?? categorical[0].name, agg: 'count' }],
        rationale: 'Small number of categories fits a pie chart.',
      });
    }
    if (numeric.length >= 2) {
      recs.push({
        table: p.table,
        chartType: 'scatter',
        dimensions: [],
        measures: [{ field: numeric[0].name, agg: 'avg' }, { field: numeric[1].name, agg: 'avg' }],
        rationale: 'Two quantitative fields suggest scatter correlation.',
      });
    }
    // fallback table
    recs.push({
      table: p.table,
      chartType: 'table',
      dimensions: [],
      measures: [],
      rationale: 'Fallback raw table view for data exploration.',
    });
  }
  return recs;
}