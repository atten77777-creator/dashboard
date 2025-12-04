/// <reference types="node" />
import assert from 'assert';
import { normalizeRows, detectFormattingIssues } from '../src/lib/query-utils';

// Large result set handling (simulated)
{
  const rows = Array.from({ length: 5000 }).map((_, i) => ({ id: i + 1, name: `User ${i+1}`, meta: { idx: i } }));
  const normalized = normalizeRows(rows);
  // Ensure size preserved
  assert.equal(normalized.length, 5000);
  // Ensure nested objects do not remain
  const issues = detectFormattingIssues(normalized);
  assert.equal(issues.length, 0);
}

console.log('formatting tests passed');