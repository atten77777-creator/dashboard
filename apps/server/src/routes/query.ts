import { Router } from 'express';
import { z } from 'zod';
import { executeQuery, executeQueryAll, listTables, getTableSchema, DatabaseError } from '../lib/db';
import { schemaStore } from '../lib/schema-store';
import { isSimpleTableSelect, stripLimitClauses, validateDatasetCompleteness, detectFormattingIssues } from '../lib/query-utils';
import { logValidationFailure, logQueryError } from '../lib/logger';

const router = Router();

// Util: Oracle 11g rewrite for FETCH FIRST N ROWS ONLY
function rewriteTopN(sql: string): string {
  const originalSql = sql.trim().replace(/;+\s*$/, '');
  let sqlToRun = originalSql;
  const m = sqlToRun.match(/FETCH\s+FIRST\s+(\d+)\s+ROWS\s+ONLY/i);
  if (m) {
    const n = m[1];
    const base = sqlToRun.replace(/FETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\s*$/i, '').trim();
    // Always wrap to preserve clause order (GROUP BY/HAVING/ORDER BY) and apply ROWNUM safely
    sqlToRun = `SELECT * FROM (${base}) WHERE ROWNUM <= ${n}`;
  }
  // Rewrite trailing LIMIT N (MySQL/Postgres) to ROWNUM <= N
  const mLimit = sqlToRun.match(/\bLIMIT\s+(\d+)\s*$/i);
  if (mLimit) {
    const n = mLimit[1];
    const base = sqlToRun.replace(/\bLIMIT\s+\d+\s*$/i, '').trim();
    sqlToRun = `SELECT * FROM (${base}) WHERE ROWNUM <= ${n}`;
  }
  return sqlToRun;
}

// Execute SQL against Oracle (stateless)
router.post('/execute', async (req, res) => {
  const body = z.object({ sql: z.string().min(1), full: z.boolean().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query', issues: parsed.error.issues });

  const start = Date.now();
  try {
    const rawSql = parsed.data.sql.trim().replace(/;+\s*$/, '');
    const sql = parsed.data.full ? stripLimitClauses(rawSql) : rewriteTopN(rawSql);
    const rows = parsed.data.full ? await executeQueryAll(sql) : await executeQuery(sql);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    // Validation: if full dataset requested and it's a simple table select, verify completeness
    let validation: any = undefined;
    const simple = parsed.data.full ? isSimpleTableSelect(sql) : null;
    if (simple?.table) {
      try {
        const cntRows = await executeQuery(`SELECT COUNT(*) AS CNT FROM ${simple.table}`);
        const expected = Number((cntRows[0] as any)?.CNT || 0);
        validation = validateDatasetCompleteness(rows, expected);
        if (!validation.complete) {
          logValidationFailure('Full dataset retrieval incomplete', { table: simple.table, validation }, { route: 'query.execute', sql });
        }
      } catch (e) {
        logQueryError('Failed to validate row count', e, { route: 'query.execute', sql });
      }
    }

    // Detect potential formatting issues
    const fmtIssues = detectFormattingIssues(rows);
    if (fmtIssues.length) {
      logValidationFailure('Potential formatting issues detected', { issues: fmtIssues.slice(0, 5) }, { route: 'query.execute', sql });
      validation = { ...(validation || {}), formattingIssues: fmtIssues.length };
    }

    // Stateless: no history persistence
    res.json({ columns, rows, validation });
  } catch (err: any) {
    // Stateless: no history persistence
    const details = err instanceof DatabaseError ? err.details : undefined;
    res.status(400).json({ error: 'Query execution failed', code: err.code || 'UNKNOWN', details });
  }
});

// Export SQL result as CSV file
router.post('/export', async (req, res) => {
  const body = z.object({ sql: z.string().min(1), format: z.enum(['csv']).default('csv'), filename: z.string().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid export request', issues: parsed.error.issues });
  try {
    const rawSql = parsed.data.sql.trim().replace(/;+\s*$/, '');
    const sql = rewriteTopN(rawSql);
    const rows = await executeQuery(sql);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const csv = toCSV(columns, rows);
    const filename = parsed.data.filename || `export_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err: any) {
    const details = err instanceof DatabaseError ? err.details : undefined;
    res.status(400).json({ error: 'Export failed', code: err.code || 'UNKNOWN', details });
  }
});

// Schema for SQL Runner
router.get('/schema', async (_req, res) => {
  try {
    await schemaStore.refreshSchema();
    const tables = schemaStore.getAllTables();
    res.json({ tables });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load schema', details: String(err?.message || err) });
  }
});

// Filters: get distinct values for a field
router.get('/filters/distinct', async (req, res) => {
  const q = z.object({ table: z.string().min(1), field: z.string().min(1), limit: z.string().optional() });
  const parsed = q.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Bad Request', issues: parsed.error.issues });
  try {
    const table = String(parsed.data.table).toUpperCase();
    const field = String(parsed.data.field).toUpperCase();
    const limit = parsed.data.limit ? Number(parsed.data.limit) : 100;
    const sql = `SELECT DISTINCT ${field} AS VALUE FROM ${table} WHERE ${field} IS NOT NULL ORDER BY VALUE FETCH FIRST ${limit} ROWS ONLY`;
    const rows = await executeQuery(sql);
    res.json({ values: rows.map(r => (r as any).VALUE) });
  } catch (err: any) {
    const details = err instanceof DatabaseError ? err.details : undefined;
    res.status(400).json({ error: 'Failed to fetch distinct values', code: err.code || 'UNKNOWN', details });
  }
});

// Tables
router.get('/tables', async (_req, res) => {
  try {
    const tables = await listTables();
    res.json({ tables });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list tables', details: String(err?.message || err) });
  }
});

// Table schema
router.get('/schema/table/:name', async (req, res) => {
  try {
    const name = String(req.params.name || '').toUpperCase();
    if (!name) return res.status(400).json({ error: 'Missing table name' });
    const schema = await getTableSchema(name);
    res.json({ table: name, schema });
  } catch (err: any) {
    const details = err instanceof DatabaseError ? err.details : undefined;
    res.status(400).json({ error: 'Failed to fetch schema', code: err.code || 'UNKNOWN', details });
  }
});

// Fetch all rows from a table with validation
router.get('/table-all', async (req, res) => {
  const q = z.object({ table: z.string().min(1) });
  const parsed = q.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Bad Request', issues: parsed.error.issues });
  try {
    const table = parsed.data.table.toUpperCase();
    const countRows = await executeQuery(`SELECT COUNT(*) AS CNT FROM ${table}`);
    const expected = Number((countRows[0] as any)?.CNT || 0);
    const rows = await executeQueryAll(`SELECT * FROM ${table}`);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    let validation: any = validateDatasetCompleteness(rows, expected);
    if (!validation.complete) {
      logValidationFailure('Table-all retrieval incomplete', { table, validation }, { route: 'table-all', sql: `SELECT * FROM ${table}` });
    }
    const fmtIssues = detectFormattingIssues(rows);
    if (fmtIssues.length) {
      validation = { ...validation, formattingIssues: fmtIssues.length };
    }
    res.json({ columns, rows, validation });
  } catch (err: any) {
    logQueryError('Table-all retrieval error', err, { route: 'table-all' });
    res.status(400).json({ error: 'Failed to fetch table', details: String(err?.message || err) });
  }
});

function toCSV(columns: string[], rows: any[]): string {
  const escape = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = columns.join(',');
  const body = rows.map(r => columns.map(c => escape((r as any)[c])).join(',')).join('\n');
  return header + '\n' + body;
}

export default router;
