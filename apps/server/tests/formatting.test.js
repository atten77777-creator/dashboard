"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const query_utils_1 = require("../src/lib/query-utils");
// Large result set handling (simulated)
{
    const rows = Array.from({ length: 5000 }).map((_, i) => ({ id: i + 1, name: `User ${i + 1}`, meta: { idx: i } }));
    const normalized = (0, query_utils_1.normalizeRows)(rows);
    // Ensure size preserved
    node_assert_1.default.equal(normalized.length, 5000);
    // Ensure nested objects do not remain
    const issues = (0, query_utils_1.detectFormattingIssues)(normalized);
    node_assert_1.default.equal(issues.length, 0);
}
console.log('formatting tests passed');
