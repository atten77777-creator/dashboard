/// <reference types="node" />
import assert from 'assert';
import { normalizeRows, isSimpleTableSelect, stripLimitClauses, validateDatasetCompleteness, detectFormattingIssues } from '../src/lib/query-utils';

// normalizeRows should convert Date, Buffer, and nested objects safely
{
  const rows = [
    { id: 1, created_at: new Date('2024-01-01T00:00:00Z'), payload: { a: 1 }, bin: Buffer.from('abc') },
    { id: 2, created_at: new Date('2024-02-02T00:00:00Z'), payload: [1,2,3] }
  ];
  const normalized = normalizeRows(rows);
  assert.equal(typeof normalized[0].created_at, 'string');
  assert.equal(typeof normalized[0].payload, 'string');
  assert.ok(String(normalized[0].payload).includes('"a":1'));
  assert.equal(typeof normalized[0].bin, 'string');
  assert.ok(/^[A-Za-z0-9+/=]+$/.test(String(normalized[0].bin)));
}

// isSimpleTableSelect detection
{
  assert.deepEqual(isSimpleTableSelect('SELECT * FROM USERS'), { table: 'USERS' });
  assert.deepEqual(isSimpleTableSelect('select * from "OWNER"."ORDERS"'), { table: 'ORDERS' });
  assert.equal(isSimpleTableSelect('SELECT id FROM USERS'), null);
}

// stripLimitClauses should remove trailing limit/fetch first
{
  assert.equal(stripLimitClauses('SELECT * FROM T FETCH FIRST 10 ROWS ONLY'), 'SELECT * FROM T');
  assert.equal(stripLimitClauses('SELECT * FROM T LIMIT 10'), 'SELECT * FROM T');
}

// validateDatasetCompleteness
{
  const rows = new Array(5).fill(0).map((_, i) => ({ id: i+1 }));
  const v1 = validateDatasetCompleteness(rows, 5);
  assert.equal(v1.complete, true);
  const v2 = validateDatasetCompleteness(rows, 7);
  assert.equal(v2.complete, false);
  assert.equal(v2.expectedCount, 7);
  assert.equal(v2.actualCount, 5);
}

// detectFormattingIssues
{
  const rows = [ { id: 1, nested: { a: 1 } }, { id: 2, arr: [1,2] }, { id: 3, ok: 'x' } ];
  const issues = detectFormattingIssues(rows);
  assert.equal(issues.length, 2);
  assert.equal(issues[0].column, 'nested');
  assert.equal(issues[1].column, 'arr');
}

console.log('query-utils tests passed');