import oracledb from 'oracledb';
import { normalizeRows } from './query-utils';
import { logQueryError } from './logger';

type CursorEntry = {
  id: string;
  connection: any;
  resultSet: any;
  columns: Array<{ name: string; type?: string }>;
  pageSize: number;
  createdAt: number;
  lastAccessAt: number;
};

const cursors = new Map<string, CursorEntry>();
const TTL_MS = 2 * 60 * 1000; // 2 minutes inactivity TTL
const MAX_CONCURRENT = 50; // safeguard

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function openStream(sql: string, binds?: any, pageSize: number = 1000): Promise<{ id: string; columns: Array<{ name: string; type?: string }>; rows: any[]; hasMore: boolean }> {
  // Prevent resource exhaustion
  if (cursors.size >= MAX_CONCURRENT) {
    throw new Error('Too many open cursors');
  }
  const connection = await oracledb.getConnection();
  const execRes: any = await connection.execute(sql, binds || [], {
    outFormat: oracledb.OUT_FORMAT_OBJECT,
    resultSet: true,
    fetchArraySize: Math.max(1, Math.min(5000, pageSize)),
  } as any);
  const rs = execRes.resultSet;
  const md: Array<{ name: string; dbTypeName?: string }> = Array.isArray(execRes?.metaData) ? execRes.metaData : [];
  const columns = md.map((c) => ({ name: String(c?.name || ''), type: c?.dbTypeName ? String(c.dbTypeName) : undefined })).filter((c) => !!c.name);
  const rowsChunk: any[] = await rs.getRows(Math.max(1, Math.min(5000, pageSize)));
  const id = makeId();
  const entry: CursorEntry = {
    id,
    connection,
    resultSet: rs,
    columns,
    pageSize: Math.max(1, Math.min(5000, pageSize)),
    createdAt: Date.now(),
    lastAccessAt: Date.now(),
  };
  cursors.set(id, entry);
  const hasMore = Array.isArray(rowsChunk) && rowsChunk.length === entry.pageSize;
  return { id, columns, rows: normalizeRows(rowsChunk), hasMore };
}

export async function fetchNext(id: string): Promise<{ rows: any[]; hasMore: boolean }> {
  const entry = cursors.get(id);
  if (!entry) throw new Error('Invalid cursor');
  entry.lastAccessAt = Date.now();
  try {
    const rowsChunk: any[] = await entry.resultSet.getRows(entry.pageSize);
    const hasMore = Array.isArray(rowsChunk) && rowsChunk.length === entry.pageSize;
    if (!hasMore || !rowsChunk || rowsChunk.length === 0) {
      await close(id);
    }
    return { rows: normalizeRows(rowsChunk || []), hasMore };
  } catch (err: any) {
    logQueryError('Stream fetchNext error', err, { id });
    await close(id);
    throw err;
  }
}

export async function close(id: string): Promise<void> {
  const entry = cursors.get(id);
  if (!entry) return;
  cursors.delete(id);
  try { await entry.resultSet.close(); } catch {}
  try { await entry.connection.close(); } catch {}
}

// Background cleanup for idle cursors
setInterval(async () => {
  const now = Date.now();
  const stale: string[] = [];
  for (const [id, entry] of cursors.entries()) {
    if (now - entry.lastAccessAt > TTL_MS) {
      stale.push(id);
    }
  }
  for (const id of stale) {
    try { await close(id); } catch {}
  }
}, 30000);

export function listActiveCursors(): Array<{ id: string; ageMs: number; lastAccessMs: number; pageSize: number }> {
  const out: Array<{ id: string; ageMs: number; lastAccessMs: number; pageSize: number }> = [];
  const now = Date.now();
  for (const entry of cursors.values()) {
    out.push({ id: entry.id, ageMs: now - entry.createdAt, lastAccessMs: now - entry.lastAccessAt, pageSize: entry.pageSize });
  }
  return out;
}
