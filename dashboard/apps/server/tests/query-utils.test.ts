/// <reference types="node" />
import assert from 'assert';
import { normalizeRows, isSimpleTableSelect, stripLimitClauses, validateDatasetCompleteness, detectFormattingIssues } from '../src/lib/query-utils';

// normalizeRows: date, buffer, object
{
  const now = new Date('2024-01-02T03:04:05.000Z');
  const rows = [{
    DATE_COL: now,
    BUF_COL: Buffer.from('hello'),
    OBJ_COL: { a: 1, b: 'two' },
    NUM_COL: 42,
    STR_COL: 'ok'
  }];
  const out = normalizeRows(rows);
  assert.strictEqual(out[0].DATE_COL, now.toISOString());
  assert.strictEqual(out[0].BUF_COL, Buffer.from('hello').toString('base64'));
  assert.strictEqual(typeof out[0].OBJ_COL, 'string');
  assert.ok(String(out[0].OBJ_COL).includes('"a":1'));
  assert.strictEqual(out[0].NUM_COL, 42);
  assert.strictEqual(out[0].STR_COL, 'ok');
}

// isSimpleTableSelect
{
  assert.deepStrictEqual(isSimpleTableSelect('SELECT * FROM USERS'), { table: 'USERS' });
  assert.deepStrictEqual(isSimpleTableSelect('select * from "SCHEMA"."ORDERS"'), { table: 'ORDERS' });
  assert.strictEqual(isSimpleTableSelect('SELECT id, name FROM USERS'), null);
  assert.strictEqual(isSimpleTableSelect('UPDATE USERS SET x=1'), null);
}

// stripLimitClauses
{
  assert.strictEqual(stripLimitClauses('SELECT * FROM USERS LIMIT 10'), 'SELECT * FROM USERS');
  assert.strictEqual(stripLimitClauses('SELECT * FROM ORDERS FETCH FIRST 5 ROWS ONLY'), 'SELECT * FROM ORDERS');
}

// validateDatasetCompleteness
{
  const rows = [{a:1},{a:2},{a:3}];
  const v1 = validateDatasetCompleteness(rows, 3);
  assert.strictEqual(v1.complete, true);
  assert.strictEqual(v1.expectedCount, 3);
  assert.strictEqual(v1.actualCount, 3);
  const v2 = validateDatasetCompleteness(rows, 5);
  assert.strictEqual(v2.complete, false);
  assert.strictEqual(v2.expectedCount, 5);
  assert.strictEqual(v2.actualCount, 3);
}

// detectFormattingIssues
{
  const rows = [{ A: { nested: true }, B: [1,2,3], C: 'ok' }];
  const issues = detectFormattingIssues(rows);
  assert.ok(issues.length >= 2);
}

console.log('query-utils.test: OK');