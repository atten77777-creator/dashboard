import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Store } from '../lib/store';
import { executeQuery, getTableSchema } from '../lib/db';
import { stripLimitClauses, rewriteTopN } from '../lib/query-utils';

const router = Router({ mergeParams: true });

const createChartSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.any()).default({}),
  position: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
});

router.post('/', (req: Request<{ dashboardId: string }>, res: Response) => {
  const parsed = createChartSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad Request', issues: parsed.error.issues });
  const chart = Store.createChart(req.params.dashboardId, parsed.data as any);
  if (!chart) return res.status(404).json({ error: 'Dashboard Not Found' });
  return res.status(201).json({ chart });
});

const updateChartSchema = z.object({
  name: z.string().optional(),
  config: z.record(z.any()).optional(),
  position: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
});

router.put('/:chartId', (req: Request<{ dashboardId: string; chartId: string }>, res: Response) => {
  const parsed = updateChartSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Bad Request', issues: parsed.error.issues });
  const chart = Store.updateChart(req.params.dashboardId, req.params.chartId, parsed.data);
  if (!chart) return res.status(404).json({ error: 'Not Found' });
  return res.json({ chart });
});

router.delete('/:chartId', (req: Request<{ dashboardId: string; chartId: string }>, res: Response) => {
  const ok = Store.deleteChart(req.params.dashboardId, req.params.chartId);
  if (!ok) return res.status(404).json({ error: 'Not Found' });
  return res.status(200).json({ ok: true });
});

