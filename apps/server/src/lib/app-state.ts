import { executeQuery } from './db'

const TABLE_NAME = 'APP_STATE'

export async function initAppStateStore(): Promise<void> {
  const ddl = `
    BEGIN
      EXECUTE IMMEDIATE 'CREATE TABLE ${TABLE_NAME} (
        KEY VARCHAR2(128) PRIMARY KEY,
        VALUE CLOB,
        UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP
      )';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
    END;
  `
  try { await executeQuery(ddl, []) } catch { /* ignore if table exists */ }
}

export async function saveState(key: string, value: any): Promise<void> {
  const json = JSON.stringify(value)
  const sql = `
    MERGE INTO ${TABLE_NAME} s
    USING (SELECT :1 KEY, :2 VALUE FROM dual) src
    ON (s.KEY = src.KEY)
    WHEN MATCHED THEN UPDATE SET s.VALUE = src.VALUE, s.UPDATED_AT = SYSTIMESTAMP
    WHEN NOT MATCHED THEN INSERT (KEY, VALUE, UPDATED_AT) VALUES (src.KEY, src.VALUE, SYSTIMESTAMP)
  `
  await executeQuery(sql, [key, json])
}

export async function loadState<T = any>(key: string): Promise<T | null> {
  const sql = `SELECT VALUE FROM ${TABLE_NAME} WHERE KEY = :1`
  try {
    const rows: any[] = await executeQuery(sql, [key])
    if (!rows || rows.length === 0) return null
    const val = rows[0].VALUE ?? rows[0].value
    if (!val) return null
    try { return JSON.parse(String(val)) as T } catch { return null }
  } catch {
    return null
  }
}