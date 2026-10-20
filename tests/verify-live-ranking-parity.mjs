// Usage: node tests/verify-live-ranking-parity.mjs '<JSON snapshot>'
// Snapshot: {settings, metrics, dailyPoints, computed}. Computed must be the
// SQL RPC/CTE result for all fixture editors, fetched by the database owner.
// No database credentials or user tokens are accepted by this script.
import assert from 'node:assert/strict';
import { scoreEditorPerformance } from '../lib/editor-performance.ts';

const snapshot = JSON.parse(process.argv[2] || '{}');
assert.ok(Array.isArray(snapshot.metrics), 'Provide source metric rows');
assert.ok(Array.isArray(snapshot.computed), 'Provide SQL-computed rows');
const extra = new Map();
for (const point of snapshot.dailyPoints || []) {
  extra.set(point.editor_id, (extra.get(point.editor_id) || 0) + Number(point.points));
}
const expected = scoreEditorPerformance(snapshot.metrics, snapshot.settings)
  .map((entry) => ({ ...entry, score: entry.score + (extra.get(entry.row.editor_id) || 0) }))
  // Mirrors the final rankingWithDailyPoints ordering in the application.
  .sort((a, b) => b.score - a.score || a.row.editor_id.localeCompare(b.row.editor_id));
assert.equal(snapshot.computed.length, expected.length, 'SQL/editor counts disagree');
for (const [index, entry] of expected.entries()) {
  const actual = snapshot.computed.find((row) => row.editor_id === entry.row.editor_id);
  assert.ok(actual, 'Missing SQL result');
  assert.ok(Math.abs(Number(actual.total_score) - entry.score) < 0.000001, 'Score disagrees with frontend');
  assert.equal(Number(actual.rank_position), index + 1, 'Position disagrees with frontend');
  for (const part of entry.parts) {
    assert.ok(actual.points[part.key], `SQL missing ${part.key}`);
    for (const key of ['value', 'weight', 'points']) {
      assert.ok(Math.abs(Number(actual.points[part.key][key]) - part[key]) < 0.000001, `${part.key}.${key} disagrees`);
    }
  }
}
console.log(`PASS: SQL and frontend agree for ${expected.length} editor scores, positions, and all five score components.`);