router.get('/:chartId/data', async (req: Request<{ dashboardId: string; chartId: string }>, res: Response) => {
  try {
    const chart = Store.getChart(req.params.dashboardId, req.params.chartId);
    if (!chart) return res.status(404).json({ error: 'Not Found' });
    const cfg: any = chart.config || {};
    const type = String(chart.type || '').toLowerCase();

    // Prioritize SQL/live data execution to ensure updates to the query (e.g. via chart editor)
    // are reflected immediately. Only fall back to static dataOverride if no SQL is provided.
    if (cfg.sqlQuery && String(cfg.sqlQuery).trim().length > 0) {
      const limitRaw = cfg.limit;
      const hasLimit = Number.isFinite(limitRaw) && Number(limitRaw) > 0;
      // Remove any existing LIMIT/FETCH clauses if we are applying our own limit wrapper
      // to avoid syntax errors or conflicts.
      const original = hasLimit 
        ? stripLimitClauses(cfg.sqlQuery) 
        : String(cfg.sqlQuery).trim().replace(/;+\s*$/, '');

      let rows: any[] = [];
      if (hasLimit) {
        const sql = `SELECT * FROM (${original}) WHERE ROWNUM <= :1`;
        rows = await executeQuery<any>(sql, [Number(limitRaw)]);
      } else {
        // If no limit is enforced by chart config, run the original query (which might have its own FETCH clause)
        rows = await executeQuery<any>(rewriteTopN(cfg.sqlQuery));
      }
      const columnNames = rows.length > 0 ? Object.keys(rows[0]) : [];
      const columns = columnNames.map(name => ({ name }));
      return res.json({ columns, rows });
    }

    // Use static dataOverride if present (e.g., charts saved from chat with cached results)
    // when no live SQL query is available.
    if (cfg.dataOverride && Array.isArray(cfg.dataOverride.rows) && cfg.dataOverride.rows.length > 0) {
      const colsRaw = cfg.dataOverride.columns || [];
      const columns = Array.isArray(colsRaw)
        ? colsRaw.map((c: any) => (typeof c === 'string' ? { name: c } : c))
        : [];
      const rows = Array.isArray(cfg.dataOverride.rows) ? cfg.dataOverride.rows : [];
      return res.json({ columns, rows });
    }
    // Fallback to static dataOverride when present but empty (rare), or when no SQL is provided
    if (cfg.dataOverride && Array.isArray(cfg.dataOverride.rows)) {
      const colsRaw = cfg.dataOverride.columns || [];
      const columns = Array.isArray(colsRaw)
        ? colsRaw.map((c: any) => (typeof c === 'string' ? { name: c } : c))
        : [];
      const rows = Array.isArray(cfg.dataOverride.rows) ? cfg.dataOverride.rows : [];
      return res.json({ columns, rows });
    }

    const table = String(cfg.table || '').toUpperCase();
    const xFieldRaw = String(cfg.xField || '').toUpperCase();
    const yFieldRaw = String(cfg.yField || '').toUpperCase();
    const y2Field = cfg.y2Field ? String(cfg.y2Field).toUpperCase() : undefined;

    if (!table) return res.status(400).json({ error: 'Chart config missing table' });

    // Validate columns exist
    const schemaCols = await getTableSchema(table);
    const colSet = new Set(schemaCols.map((c: any) => String(c.COLUMN_NAME || c.column_name).toUpperCase()));

    const ensureCol = (col: string) => !!col && colSet.has(col);

    // Common filter processing
    const whereClauses: string[] = [];
    const params: any[] = [];
    (cfg.filters || []).forEach((fl: any) => {
      const F = String(fl.field || '').toUpperCase();
      if (!colSet.has(F)) return;
      const op = String(fl.op || '=').toUpperCase();
      switch (op) {
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
          whereClauses.push(`${F} ${op} :${params.length}`);
          break;
        }
      }
    });
    const where = whereClauses.length ? ` WHERE ${whereClauses.join(' AND ')}` : '';

    const limitRaw = cfg.limit;
    const hasLimit = Number.isFinite(limitRaw) && Number(limitRaw) > 0;

    const aggExpr = (agg: string, field: string) => {
      const A = String(agg || '').toUpperCase();
      if (A === 'NONE' || !A) return `${field}`;
      if (A === 'COUNT') return `COUNT(${field})`;
      if (A === 'DISTINCTCOUNT') return `COUNT(DISTINCT ${field})`;
      return `${A}(${field})`;
    };

    // scatter: raw X,Y pairs
    if (type === 'scatter') {
      const xField = xFieldRaw;
      const yField = yFieldRaw;
      if (!ensureCol(xField) || !ensureCol(yField))
        return res.status(400).json({ error: 'Chart config missing valid xField/yField' });
      const baseSelect = `SELECT ${xField} AS X, ${yField} AS Y FROM ${table}`;
      const orderBy = ` ORDER BY X ASC`;
      const inner = `${baseSelect}${where}${orderBy}`;
      let rows: any[] = [];
      if (hasLimit) {
        const sql = `SELECT * FROM (${inner}) WHERE ROWNUM <= :${params.length + 1}`;
        params.push(Number(limitRaw));
        rows = await executeQuery<any>(sql, params);
      } else {
        rows = await executeQuery<any>(inner, params);
      }
      const columns: any[] = [{ name: 'X', type: 'NUMBER' }, { name: 'Y', type: 'NUMBER' }];
      return res.json({ columns, rows });
    }

    // histogram: raw values (Y); synthesize X = row index
    if (type === 'histogram') {
      const measure = yFieldRaw || xFieldRaw;
      if (!ensureCol(measure))
        return res.status(400).json({ error: 'Chart config missing valid measure column for histogram' });
      const baseSelect = `SELECT ROWNUM AS X, ${measure} AS Y FROM ${table}`;
      const orderBy = ` ORDER BY Y ASC`;
      const inner = `${baseSelect}${where}${orderBy}`;
      let rows: any[] = [];
      if (hasLimit) {
        const sql = `SELECT * FROM (${inner}) WHERE ROWNUM <= :${params.length + 1}`;
        params.push(Number(limitRaw));
        rows = await executeQuery<any>(sql, params);
      } else {
        rows = await executeQuery<any>(inner, params);
      }
      const columns: any[] = [{ name: 'X', type: 'NUMBER' }, { name: 'Y', type: 'NUMBER' }];
      return res.json({ columns, rows });
    }

    // number: single aggregate on measure
    if (type === 'number') {
      const measure = yFieldRaw || xFieldRaw;
      if (!ensureCol(measure))
        return res.status(400).json({ error: 'Chart config missing valid measure column for number' });
      const agg = String(cfg.aggregation?.y || cfg.aggregator || 'SUM').toUpperCase();
      const sql = `SELECT 'TOTAL' AS X, ${aggExpr(agg, measure)} AS Y FROM ${table}${where}`;
      const rows = await executeQuery<any>(sql, params);
      const columns: any[] = [{ name: 'X', type: 'VARCHAR2' }, { name: 'Y', type: 'NUMBER' }];
      return res.json({ columns, rows: Array.isArray(rows) ? rows.slice(0, 1) : [] });
    }

    // default aggregated path (bar/line/pie/etc.)
    const xField = xFieldRaw;
    const yField = yFieldRaw;
    const aggregator = String(cfg.aggregation?.y || cfg.aggregator || 'SUM').toUpperCase();
    // Support both nested cfg.aggregation.y2 and top-level cfg.aggregator2 saved from ChartBuilderModal
    const aggregator2 = (y2Field && (cfg.aggregation?.y2 || cfg.aggregator2)) ? String(cfg.aggregation?.y2 || cfg.aggregator2).toUpperCase() : undefined;

    if (!ensureCol(xField) || !ensureCol(yField))
      return res.status(400).json({ error: 'Chart config missing xField/yField' });

    const findColType = (col: string) => String(schemaCols.find((c: any) => String(c.COLUMN_NAME || c.column_name).toUpperCase() === col)?.DATA_TYPE || '').toUpperCase();
    const isNumericType = (t: string) => ['NUMBER','FLOAT','INTEGER','DEC','DECIMAL','BINARY_FLOAT','BINARY_DOUBLE','NUMERIC'].includes(t);
    const yType = findColType(yField);
    const y2Type = y2Field ? findColType(y2Field) : undefined;
    const needsNumeric = (agg?: string) => agg === 'SUM' || agg === 'AVG';
    if (needsNumeric(aggregator) && !isNumericType(yType)) {
      return res.status(400).json({ error: `Aggregator ${aggregator} requires numeric yField; got ${yType || 'UNKNOWN'}` });
    }
    if (y2Field && aggregator2 && needsNumeric(aggregator2) && !isNumericType(y2Type || '')) {
      return res.status(400).json({ error: `Aggregator ${aggregator2} requires numeric y2Field; got ${y2Type || 'UNKNOWN'}` });
    }

    const selectParts: string[] = [];
    selectParts.push(`${xField} AS X`);
    selectParts.push(`${aggExpr(aggregator, yField)} AS Y`);
    if (y2Field && aggregator2 && ensureCol(y2Field)) selectParts.push(`${aggExpr(aggregator2, y2Field)} AS Y2`);

    const groupByFields = new Set<string>();
    (cfg.groupBy || []).forEach((f: string) => {
      const F = f.toUpperCase();
      if (colSet.has(F)) groupByFields.add(F);
    });
    if ((aggregator && aggregator !== 'NONE') || (aggregator2 && aggregator2 !== 'NONE')) {
      groupByFields.add(xField);
    }

    const baseSelect = `SELECT ${selectParts.join(', ')} FROM ${table}`;
    const groupBy = groupByFields.size ? ` GROUP BY ${Array.from(groupByFields).join(', ')}` : '';
    const sortBy = (cfg.sort?.by === 'value' ? 'Y' : 'X');
    const sortDir = (cfg.sort?.direction || 'asc').toUpperCase();
    const orderBy = ` ORDER BY ${sortBy} ${sortDir}`;

    const inner = `${baseSelect}${where}${groupBy}${orderBy}`;
    let rows: any[] = [];
    if (hasLimit) {
      const sql = `SELECT * FROM (${inner}) WHERE ROWNUM <= :${params.length + 1}`;
      params.push(Number(limitRaw));
      rows = await executeQuery<any>(sql, params);
    } else {
      rows = await executeQuery<any>(inner, params);
    }
    const columns: any[] = [{ name: 'X', type: 'VARCHAR2' }, { name: 'Y', type: (aggregator && aggregator !== 'NONE') ? 'NUMBER' : (yType || 'VARCHAR2') }];
    if (y2Field && aggregator2) columns.push({ name: 'Y2', type: (aggregator2 && aggregator2 !== 'NONE') ? 'NUMBER' : (y2Type || 'VARCHAR2') });
    return res.json({ columns, rows });
  } catch (err: any) {
    console.error('Chart data error:', err);
    return res.status(500).json({ error: 'Failed to load chart data', details: String(err?.message || err) });
  }
});

export default router;
