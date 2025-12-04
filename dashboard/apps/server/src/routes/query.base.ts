import { Router } from 'express';
import { z } from 'zod';
import { executeQuery, executeQueryAll, listTables, getTableSchema, DatabaseError } from '../lib/db';
import { stripLimitClauses } from '../lib/query-utils';
import { schemaStore } from '../lib/schema-store';
import { Store } from '../lib/store';

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
  return sqlToRun;
}

// Util: convert rows to CSV string
function toCSV(columns: string[], rows: any[]): string {
  const esc = (v: any) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = columns.join(',');
  const lines = rows.map(r => columns.map(c => esc(r[c])).join(','));
  return [header, ...lines].join('\n');
}

// Execute SQL against Oracle
router.post('/execute', async (req, res) => {
  const body = z.object({ sql: z.string().min(1), full: z.boolean().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query', issues: parsed.error.issues });

  const start = Date.now();
  try {
    const original = parsed.data.sql.trim().replace(/;+\s*$/, '');
    const sql = parsed.data.full ? stripLimitClauses(original) : rewriteTopN(original);
    const rows = parsed.data.full ? await executeQueryAll(sql) : await executeQuery(sql);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    Store.addQueryHistory({ sql: parsed.data.sql, elapsedMs: Date.now() - start, rowsCount: rows.length });
    res.json({ columns, rows });
  } catch (err: any) {
    Store.addQueryHistory({ sql: parsed.data.sql, elapsedMs: Date.now() - start, rowsCount: 0, error: String(err?.message || err) });
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
    const sql = rewriteTopN(parsed.data.sql);
    const rows = await executeQuery(sql);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const csv = toCSV(columns, rows);
    const filename = (parsed.data.filename || 'query-results.csv').replace(/[^a-z0-9._-]/gi, '_');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err: any) {
    res.status(400).json({ error: 'Export failed', code: err.code || 'UNKNOWN', details: err.details });
  }
});

// Query history
router.get('/history', (req, res) => {
  const limit = Number(req.query.limit || 50);
  const items = Store.listQueryHistory(limit);
  res.json({ history: items });
});

// Saved queries
router.get('/saved', (_req, res) => {
  res.json({ saved: Store.listSavedQueries() });
});
router.post('/save', (req, res) => {
  const body = z.object({ name: z.string().min(1), sql: z.string().min(1), description: z.string().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const saved = Store.saveQuery(parsed.data.name, parsed.data.sql, parsed.data.description);
  res.status(201).json(saved);
});

// Share queries
router.post('/share', (req, res) => {
  const body = z.object({ savedId: z.string().optional(), name: z.string().optional(), sql: z.string().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  const shared = Store.shareQuery(parsed.data);
  if (!shared) return res.status(404).json({ error: 'Not Found' });
  res.status(201).json(shared);
});
router.get('/share/:id', (req, res) => {
  const s = Store.getSharedQuery(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not Found' });
  res.json(s);
});

// Preferences
router.get('/prefs', (_req, res) => {
  res.json(Store.getPreferences());
});
router.post('/prefs', (req, res) => {
  const body = z.object({ defaultLimit: z.number().optional(), pageSize: z.number().optional(), theme: z.enum(['light', 'dark', 'system']).optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid preferences', issues: parsed.error.issues });
  const updated = Store.updatePreferences(parsed.data);
  res.json(updated);
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
    const table = parsed.data.table.toUpperCase();
    const field = parsed.data.field.toUpperCase();
    const limit = Number(parsed.data.limit || 100);
    const sql = `SELECT DISTINCT ${field} AS VALUE FROM ${table} WHERE ROWNUM <= ${limit}`;
    const rows = await executeQuery(sql);
    res.json({ values: rows.map(r => (r as any).VALUE) });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to fetch distinct values', details: String(err?.message || err) });
  }
});

// SQL preview executes against Oracle and returns real data or an error
router.post('/preview', async (req, res) => {
  const body = z.object({ sql: z.string().min(1), full: z.boolean().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Empty query', issues: parsed.error.issues });

  const start = Date.now();
  try {
    const original = parsed.data.sql.trim().replace(/;+\s*$/, '');
    const sql = parsed.data.full ? stripLimitClauses(original) : rewriteTopN(original);
    const rows = parsed.data.full ? await executeQueryAll(sql) : await executeQuery(sql);
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    res.json({ columns, rows });
  } catch (err: any) {
    const details = err instanceof DatabaseError ? err.details : undefined;
    res.status(400).json({ error: 'Query preview failed', code: err.code || 'UNKNOWN', details });
  }
});

// Basic suggestions endpoint (placeholder)
router.post('/suggest', async (req, res) => {
  const body = z.object({ table: z.string().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  try {
    const tables = await listTables();
    const table = parsed.data.table?.toUpperCase() || (tables[0]?.TABLE_NAME || 'DUAL');
    const suggestions = [
      `SELECT * FROM ${table}`,
      `SELECT COUNT(*) AS CNT FROM ${table}`,
    ];
    res.json({ suggestions });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate suggestions', details: String(err?.message || err) });
  }
});

export default router;
