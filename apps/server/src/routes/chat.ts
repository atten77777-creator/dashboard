import { Router } from 'express';
import { z } from 'zod';
import { executeQueryWithOptions, executeQueryAllWithOptions } from '../lib/db.extra';
import { executeQuery, executeQueryAll, DatabaseError } from '../lib/db';
import { recommendChartsForTables } from '../lib/viz-recommender';
import { isSimpleTableSelect, stripLimitClauses, validateDatasetCompleteness, detectFormattingIssues } from '../lib/query-utils';
import { logValidationFailure, logQueryError } from '../lib/logger';

const router = Router();

function rewriteTopN(sql: string): string {
  const originalSql = sql.trim().replace(/;+\s*$/, '');
  let sqlToRun = originalSql;
  const m = sqlToRun.match(/FETCH\s+FIRST\s+(\d+)\s+ROWS\s+ONLY/i);
  if (m) {
    const n = m[1];
    const base = sqlToRun.replace(/FETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\s*$/i, '').trim();
    sqlToRun = `SELECT * FROM (${base}) WHERE ROWNUM <= ${n}`;
  }
  const mLimit = sqlToRun.match(/\bLIMIT\s+(\d+)\s*$/i);
  if (mLimit) {
    const n = mLimit[1];
    const base = sqlToRun.replace(/\bLIMIT\s+\d+\s*$/i, '').trim();
    sqlToRun = `SELECT * FROM (${base}) WHERE ROWNUM <= ${n}`;
  }
  return sqlToRun;
}

// Stateless SQL execution
router.post('/execute-sql', async (req, res) => {
  const body = z.object({
    sql: z.string().min(1),
    full: z.boolean().optional(),
    limit: z.number().int().positive().max(100000).optional(),
    timeoutMs: z.number().int().positive().max(600000).optional()
  });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query', issues: parsed.error.issues });

  try {
    const rawSql = parsed.data.sql.trim().replace(/;+\s*$/, '');
    let sql = parsed.data.full ? stripLimitClauses(rawSql) : rewriteTopN(rawSql);
    // Apply client-provided limit via ROWNUM, if not already present and not full retrieval
    if (!parsed.data.full && typeof parsed.data.limit === 'number' && parsed.data.limit > 0) {
      const n = parsed.data.limit;
      if (!/\bROWNUM\s*<=\s*\d+/i.test(sql)) {
        sql = `SELECT * FROM (${sql}) WHERE ROWNUM <= ${n}`;
      } else {
        sql = sql.replace(/\bROWNUM\s*<=\s*\d+/i, `ROWNUM <= ${n}`);
      }
    }
    const rows = parsed.data.full
      ? await executeQueryAllWithOptions(sql, [], { timeoutMs: Number(parsed.data.timeoutMs ?? 60000) })
      : await executeQueryWithOptions(sql, [], { timeoutMs: Number(parsed.data.timeoutMs ?? 15000), maxRows: Number(parsed.data.limit ?? 1000) });
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    let validation: any = undefined;
    const simple = parsed.data.full ? isSimpleTableSelect(sql) : null;
    if (simple?.table) {
      try {
        const cntRows = await executeQuery(`SELECT COUNT(*) AS CNT FROM ${simple.table}`);
        const expected = Number((cntRows[0] as any)?.CNT || 0);
        validation = validateDatasetCompleteness(rows, expected);
        if (!validation.complete) {
          logValidationFailure('Full dataset retrieval incomplete', { table: simple.table, validation }, { route: 'chat.execute-sql', sql });
        }
      } catch (e) {
        logQueryError('Failed to validate row count', e, { route: 'chat.execute-sql', sql });
      }
    }

    const fmtIssues = detectFormattingIssues(rows);
    if (fmtIssues.length) {
      logValidationFailure('Potential formatting issues detected', { issues: fmtIssues.slice(0, 5) }, { route: 'chat.execute-sql', sql });
      validation = { ...(validation || {}), formattingIssues: fmtIssues.length };
    }

    res.json({ columns, rows, validation });
  } catch (err: any) {
    const details = err instanceof DatabaseError ? err.details : undefined;
    res.status(400).json({ error: 'Query execution failed', code: (err as any).code || 'UNKNOWN', details });
  }
});

// Stateless data analysis: chart recommendations from table names
router.post('/analyze-data', async (req, res) => {
  const body = z.object({ tables: z.array(z.string().min(1)).min(1), goal: z.string().optional() });
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid analyze request', issues: parsed.error.issues });
  try {
    const { dashboardName, dashboardDescription, chartDefinitions } = await recommendChartsForTables(parsed.data.tables, parsed.data.goal);
    res.json({ dashboardName, dashboardDescription, chartDefinitions });
  } catch (err: any) {
    res.status(500).json({ error: 'Analysis failed', details: String(err?.message || err) });
  }
});

export default router;
