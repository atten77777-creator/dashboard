type QueryOptions = {
  timeoutMs?: number;
  maxRows?: number;
  cache?: boolean;
  cacheTtlMs?: number;
  endpoint?: string; // defaults to /api/query
  monitor?: boolean;
  mockRows?: any[]; // for tests or offline dev
};

export type QueryResponse<T = any> = {
  rows: T[];
  elapsedMs: number;
  cached?: boolean;
};

type CacheEntry = {
  expiresAt: number;
  value: QueryResponse;
};

const cacheStore = new Map<string, CacheEntry>();

function cacheKey(sql: string, params: any[]) {
  return JSON.stringify({ sql, params });
}

function isExpired(entry: CacheEntry) {
  return Date.now() > entry.expiresAt;
}

export async function query<T = any>(sql: string, params: any[] = [], options: QueryOptions = {}): Promise<QueryResponse<T>> {
  const endpoint = options.endpoint ?? '/api/query';
  const key = cacheKey(sql, params);

  if (options.cache) {
    const entry = cacheStore.get(key);
    if (entry && !isExpired(entry)) {
      return { ...(entry.value as QueryResponse<T>), cached: true };
    }
  }

  // Mock mode for tests/offline
  if (options.mockRows) {
    const res: QueryResponse<T> = { rows: options.mockRows as T[], elapsedMs: 0 };
    if (options.cache) {
      cacheStore.set(key, { value: res, expiresAt: Date.now() + (options.cacheTtlMs ?? 30_000) });
    }
    return res;
  }

  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 15_000;
  const start = performance.now();
  const to = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
      signal: controller.signal,
    });
    clearTimeout(to);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Query failed: ${resp.status} ${resp.statusText} ${text}`);
    }
    const json = await resp.json();
    const rows = Array.isArray(json?.rows) ? json.rows : json;
    const elapsedMs = Math.round(performance.now() - start);
    const limitedRows = typeof options.maxRows === 'number' ? rows.slice(0, options.maxRows) : rows;
    const result: QueryResponse<T> = { rows: limitedRows, elapsedMs };
    if (options.cache) {
      cacheStore.set(key, { value: result, expiresAt: Date.now() + (options.cacheTtlMs ?? 30_000) });
    }
    if (options.monitor) {
      // Simple performance monitor log; in production, replace with telemetry
      console.info(`[dbClient] ${elapsedMs}ms, rows=${limitedRows.length}`);
    }
    return result;
  } catch (err: any) {
    clearTimeout(to);
    if (err?.name === 'AbortError') {
      throw new Error(`Query timeout after ${timeout}ms`);
    }
    throw err;
  }
}

export function clearCache() {
  cacheStore.clear();
}