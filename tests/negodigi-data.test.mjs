import assert from "node:assert/strict";
import test from "node:test";

import { seed } from "../app/data/seed.ts";

const sum = (rows) => Number(rows.reduce((total, row) => total + row.amount, 0).toFixed(2));

test("keeps the reconciled NegoDigi finance totals exact", () => {
  const income = seed.finance.filter((row) => row.type === "Ingreso");
  const expenses = seed.finance.filter((row) => row.type === "Gasto");

  assert.equal(seed.finance.length, 141);
  assert.equal(income.length, 99);
  assert.equal(expenses.length, 42);
  assert.equal(sum(income), 24221.07);
  assert.equal(sum(expenses), 4024.9);
  assert.equal(Number((sum(income) - sum(expenses)).toFixed(2)), 20196.17);
  assert.ok(seed.finance.every((row) => row.project === "NegoDigi"));
});

test("keeps source record counts and balances reconciled", () => {
  assert.equal(seed.clients.length, 63);
  assert.equal(seed.editors.length, 6);
  assert.equal(seed.pending.length, 10);
  assert.equal(seed.history.length, 23);
  assert.equal(seed.bonuses.length, 24);
  assert.equal(seed.pricing.length, 76);
  assert.equal(seed.receivables.length, 8);
  assert.equal(sum(seed.receivables), 987);
  assert.equal(
    Number(seed.bonuses.reduce((total, bonus) => total + bonus.remaining, 0).toFixed(2)),
    7991.5,
  );
});

test("keeps finance months in chronological January-to-August order", () => {
  const months = [...new Set(seed.finance.map((row) => row.date.slice(0, 7)))].sort();
  assert.deepEqual(months, [
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
  ]);
});
