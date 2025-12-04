/// <reference types="node" />
import assert from 'assert';
import { validateTableSelection } from '../src/lib/access-control';

// Empty selection should be invalid
{
  const v = validateTableSelection([]);
  assert.strictEqual(v.valid, false);
  assert.ok(String(v.reason || '').toLowerCase().includes('no tables'));
}

// Excess selection should be invalid
{
  const many = Array.from({ length: 30 }, (_, i) => `T${i}`);
  const v = validateTableSelection(many, 25);
  assert.strictEqual(v.valid, false);
  assert.ok(String(v.reason || '').toLowerCase().includes('too many'));
}

// Reasonable selection should be valid
{
  const v = validateTableSelection(['USERS', 'ORDERS']);
  assert.strictEqual(v.valid, true);
}

console.log('schema-access.test: OK');