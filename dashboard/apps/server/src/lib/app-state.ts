import { executeQuery } from './db';
import { isConvDbEnabled, kvSet, kvGet } from './conv-db';

const TABLE_NAME = 'APP_STATE';

export async function initAppStateStore(): Promise<void> {
  // When conversation DB (SQLite) is enabled, kv_store is created there.
  if (isConvDbEnabled()) {
    return; // conv-db.initConvDb already ensures kv_store
  }
  // Otherwise, create APP_STATE in Oracle for dev environments
  const ddl = `
    BEGIN
      EXECUTE IMMEDIATE 'CREATE TABLE ${TABLE_NAME} (
        KEY VARCHAR2(128) PRIMARY KEY,
        VALUE CLOB,
        UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP
      )';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF; -- ORA-00955: name is already used by an existing object
    END;
  `;
  try { await executeQuery(ddl); } catch (e) { /* ignore if already exists */ }
}

export async function saveState(key: string, value: any): Promise<void> {
  if (isConvDbEnabled()) {
    kvSet(key, value);
    return;
  }
  const json = JSON.stringify(value);
  const sql = `
    MERGE INTO ${TABLE_NAME} s
    USING (SELECT :key KEY, :val VALUE FROM dual) src
    ON (s.KEY = src.KEY)
    WHEN MATCHED THEN UPDATE SET s.VALUE = src.VALUE, s.UPDATED_AT = SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (KEY, VALUE, UPDATED_AT) VALUES (src.KEY, src.VALUE, SYSTIMESTAMP)
  `;
  await executeQuery(sql, { key, val: json });
}

export async function loadState<T = any>(key: string): Promise<T | null> {
  if (isConvDbEnabled()) {
    return kvGet<T>(key);
  }
  const sql = `SELECT VALUE FROM ${TABLE_NAME} WHERE KEY = :key`;
  try {
    const rows: any[] = await executeQuery(sql, { key });
    if (!rows || !rows.length) return null;
    const val = rows[0].VALUE || rows[0].value;
    if (!val) return null;
    try { return JSON.parse(String(val)) as T; } catch { return null; }
  } catch {
    return null;
  }
}

export type PersistedConversations = {
  version: number;
  lastActiveId?: string;
  conversations: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messages: any[] }>;
};