export type LogContext = {
  id?: string;
  route?: string;
  conversationId?: string;
  userId?: string;
  schemaVersion?: number;
  sql?: string;
};

export function logSchemaMismatch(message: string, details: Record<string, any> = {}, ctx: LogContext = {}) {
  console.warn('[schema-mismatch]', message, { details, ctx });
}

export function logQueryError(message: string, err: any, ctx: LogContext = {}) {
  const code = err?.code || err?.sqlState || 'UNKNOWN';
  console.error('[query-error]', message, { code, err: String(err?.message || err), ctx });
}

export function logValidationFailure(message: string, details: Record<string, any> = {}, ctx: LogContext = {}) {
  console.warn('[validation-failure]', message, { details, ctx });
}

export function logAccessViolation(message: string, details: Record<string, any> = {}, ctx: LogContext = {}) {
  console.warn('[schema-access-violation]', message, { details, ctx });
}

export function buildColumnMismatchMessage(table: string, expected: string[], actual: string[], schemaVersion?: number) {
  const missing = expected.filter(e => !actual.map(a => a.toUpperCase()).includes(e.toUpperCase()));
  const extra = actual.filter(a => !expected.map(e => e.toUpperCase()).includes(a.toUpperCase()));
  const suggestions = [
    'Ensure Oracle column names are uppercase in SQL (case-sensitive identifiers).',
    `Refresh schema in UI to sync (current schema version: ${schemaVersion ?? 'unknown'}).`,
    `Verify table selection includes ${table} before running queries.`,
  ];
  return {
    message: `Column name mismatch for table ${table}`,
    expected,
    actual,
    missing,
    extra,
    schemaVersion,
    suggestions,
  };
}
