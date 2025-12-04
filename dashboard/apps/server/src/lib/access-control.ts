export function validateTableSelection(tables: string[], maxTables = 25): { valid: boolean; reason?: string } {
  const list = Array.isArray(tables) ? tables.filter(Boolean) : [];
  if (!list.length) return { valid: false, reason: 'No tables selected' };
  if (list.length > maxTables) return { valid: false, reason: `Too many tables selected (max ${maxTables})` };
  return { valid: true };
}

export function enforceTableSelection(tables: string[], maxTables = 25): void {
  const v = validateTableSelection(tables, maxTables);
  if (!v.valid) {
    const err: any = new Error(v.reason || 'Invalid table selection');
    err.code = 'SchemaAccessDenied';
    throw err;
  }
}