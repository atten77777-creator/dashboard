import oracledb from 'oracledb';
import { normalizeRows } from './query-utils.js';
import { logQueryError } from './logger.js';
import { DatabaseError } from './db.js';

// Execute query with configurable maxRows and timeout (non-full retrieval)
export async function executeQueryWithOptions<T = any>(
  sql: string,
  params?: any,
  options?: { maxRows?: number; timeoutMs?: number; fetchArraySize?: number }
): Promise<T[]> {
  let connection: any;
  let breaker: any = null;
  try {
    connection = await oracledb.getConnection();
    console.log('Executing SQL (opt):', sql.slice(0, 100) + (sql.length > 100 ? '...' : ''));
    const execOptions = {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: true,
      maxRows: Math.max(1, Math.min(100000, options?.maxRows ?? 1000)),
      fetchArraySize: Math.max(1, Math.min(5000, options?.fetchArraySize ?? 100))
    } as any;
    if (options?.timeoutMs && options.timeoutMs > 0) {
      try { (connection as any).callTimeout = options.timeoutMs; } catch {}
      breaker = setTimeout(() => { try { connection.break?.(); } catch {} }, (options.timeoutMs || 0) + 50);
    }
    const result = await connection.execute(sql, params || [], execOptions);
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    return normalizeRows(rows as T[]);
  } catch (err: any) {
    logQueryError('Database error in executeQueryWithOptions', err, { sql });
    let message = 'Database query failed';
    if (err.code === 'ORA-00942') message = 'Table or view does not exist';
    else if (err.code === 'ORA-00904') message = 'Invalid column name';
    else if (err.code === 'NJS-500') message = 'Oracle client library not found. Check ORACLE_HOME environment variable.';
    throw new DatabaseError(message, err.code, err.sqlState, {
      errorNum: err.errorNum,
      offset: err.offset,
      sql: sql.slice(0, 100) + (sql.length > 100 ? '...' : ''),
      originalError: err.message,
    });
  } finally {
    try { if (breaker) clearTimeout(breaker); } catch {}
    try { if (connection) await connection.close(); } catch (err: any) {
      console.error('Error closing connection (opt):', err);
    }
  }
}

// Stream all rows with timeout and optional maxRows cut-off (full retrieval safeguards)
export async function executeQueryAllWithOptions<T = any>(
  sql: string,
  params?: any,
  options?: { timeoutMs?: number; fetchArraySize?: number; maxRows?: number }
): Promise<T[]> {
  let connection: any;
  let rs: any;
  let breaker: any = null;
  const FETCH_SIZE = Math.max(1, Math.min(5000, options?.fetchArraySize ?? 1000));
  try {
    connection = await oracledb.getConnection();
    console.log('Executing FULL SQL (opt):', sql.slice(0, 100) + (sql.length > 100 ? '...' : ''));
    if (options?.timeoutMs && options.timeoutMs > 0) {
      try { (connection as any).callTimeout = options.timeoutMs; } catch {}
      breaker = setTimeout(() => { try { connection.break?.(); } catch {} }, (options.timeoutMs || 0) + 50);
    }
    const result = await connection.execute(sql, params || [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      resultSet: true,
      fetchArraySize: FETCH_SIZE,
    } as any);
    rs = result.resultSet;
    const all: any[] = [];
    while (true) {
      const rows = await rs.getRows(FETCH_SIZE);
      if (!rows || rows.length === 0) break;
      all.push(...rows);
      if (options?.maxRows && all.length >= options.maxRows) break;
      if (rows.length < FETCH_SIZE) break;
    }
    await rs.close();
    return normalizeRows(all.slice(0, options?.maxRows ?? all.length)) as T[];
  } catch (err: any) {
    logQueryError('Database error in executeQueryAllWithOptions', err, { sql });
    let message = 'Database query failed';
    if (err.code === 'ORA-00942') message = 'Table or view does not exist';
    else if (err.code === 'ORA-00904') message = 'Invalid column name';
    else if (err.code === 'NJS-500') message = 'Oracle client library not found. Check ORACLE_HOME environment variable.';
    throw new DatabaseError(message, err.code, err.sqlState, {
      errorNum: err.errorNum,
      offset: err.offset,
      sql: sql.slice(0, 100) + (sql.length > 100 ? '...' : ''),
      originalError: err.message,
    });
  } finally {
    try { if (breaker) clearTimeout(breaker); } catch {}
    try { if (rs) await rs.close(); } catch {}
    try { if (connection) await connection.close(); } catch (err: any) {
      console.error('Error closing connection/resultSet (opt):', err);
    }
  }
}