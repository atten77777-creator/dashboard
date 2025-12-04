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
  const s = String(sql || '').trim().replace(/;+\\s*$/, '');
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
  let s = String(sql || '').trim().replace(/;+\s*$/m, '');
  s = s.replace(/FETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY\s*$/i, '');
  s = s.replace(/\bLIMIT\s+\d+\s*$/i, '');
  return s.trim();
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

// --- Oracle SQL sanitization helpers ---

// Normalize problematic unicode punctuation to ASCII equivalents
function normalizeUnicodePunctuation(sql: string): string {
  return sql
    .replace(/[\u2013\u2014]/g, '-') // en/em dash
    .replace(/[\u2018\u2019]/g, "'") // curly single quotes
    .replace(/[\u201C\u201D]/g, '"') // curly double quotes
    .replace(/[\u2026]/g, ' ') // ellipsis
    .replace(/[\u00A0]/g, ' '); // non-breaking space
}

// Remove SQL line and block comments (best-effort)
function stripComments(sql: string): string {
  // Remove block comments /* ... */ and line comments -- ... (to end of line)
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n\r]*/g, '');
}

// Truncate overly long aliases after AS to Oracle's legacy 30-character limit
export function truncateLongAliases(sql: string): string {
  const MAX_LEN = 30; // pre-12.2 compatibility
  const seen = new Set<string>();
  // Only process SELECT statements to reduce risk
  if (!/^\s*SELECT\b/i.test(sql)) return sql;

  return sql.replace(/\bAS\s+("([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/gi, (m, g1, quoted, unquoted) => {
    const alias = (quoted ?? unquoted) || '';
    const base = alias.replace(/\s+/g, '_');
    let next = base.length > MAX_LEN ? base.slice(0, MAX_LEN) : base;
    // Ensure uniqueness if the same truncated alias repeats
    let idx = 1;
    while (seen.has(next)) {
      const suffix = `_${idx}`;
      next = (base.length > MAX_LEN - suffix.length ? base.slice(0, MAX_LEN - suffix.length) : base) + suffix;
      idx++;
    }
    seen.add(next);
    return `AS ${next}`;
  });
}

// Sanitize SQL for Oracle driver execution to prevent ORA-00911 and related issues
export function sanitizeForOracle(sql: string): string {
  if (!sql) return sql;
  let s = String(sql);
  // Normalize unicode punctuation first
  s = normalizeUnicodePunctuation(s);
  // Remove comments that can trip parsers
  s = stripComments(s);
  // Strip trailing SQL*Plus slash on its own line
  s = s.replace(/\n\s*\/\s*$/m, '\n');
  // Strip trailing semicolons (Oracle driver does not want them)
  s = s.replace(/;+\s*$/m, '');
  // Remove dangling comma before FROM caused by comment removal
  s = s.replace(/,(\s*)FROM\b/gi, '$1FROM');
  // Normalize whitespace at ends
  s = s.trim();
  // Truncate overly long aliases after AS to avoid ORA-00972
  s = truncateLongAliases(s);
  return s;
}

// Extract SQL code blocks from fenced markdown, fallback to full text
export function extractSqlBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /```\s*(sql|oracle|SQL)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text))) !== null) {
    blocks.push(m[2]);
  }
  if (blocks.length === 0) blocks.push(String(text));
  return blocks;
}

// Split text into individual SQL statements, respecting quotes and parentheses depth
export function splitSqlStatements(text: string): string[] {
  const blocks = extractSqlBlocks(text);
  const out: string[] = [];
  for (const raw of blocks) {
    const src = normalizeUnicodePunctuation(stripComments(raw));
    let buf = '';
    let inS = false, inD = false;
    let depth = 0;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      const prev = i > 0 ? src[i - 1] : '';
      if (!inD && ch === "'" && prev !== '\\') inS = !inS;
      else if (!inS && ch === '"' && prev !== '\\') inD = !inD;
      else if (!inS && !inD) {
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
      }
      if (ch === ';' && !inS && !inD && depth === 0) {
        const stmt = sanitizeForOracle(buf);
        if (stmt) out.push(stmt);
        buf = '';
      } else {
        buf += ch;
      }
    }
    const tail = sanitizeForOracle(buf);
    if (tail) out.push(tail);
  }
  // Filter any empties and dedupe trivial whitespace-only statements
  return out.map(s => s.trim()).filter(s => s.length > 0);
}