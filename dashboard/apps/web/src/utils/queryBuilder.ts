export type Aggregation = 'sum' | 'avg' | 'count' | 'min' | 'max';
export type Operator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'IN' | 'LIKE' | 'BETWEEN' | 'IS NULL' | 'IS NOT NULL';

export type Filter = {
  table?: string;
  field: string;
  operator: Operator;
  value?: any;
};

export type Measure = {
  table?: string;
  field: string;
  aggregation: Aggregation;
  alias?: string;
};

export type Dimension = {
  table?: string;
  field: string;
  alias?: string;
};

export type Relationship = {
  fromTable: string;
  fromField: string;
  toTable: string;
  toField: string;
  joinType?: 'INNER' | 'LEFT' | 'RIGHT';
};

export type SchemaGraph = {
  tables: string[];
  relationships: Relationship[];
};

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'table' | 'heatmap';

export type ChartParams = {
  chartType: ChartType;
  dataSource: string; // base table
  dimensions: Dimension[];
  measures: Measure[];
  filters?: Filter[];
  relationships?: Relationship[]; // overrides schema relationships if provided
  limit?: number;
};

export type BuiltQuery = {
  sql: string;
  params: any[];
  signature: string; // normalized key for caching
};

function escapeIdentifier(id: string) {
  // Basic identifier escaping. Real implementation may depend on dialect.
  return '`' + id.replace(/`/g, '``') + '`';
}

function normalizeSelectAll(sql: string) {
  return sql.replace(/select\s+(all\s+columns|everything|all)\s+from/gi, 'SELECT * FROM');
}

export function buildSQL(params: ChartParams, schema?: SchemaGraph): BuiltQuery {
  const joins = (params.relationships ?? schema?.relationships ?? []).filter(r => r.fromTable && r.toTable);
  const base = escapeIdentifier(params.dataSource);

  const dimClauses = params.dimensions.map(d => {
    const table = escapeIdentifier(d.table ?? params.dataSource);
    const field = escapeIdentifier(d.field);
    const alias = d.alias ? ' AS ' + escapeIdentifier(d.alias) : '';
    return `${table}.${field}${alias}`;
  });

  const measClauses = params.measures.map(m => {
    const table = escapeIdentifier(m.table ?? params.dataSource);
    const field = escapeIdentifier(m.field);
    const agg = m.aggregation.toUpperCase();
    const alias = m.alias ? ' AS ' + escapeIdentifier(m.alias) : '';
    return `${agg}(${table}.${field})${alias}`;
  });

  const selectList = [...dimClauses, ...measClauses].join(', ');

  const joinClauses = joins.map(j => {
    const jt = j.joinType ?? 'INNER';
    return `${jt} JOIN ${escapeIdentifier(j.toTable)} ON ${escapeIdentifier(j.fromTable)}.${escapeIdentifier(j.fromField)} = ${escapeIdentifier(j.toTable)}.${escapeIdentifier(j.toField)}`;
  });

  const whereParams: any[] = [];
  const whereClauses = (params.filters ?? []).map((f, idx) => {
    const table = escapeIdentifier(f.table ?? params.dataSource);
    const field = `${table}.${escapeIdentifier(f.field)}`;
    const op = f.operator.toUpperCase();
    if (op === 'IS NULL' || op === 'IS NOT NULL') {
      return `${field} ${op}`;
    }
    if (op === 'IN' && Array.isArray(f.value)) {
      const placeholders = f.value.map((_, i) => `?`).join(', ');
      whereParams.push(...f.value);
      return `${field} IN (${placeholders})`;
    }
    if (op === 'BETWEEN' && Array.isArray(f.value) && f.value.length === 2) {
      whereParams.push(f.value[0], f.value[1]);
      return `${field} BETWEEN ? AND ?`;
    }
    whereParams.push(f.value);
    return `${field} ${op} ?`;
  });

  // GROUP BY all dimensions for aggregated charts
  const groupBy = params.measures.length > 0 && params.dimensions.length > 0
    ? ' GROUP BY ' + params.dimensions.map(d => `${escapeIdentifier(d.table ?? params.dataSource)}.${escapeIdentifier(d.field)}`).join(', ')
    : '';

  const limitClause = params.limit ? ` LIMIT ${Number(params.limit)}` : '';

  let sql = `SELECT ${selectList || '*'} FROM ${base}`;
  if (joinClauses.length) sql += ' ' + joinClauses.join(' ');
  if (whereClauses.length) sql += ' WHERE ' + whereClauses.join(' AND ');
  sql += groupBy + limitClause;
  sql = normalizeSelectAll(sql);

  const signature = JSON.stringify({ sql, params: whereParams });

  return { sql, params: whereParams, signature };
}

export function recommendAggregations(chartType: ChartType, measures: string[]): Aggregation[] {
  if (chartType === 'pie') return ['sum'];
  if (chartType === 'scatter') return ['avg'];
  return ['sum', 'count'];
}

export function buildDrilldownSQL(params: ChartParams, drillField: Dimension): BuiltQuery {
  const next: ChartParams = {
    ...params,
    dimensions: [...params.dimensions, drillField],
  };
  return buildSQL(next);
}