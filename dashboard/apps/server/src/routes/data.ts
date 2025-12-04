import { Router } from 'express';
import { z } from 'zod';
import { executeQuery, getTableSchema, listTables, DatabaseError } from '../lib/db';

const router = Router();

// List user tables
router.get('/tables', async (_req, res) => {
  try {
    const tables = await listTables();
    res.json({ tables });
  } catch (err: any) {
    const payload: any = { error: 'Failed to list tables' };
    if (err instanceof DatabaseError) {
      payload.code = err.code || 'UNKNOWN';
      payload.details = err.details || String(err.message || err);
    } else {
      payload.details = String(err?.message || err);
    }
    res.status(500).json(payload);
  }
});

// Full schema details by owner (tables, columns, PKs, FKs, constraints, indexes)
router.get('/schema/:owner/details', async (req, res) => {
  try {
    const owner = String(req.params.owner || '').toUpperCase();
    if (!owner) return res.status(400).json({ error: 'Missing schema owner' });

    // Tables
    const tables = await executeQuery<{
      OWNER: string;
      TABLE_NAME: string;
      NUM_ROWS: number;
      LAST_ANALYZED: Date;
      COMMENTS: string;
    }>(
      `SELECT t.owner, t.table_name, t.num_rows, t.last_analyzed, c.comments
       FROM all_tables t
       LEFT JOIN all_tab_comments c ON c.owner = t.owner AND c.table_name = t.table_name
       WHERE t.owner = :1
       ORDER BY t.table_name`,
      [owner]
    );

    // Columns
    const columns = await executeQuery<{
      OWNER: string;
      TABLE_NAME: string;
      COLUMN_NAME: string;
      DATA_TYPE: string;
      DATA_LENGTH: number;
      DATA_PRECISION: number;
      DATA_SCALE: number;
      NULLABLE: string;
      COLUMN_ID: number;
    }>(
      `SELECT owner, table_name, column_name, data_type, data_length, data_precision, data_scale, nullable, column_id
       FROM all_tab_columns
       WHERE owner = :1
       ORDER BY table_name, column_id`,
      [owner]
    );

    // Primary key columns
    const pkColumns = await executeQuery<{
      OWNER: string;
      TABLE_NAME: string;
      CONSTRAINT_NAME: string;
      COLUMN_NAME: string;
      POSITION: number;
    }>(
      `SELECT ac.owner, ac.table_name, ac.constraint_name, acc.column_name, acc.position
       FROM all_constraints ac
       JOIN all_cons_columns acc ON ac.owner = acc.owner AND ac.constraint_name = acc.constraint_name
       WHERE ac.owner = :1 AND ac.constraint_type = 'P'
       ORDER BY ac.table_name, ac.constraint_name, acc.position`,
      [owner]
    );

    // Foreign key relationships (align columns by position)
    const fkRelations = await executeQuery<{
      OWNER: string;
      TABLE_NAME: string;
      CONSTRAINT_NAME: string;
      COLUMN_NAME: string;
      POSITION: number;
      R_OWNER: string;
      R_TABLE_NAME: string;
      R_COLUMN_NAME: string;
    }>(
      `SELECT ac.owner,
              ac.table_name,
              ac.constraint_name,
              acc.column_name,
              acc.position,
              ac.r_owner,
              rc.table_name AS r_table_name,
              rcc.column_name AS r_column_name
       FROM all_constraints ac
       JOIN all_cons_columns acc
         ON ac.owner = acc.owner AND ac.constraint_name = acc.constraint_name
       JOIN all_constraints rc
         ON ac.r_owner = rc.owner AND ac.r_constraint_name = rc.constraint_name
       JOIN all_cons_columns rcc
         ON rc.owner = rcc.owner AND rc.constraint_name = rcc.constraint_name AND acc.position = rcc.position
       WHERE ac.owner = :1 AND ac.constraint_type = 'R'
       ORDER BY ac.table_name, ac.constraint_name, acc.position`,
      [owner]
    );

    // Unique & Check constraints
    const otherConstraints = await executeQuery<{
      OWNER: string;
      TABLE_NAME: string;
      CONSTRAINT_NAME: string;
      CONSTRAINT_TYPE: string;
    }>(
      `SELECT owner, table_name, constraint_name, constraint_type
       FROM all_constraints
       WHERE owner = :1 AND constraint_type IN ('U','C')
       ORDER BY table_name, constraint_type, constraint_name`,
      [owner]
    );

    // Columns for Unique constraints (to know which columns are unique)
    const uniqueCols = await executeQuery<{
      OWNER: string;
      TABLE_NAME: string;
      CONSTRAINT_NAME: string;
      COLUMN_NAME: string;
      POSITION: number;
    }>(
      `SELECT acc.owner, acc.table_name, acc.constraint_name, acc.column_name, acc.position
       FROM all_constraints ac
       JOIN all_cons_columns acc ON ac.owner = acc.owner AND ac.constraint_name = acc.constraint_name
       WHERE ac.owner = :1 AND ac.constraint_type = 'U'
       ORDER BY acc.table_name, acc.constraint_name, acc.position`,
      [owner]
    );

    // Indexes and indexed columns
    const indexes = await executeQuery<{
      OWNER: string;
      TABLE_NAME: string;
      INDEX_NAME: string;
      UNIQUENESS: string;
    }>(
      `SELECT owner, table_name, index_name, uniqueness
       FROM all_indexes
       WHERE owner = :1
       ORDER BY table_name, index_name`,
      [owner]
    );
    const indexCols = await executeQuery<{
      INDEX_OWNER: string;
      TABLE_NAME: string;
      INDEX_NAME: string;
      COLUMN_NAME: string;
      COLUMN_POSITION: number;
    }>(
      `SELECT index_owner, table_name, index_name, column_name, column_position
       FROM all_ind_columns
       WHERE index_owner = :1
       ORDER BY table_name, index_name, column_position`,
      [owner]
    );

    res.json({
      owner,
      tables,
      columns,
      primaryKeys: pkColumns,
      foreignKeys: fkRelations,
      constraints: otherConstraints,
      uniqueConstraintColumns: uniqueCols,
      indexes,
      indexColumns: indexCols,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load schema details', details: String(err?.message || err) });
  }
});

// List columns for a table
router.get('/tables/:table/columns', async (req, res) => {
  try {
    const table = req.params.table.toUpperCase();
    const columns = await getTableSchema(table);
    res.json({ columns });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get columns', details: String(err?.message || err) });
  }
});

// Query data for charts using table/field selections (live Oracle)
const filterSchema = z.object({
  field: z.string(),
  op: z.enum(['=', '!=', '<', '>', '<=', '>=', 'IN', 'LIKE', 'BETWEEN', 'IS NULL', 'IS NOT NULL']),
  value: z.any().optional(),
  value2: z.any().optional(),
});

const querySchema = z.object({
  table: z.string().min(1),
  xField: z.string().min(1),
  yField: z.string().min(1),
  aggregator: z.enum(['NONE','SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'DISTINCTCOUNT']).optional(),
  y2Field: z.string().optional(),
  aggregator2: z.enum(['NONE','SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'DISTINCTCOUNT']).optional(),
  groupBy: z.array(z.string()).optional(),
  filters: z.array(filterSchema).optional(),
  sortBy: z.enum(['value', 'category']).optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  limit: z.number().min(1).max(10000).default(1000),
});

router.post('/query', async (req, res) => {
  const parsed = querySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });

  const cfg = parsed.data;
  const table = cfg.table.toUpperCase();
  const xField = cfg.xField.toUpperCase();
  const yField = cfg.yField.toUpperCase();
  const y2Field = cfg.y2Field ? cfg.y2Field.toUpperCase() : undefined;

  try {
    // Validate columns exist in table to prevent SQL injection
    const schemaCols = await getTableSchema(table);
    const colSet = new Set(schemaCols.map((c: any) => String(c.COLUMN_NAME || c.column_name).toUpperCase()));
    if (!colSet.has(xField) || !colSet.has(yField) || (y2Field && !colSet.has(y2Field))) {
      return res.status(400).json({ error: 'Selected fields not found in table' });
    }

    // Validate aggregator compatibility with column data types to avoid ORA-01722
    const findColType = (col: string) => {
      const m = schemaCols.find((c: any) => String(c.COLUMN_NAME || c.column_name).toUpperCase() === col);
      return String(m?.DATA_TYPE || m?.data_type || '').toUpperCase();
    };
    const isNumericType = (t: string) => ['NUMBER','FLOAT','INTEGER','DEC','DECIMAL','BINARY_FLOAT','BINARY_DOUBLE','NUMERIC'].includes(t);
    const yType = findColType(yField);
    const y2Type = y2Field ? findColType(y2Field) : undefined;
    const needsNumeric = (agg: string) => agg === 'SUM' || agg === 'AVG';
    if (cfg.aggregator && needsNumeric(cfg.aggregator) && !isNumericType(yType)) {
      return res.status(400).json({ error: `Aggregator ${cfg.aggregator} requires a numeric yField; got ${yType || 'UNKNOWN'}` });
    }
    if (y2Field && cfg.aggregator2 && needsNumeric(cfg.aggregator2) && !isNumericType(y2Type || '')) {
      return res.status(400).json({ error: `Aggregator ${cfg.aggregator2} requires a numeric y2Field; got ${y2Type || 'UNKNOWN'}` });
    }

    const aggExpr = (agg: string, field: string) => {
      if (agg === 'NONE' || !agg) return `${field}`;
      if (agg === 'COUNT') return `COUNT(${field})`;
      if (agg === 'DISTINCTCOUNT') return `COUNT(DISTINCT ${field})`;
      return `${agg}(${field})`;
    };

    const selectParts: string[] = [];
    selectParts.push(`${xField} AS X`);
    if (cfg.aggregator) selectParts.push(`${aggExpr(cfg.aggregator, yField)} AS Y`);
    else selectParts.push(`${yField} AS Y`);
    if (y2Field) {
      if (cfg.aggregator2) selectParts.push(`${aggExpr(cfg.aggregator2, y2Field)} AS Y2`);
      else selectParts.push(`${y2Field} AS Y2`);
    }

    const groupByFields = new Set<string>();
    (cfg.groupBy || []).forEach(f => {
      const F = f.toUpperCase();
      if (colSet.has(F)) groupByFields.add(F);
    });
    if ((cfg.aggregator && cfg.aggregator !== 'NONE') || (cfg.aggregator2 && cfg.aggregator2 !== 'NONE')) {
      groupByFields.add(xField);
    }

    const whereClauses: string[] = [];
    const params: any[] = [];
    (cfg.filters || []).forEach(fl => {
      const F = fl.field.toUpperCase();
      if (!colSet.has(F)) return;
      switch (fl.op) {
        case 'IS NULL':
          whereClauses.push(`${F} IS NULL`);
          break;
        case 'IS NOT NULL':
          whereClauses.push(`${F} IS NOT NULL`);
          break;
        case 'IN': {
          const vals = Array.isArray(fl.value) ? fl.value : [fl.value];
          const placeholders = vals.map(() => `:${params.length + 1}`);
          params.push(...vals);
          whereClauses.push(`${F} IN (${placeholders.join(', ')})`);
          break;
        }
        case 'BETWEEN': {
          params.push(fl.value);
          params.push(fl.value2);
          whereClauses.push(`${F} BETWEEN :${params.length - 1} AND :${params.length}`);
          break;
        }
        case 'LIKE': {
          params.push(fl.value);
          whereClauses.push(`${F} LIKE :${params.length}`);
          break;
        }
        default: {
          params.push(fl.value);
          whereClauses.push(`${F} ${fl.op} :${params.length}`);
          break;
        }
      }
    });

    const baseSelect = `SELECT ${selectParts.join(', ')} FROM ${table}`;
    const where = whereClauses.length ? ` WHERE ${whereClauses.join(' AND ')}` : '';
    const groupBy = groupByFields.size ? ` GROUP BY ${Array.from(groupByFields).join(', ')}` : '';
    const orderBy = cfg.sortBy === 'value' ? ` ORDER BY Y ${cfg.sortDir.toUpperCase()}` : ` ORDER BY X ${cfg.sortDir.toUpperCase()}`;

    // Oracle 11g top-N after ORDER BY requires subquery with ROWNUM
    const inner = `${baseSelect}${where}${groupBy}${orderBy}`;
    const sql = `SELECT * FROM (${inner}) WHERE ROWNUM <= :${params.length + 1}`;
    params.push(cfg.limit);

    const rows = await executeQuery<any>(sql, params);
    const columns = [{ name: 'X', type: 'VARCHAR2' }, { name: 'Y', type: (cfg.aggregator && cfg.aggregator !== 'NONE') ? 'NUMBER' : yType }];
    if (y2Field) columns.push({ name: 'Y2', type: (cfg.aggregator2 && cfg.aggregator2 !== 'NONE') ? 'NUMBER' : (y2Type || 'VARCHAR2') });
    return res.json({ columns, rows });
  } catch (err: any) {
    console.warn('Data query failed:', err?.code || 'UNKNOWN', err?.details?.sql || '');
    return res.status(500).json({ error: 'Data query failed', details: String(err?.message || err) });
  }
});

export default router;