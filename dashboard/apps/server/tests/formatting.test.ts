/// <reference types="node" />
import assert from 'assert';
import { normalizeRows, detectFormattingIssues } from '../src/lib/query-utils';

// Simulate large dataset and ensure normalization avoids [object Object] issues
{
  const N = 5000;
  const rows = Array.from({ length: N }, (_, i) => ({
    ID: i + 1,
    NAME: `Name ${i + 1}`,
    META: { index: i, flags: { a: true, b: false } }
  }));
  const issuesBefore = detectFormattingIssues(rows);
  assert.ok(issuesBefore.length > 0, 'Should detect formatting issues in raw objects');
  const normalized = normalizeRows(rows);
  const issuesAfter = detectFormattingIssues(normalized);
  assert.strictEqual(issuesAfter.length, 0, 'Normalized rows should not flag nested objects');
  assert.strictEqual(normalized.length, N, 'Normalization should preserve row count');
}

console.log('formatting.test: OK');