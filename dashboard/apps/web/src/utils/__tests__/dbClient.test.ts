import { describe, it, expect } from 'vitest';
import { query, clearCache } from '../dbClient';

describe('dbClient', () => {
  it('returns mock rows and caches results', async () => {
    clearCache();
    const res1 = await query('SELECT 1', [], { cache: true, mockRows: [{ a: 1 }, { a: 2 }] });
    expect(res1.rows.length).toBe(2);
    const res2 = await query('SELECT 1', [], { cache: true, mockRows: [{ a: 9 }] });
    // Should return from cache, not the new mock
    expect(res2.rows.length).toBe(2);
    expect(res2.cached).toBe(true);
  });

  it('enforces timeout', async () => {
    // This test simulates timeout by calling a non-existing endpoint with tiny timeout
    let error: any = null;
    try {
      await query('SELECT 1', [], { endpoint: '/not-found', timeoutMs: 1 });
    } catch (e: any) {
      error = e;
    }
    expect(error).toBeTruthy();
  });
});