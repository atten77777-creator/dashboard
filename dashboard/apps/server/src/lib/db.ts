import oracledb from 'oracledb';
import { normalizeRows } from './query-utils.js';
import { logQueryError } from './logger.js';

// Oracle configuration (reads from environment with sensible defaults)
const ORACLE_CONFIG = {
  user: process.env.ORACLE_USER || 'SMARTERP',
  password: process.env.ORACLE_PASS || 'erp',
  connectString: process.env.ORACLE_DSN || 'localhost:1521/mabl',
  libDir: process.env.ORACLE_HOME || 'D:\\app\\BC\\product\\11.2.0\\dbhome_1\\BIN'
};

// Custom error class for database operations
export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly sqlState?: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

// Initialize Oracle connection pool
export async function initDb() {
  try {
    // Set Oracle client location if provided (Windows Instant Client)
    try {
      if (ORACLE_CONFIG.libDir) {
        oracledb.initOracleClient({ libDir: ORACLE_CONFIG.libDir });
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      // If already initialized we can proceed; otherwise surface a clear warning
      if (!msg.toLowerCase().includes('already initialized')) {
        console.warn('Oracle client init warning:', msg);
      }
    }
    
    // Ensure CLOB/NCLOB are returned as strings to avoid [object Object]
    oracledb.fetchAsString = [oracledb.CLOB, oracledb.NCLOB];
    
    // Ensure we are using Thick mode if required for older DB versions
    if ((oracledb as any).thin) {
      throw new DatabaseError(
        'Oracle Thick client not initialized. Thin mode cannot connect to this database version.',
        'NJS-138',
        undefined,
        {
          note: 'Set ORACLE_HOME to your Instant Client directory (e.g., C\\oracle\\instantclient_21_xx) so oci.dll is available, or install a compatible full client.',
          attemptedLibDir: ORACLE_CONFIG.libDir
        }
      );
    }

    // Create connection pool (tuned for concurrent chat queries)
    await oracledb.createPool({
      ...ORACLE_CONFIG,
      // Increase base capacity and warm a few connections to reduce first-hit latency
      poolMin: 4,
      poolMax: 20,
      poolIncrement: 2,
      // Keep connections available and extend queue wait to mitigate NJS-040 timeouts
      poolTimeout: 0,
      queueTimeout: 180000,
      enableStatistics: true
    });
    
    console.log('Oracle connection pool initialized');
  } catch (err: any) {
    const message = err.message || 'Failed to initialize Oracle';
    throw new DatabaseError(message, err.code, err.sqlState, {
      errorNum: err.errorNum,
      offset: err.offset
    });
  }
}

// Execute query with automatic connection handling (limited rows)
export async function executeQuery<T = any>(sql: string, params?: any): Promise<T[]> {
  let connection;
  try {
    // Add retry logic for connection issues
    let retries = 3;
    let lastError;
    
    while (retries > 0) {
      try {
        connection = await oracledb.getConnection();
        break; // Connection successful
      } catch (err: any) {
        lastError = err;
        console.warn(`Connection attempt failed (${retries} retries left):`, err.message);
        retries--;
        if (retries > 0) {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // If we couldn't connect after all retries
    if (!connection) {
      throw lastError || new Error('Failed to connect to database after multiple attempts');
    }
    
    // Log the SQL being executed (for debugging)
    console.log('Executing SQL:', sql.slice(0, 100) + (sql.length > 100 ? '...' : ''));
    
    const options = {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: true,
      maxRows: 1000, // Limit result size
      fetchArraySize: 100 // Batch size for fetching
    } as any;
    
    // Try to execute the query
    const result = await connection.execute(sql, params || [], options);
    
    // Return empty array if no rows
    if (!result.rows) {
      console.log('Query returned no rows');
      return [] as T[];
    }
    
    return normalizeRows(result.rows as T[]);
  } catch (err: any) {
    // Determine error type and provide helpful message
    let message = 'Database query failed';
    logQueryError('Database error in executeQuery', err, { sql });
    
    if (err.code === 'ORA-00942') message = 'Table or view does not exist';
    else if (err.code === 'ORA-00904') message = 'Invalid column name';
    else if (err.code === 'ORA-00936') message = 'Missing expression';
    else if (err.code === 'ORA-00933') message = 'SQL command not properly ended';
    else if (err.code === 'ORA-00920') message = 'Invalid relational operator';
    else if (err.code === 'ORA-00923') message = 'FROM keyword not found where expected';
    else if (err.code === 'ORA-00907') message = 'Missing right parenthesis';
    else if (err.code === 'ORA-00921') message = 'Unexpected end of SQL command';
    else if (err.code === 'ORA-01861') message = 'Literal does not match format string (check TO_CHAR/TO_DATE masks)';
    else if (err.code === 'ORA-01830') message = 'Date format picture ends before converting entire input string';
    else if (err.code === 'ORA-01722') message = 'Invalid number (numeric comparison with non-numeric literal)';
    else if (err.code === 'NJS-500') message = 'Oracle client library not found. Check ORACLE_HOME environment variable.';
    
    throw new DatabaseError(message, err.code, err.sqlState, {
      errorNum: err.errorNum,
      offset: err.offset,
      sql: sql.slice(0, 100) + (sql.length > 100 ? '...' : ''), // Include truncated SQL for debugging
      originalError: err.message
    });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err: any) {
        console.error('Error closing connection:', err);
      }
    }
  }
}

// Execute a query and stream all rows using a ResultSet for full dataset retrieval
export async function executeQueryAll<T = any>(sql: string, params?: any): Promise<T[]> {
  let connection: any;
  let rs: any;
  const FETCH_SIZE = 1000;
  try {
    connection = await oracledb.getConnection();
    console.log('Executing FULL SQL:', sql.slice(0, 100) + (sql.length > 100 ? '...' : ''));
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
      if (rows.length < FETCH_SIZE) break;
    }
    await rs.close();
    return normalizeRows(all) as T[];
  } catch (err: any) {
    logQueryError('Database error in executeQueryAll', err, { sql });
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
    try { if (rs) await rs.close(); } catch {}
    try { if (connection) await connection.close(); } catch (err: any) {
      console.error('Error closing connection/resultSet:', err);
    }
  }
}

// Retrieve column metadata for a SELECT query even when it returns no rows
export async function getQueryColumns(sql: string, params?: any): Promise<Array<{ name: string; type?: string }>> {
  let connection: any;
  try {
    // Acquire a connection from the pool
    connection = await oracledb.getConnection();
    // Execute with minimal fetch; metaData should still be populated
    const result: any = await connection.execute(sql, params || [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      maxRows: 1,
      fetchArraySize: 1,
    } as any);
    const md: Array<{ name: string; dbTypeName?: string }> = Array.isArray(result?.metaData)
      ? (result.metaData as Array<{ name: string; dbTypeName?: string }>)
      : [];
    // Map metaData to our column shape; type may be unavailable from metaData
    const columns: Array<{ name: string; type?: string }> = md.map((c) => ({
      name: String(c?.name || ''),
      type: c?.dbTypeName ? String(c.dbTypeName) : undefined,
    })).
      filter((col: { name: string; type?: string }) => !!col.name);
    return columns;
  } catch (err: any) {
    // Surface no columns for non-select statements or errors; caller will handle
    logQueryError('Database error in getQueryColumns', err, { sql });
    return [];
  } finally {
    try { if (connection) await connection.close(); } catch {}
  }
}

// Execute a set of operations within a transaction
export async function withTransaction<T>(fn: (conn: any) => Promise<T>): Promise<T> {
  let connection: any | undefined;
  try {
    connection = await oracledb.getConnection();
    const result = await fn(connection);
    // Commit if all operations succeeded
    await connection.commit();
    return result;
  } catch (err) {
    // Rollback on any error
    try { if (connection) await connection.rollback(); } catch {}
    throw err;
  } finally {
    try { if (connection) await connection.close(); } catch {}
  }
}

// Get table schema information
export async function getTableSchema(tableName: string) {
  try {
    const sql = `
      SELECT 
        c.column_name,
        c.data_type,
        c.nullable,
        CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END as is_primary_key,
        CASE WHEN fk.column_name IS NOT NULL THEN 1 ELSE 0 END as is_foreign_key,
        fk.r_owner as referenced_owner,
        fk.r_table_name as referenced_table,
        fk.r_column_name as referenced_column
      FROM user_tab_columns c
      LEFT JOIN (
        SELECT col.column_name
        FROM user_constraints con, user_cons_columns col
        WHERE con.constraint_type = 'P'
        AND con.constraint_name = col.constraint_name
        AND con.table_name = :1
      ) pk ON c.column_name = pk.column_name
      LEFT JOIN (
        SELECT 
          col.column_name,
          con.r_owner,
          con2.table_name r_table_name,
          col2.column_name r_column_name
        FROM user_constraints con
        JOIN user_cons_columns col ON con.constraint_name = col.constraint_name
        JOIN user_constraints con2 ON con.r_constraint_name = con2.constraint_name
        JOIN user_cons_columns col2 ON con2.constraint_name = col2.constraint_name
        WHERE con.constraint_type = 'R'
        AND con.table_name = :1
      ) fk ON c.column_name = fk.column_name
      WHERE c.table_name = :1
      ORDER BY c.column_id
    `;
    
    return executeQuery(sql, [tableName]);
  } catch (err: any) {
    if (err.code === 'ORA-00942') {
      throw new DatabaseError(`Table "${tableName}" does not exist`, err.code);
    }
    throw err;
  }
}

// List available tables
export async function listTables() {
  const sql = `
    SELECT 
      t.table_name,
      t.num_rows,
      t.last_analyzed,
      c.comments
    FROM user_tables t
    LEFT JOIN user_tab_comments c ON t.table_name = c.table_name
    ORDER BY t.table_name
  `;
  return executeQuery<{
    TABLE_NAME: string;
    NUM_ROWS: number;
    LAST_ANALYZED: Date;
    COMMENTS: string;
  }>(sql);
}

// Get pool statistics
export function getPoolStats() {
  const pool = oracledb.getPool();
  return {
    connectionsInUse: pool.connectionsInUse,
    connectionsOpen: pool.connectionsOpen,
    totalRequestsInQueue: pool.totalRequestsInQueue,
    totalRequestsRejected: pool.totalRequestsRejected,
    totalRequestsSuccessful: pool.totalRequestsSuccessful,
    totalRequestsTimedOut: pool.totalRequestsTimedOut
  };
}

// Validate connection and return session/environment details
export async function validateConnection() {
  let connection: any;
  try {
    connection = await oracledb.getConnection();
    // Basic ping (use lightweight query for broad compatibility)
    const ping = await connection.execute(`SELECT 1 AS ok FROM dual`);
    const ok = Array.isArray(ping.rows) && ping.rows.length > 0 ? ping.rows[0] : { ok: 1 };

    // Capture NLS session parameters likely to affect date/time formatting
    let nls: Array<{ PARAMETER: string; VALUE: string }> = [];
    try {
      const nlsRes = await connection.execute(
        `SELECT parameter, value FROM nls_session_parameters 
         WHERE parameter IN ('NLS_DATE_FORMAT','NLS_TIMESTAMP_FORMAT','NLS_LANGUAGE','NLS_TERRITORY')`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      nls = (nlsRes.rows as any[]) || [];
    } catch (e) {
      // ignore
    }

    // Get DB version banner if accessible
    let versionBanner: string | null = null;
    try {
      const verRes = await connection.execute(`SELECT banner FROM v$version WHERE ROWNUM = 1`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      versionBanner = (verRes.rows && verRes.rows[0] && (verRes.rows[0] as any).BANNER) ? String((verRes.rows[0] as any).BANNER) : null;
    } catch (e) {
      versionBanner = null;
    }

    // Current SYSDATE as string for sanity check
    let sysdateStr: string | null = null;
    try {
      const dRes = await connection.execute(`SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS') AS TS FROM dual`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      sysdateStr = (dRes.rows && dRes.rows[0] && (dRes.rows[0] as any).TS) ? String((dRes.rows[0] as any).TS) : null;
    } catch (e) {
      sysdateStr = null;
    }

    return { ok: !!ok, pool: getPoolStats(), nls, versionBanner, sysdate: sysdateStr };
  } catch (err: any) {
    throw new DatabaseError('Connection validation failed', err.code, err.sqlState, { originalError: err.message });
  } finally {
    try { if (connection) await connection.close(); } catch {}
  }
}

// Close the connection pool
export async function closeDb() {
  try {
    const pool = oracledb.getPool();
    await pool.close(10); // Wait up to 10 seconds
    console.log('Oracle connection pool closed');
  } catch (err: any) {
    throw new DatabaseError('Failed to close connection pool', err.code);
  }
}