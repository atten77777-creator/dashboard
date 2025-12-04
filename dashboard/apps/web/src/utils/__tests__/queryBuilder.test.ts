import { describe, it, expect } from 'vitest';
import { buildSQL, ChartParams, SchemaGraph } from '../queryBuilder';

describe('queryBuilder', () => {
  const schema: SchemaGraph = {
    tables: ['orders', 'customers'],
    relationships: [
      { fromTable: 'orders', fromField: 'customer_id', toTable: 'customers', toField: 'id', joinType: 'INNER' },
    ],
  };

  it('builds SELECT with joins, filters, and aggregation', () => {
    const params: ChartParams = {
      chartType: 'bar',
      dataSource: 'orders',
      dimensions: [{ field: 'status' }],
      measures: [{ field: 'amount', aggregation: 'sum' }],
      filters: [{ field: 'created_at', operator: 'BETWEEN', value: ['2024-01-01', '2024-12-31'] }],
      relationships: schema.relationships,
      limit: 100,
    };
    const built = buildSQL(params, schema);
    expect(built.sql.toUpperCase()).toContain('SELECT');
    expect(built.sql.toUpperCase()).toContain('JOIN');
    expect(built.sql.toUpperCase()).toContain('GROUP BY');
    expect(built.sql.toUpperCase()).toContain('LIMIT 100');
    expect(built.params.length).toBe(2);
  });

  it('normalizes common select-all phrasing', () => {
    const params: ChartParams = {
      chartType: 'table', dataSource: 'orders', dimensions: [], measures: [], filters: []
    } as any;
    const built = buildSQL(params, schema);
    const normalized = built.sql.replace(/SELECT\s+\*\s+FROM/i, 'SELECT * FROM');
    expect(normalized).toMatch(/SELECT \* FROM [`"]orders[`"]?/i);
  });
});