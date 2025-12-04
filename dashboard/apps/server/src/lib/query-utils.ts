// Utility functions for query processing and safe serialization

export function normalizeRows<T = any>(rows: T[]): T[] {
  return rows.map((row: any) => {
    const out: Record<string, any> = {};
    for (const key of Object.keys(row || {})) {
      const v = (row as any)[key];
      if (v == null) {
        out[key] = v;
      } else if (v instanceof Date) {
        out[key] = v.toISOString();
      } else if (Buffer.isBuffer(v)) {
        out[key] = v.toString('base64');
      } else if (typeof v === 'object') {
        // Prevent [object Object] rendering by serializing nested structures
        try {
          out[key] = JSON.stringify(v);
        } catch {
          out[key] = String(v);
        }
      } else {
        out[key] = v;
      }
    }
    return out as T;
  });
}

// Detect simple SELECT * FROM <table> queries (optionally quoted owner.table)
export function isSimpleTableSelect(sql: string): { table: string } | null {
  const s = String(sql || '').trim().replace(/;+\s*$/, '');
  // Remove wrapping parentheses
  const stripped = s.replace(/^\(\s*/, '').replace(/\s*\)$/, '');
  const re = /^SELECT\s+\*\s+FROM\s+([A-Za-z0-9_\."]+)\s*(?:;)?$/i;
  const m = stripped.match(re);
  if (!m) return null;
  let tbl = m[1].replace(/"/g, '');
  // owner.table -> table
  if (tbl.includes('.')) tbl = tbl.split('.')[1];
  return tbl ? { table: tbl.toUpperCase() } : null;
}

// Strip LIMIT/FETCH FIRST clauses entirely for full dataset retrieval
export function stripLimitClauses(sql: string): string {
  let s = String(sql || '').trim().replace(/;+\s*$/, '');
  s = s.replace(/FETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\s*$/i, '');
  s = s.replace(/\bLIMIT\s+\d+\s*$/i, '');
  return s.trim();
}

// Oracle 11g rewrite for FETCH FIRST N ROWS ONLY
export function rewriteTopN(sql: string): string {
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

// Validate completeness: does actual count match expected count?
export function validateDatasetCompleteness(rows: any[], expectedCount: number) {
  const actual = Array.isArray(rows) ? rows.length : 0;
  return {
    complete: actual === expectedCount,
    expectedCount,
    actualCount: actual
  };
}

// Detect potential formatting issues that could lead to "[object Object]"
export function detectFormattingIssues(rows: any[]): Array<{ rowIndex: number; column: string; type: string }> {
  const issues: Array<{ rowIndex: number; column: string; type: string }> = [];
  rows.forEach((r, i) => {
    for (const k of Object.keys(r || {})) {
      const v = (r as any)[k];
      if (v && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date)) {
        issues.push({ rowIndex: i, column: k, type: Array.isArray(v) ? 'array' : 'object' });
      }
    }
  });
  return issues;
}