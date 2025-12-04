"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const query_utils_1 = require("../src/lib/query-utils");
// normalizeRows should convert Date, Buffer, and nested objects safely
{
    const rows = [
        { id: 1, created_at: new Date('2024-01-01T00:00:00Z'), payload: { a: 1 }, bin: Buffer.from('abc') },
        { id: 2, created_at: new Date('2024-02-02T00:00:00Z'), payload: [1, 2, 3] }
    ];
    const normalized = (0, query_utils_1.normalizeRows)(rows);
    node_assert_1.default.equal(typeof normalized[0].created_at, 'string');
    node_assert_1.default.equal(typeof normalized[0].payload, 'string');
    node_assert_1.default.ok(String(normalized[0].payload).includes('"a":1'));
    node_assert_1.default.equal(typeof normalized[0].bin, 'string');
    node_assert_1.default.ok(/^[A-Za-z0-9+/=]+$/.test(String(normalized[0].bin)));
}
// isSimpleTableSelect detection
{
    node_assert_1.default.deepEqual((0, query_utils_1.isSimpleTableSelect)('SELECT * FROM USERS'), { table: 'USERS' });
    node_assert_1.default.deepEqual((0, query_utils_1.isSimpleTableSelect)('select * from "OWNER"."ORDERS"'), { table: 'ORDERS' });
    node_assert_1.default.equal((0, query_utils_1.isSimpleTableSelect)('SELECT id FROM USERS'), null);
}
// stripLimitClauses should remove trailing limit/fetch first
{
    node_assert_1.default.equal((0, query_utils_1.stripLimitClauses)('SELECT * FROM T FETCH FIRST 10 ROWS ONLY'), 'SELECT * FROM T');
    node_assert_1.default.equal((0, query_utils_1.stripLimitClauses)('SELECT * FROM T LIMIT 10'), 'SELECT * FROM T');
}
// validateDatasetCompleteness
{
    const rows = new Array(5).fill(0).map((_, i) => ({ id: i + 1 }));
    const v1 = (0, query_utils_1.validateDatasetCompleteness)(rows, 5);
    node_assert_1.default.equal(v1.complete, true);
    const v2 = (0, query_utils_1.validateDatasetCompleteness)(rows, 7);
    node_assert_1.default.equal(v2.complete, false);
    node_assert_1.default.equal(v2.expectedCount, 7);
    node_assert_1.default.equal(v2.actualCount, 5);
}
// detectFormattingIssues
{
    const rows = [{ id: 1, nested: { a: 1 } }, { id: 2, arr: [1, 2] }, { id: 3, ok: 'x' }];
    const issues = (0, query_utils_1.detectFormattingIssues)(rows);
    node_assert_1.default.equal(issues.length, 2);
    node_assert_1.default.equal(issues[0].column, 'nested');
    node_assert_1.default.equal(issues[1].column, 'arr');
}
console.log('query-utils tests passed');
