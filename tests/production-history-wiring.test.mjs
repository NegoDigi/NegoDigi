import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/operating-system.tsx", import.meta.url), "utf8");

test("wires the historical-record deletion handler into both Production history views", () => {
  assert.match(source, /onDeleteHistoricalProductionRecord=\{deleteHistoricalProductionRecord\}/);
  assert.match(source, /onDelete=\{onDeleteHistoricalProductionRecord\}/);
  assert.doesNotMatch(source, /onDelete=\{deleteHistoricalProductionRecord\}/);
});

test("keeps total history selectable without deriving a previous month from the all-period value", () => {
  assert.match(source, /function previousPeriodKey\(periodKey: string\) \{\s+if \(!\/\^\\d\{4\}-\\d\{2\}\$\//);
  assert.match(source, /const comparisonEditors = historicalComparisonEditors\.filter/);
});

test("uses isolated historical closes rather than Finance for monthly production reporting", () => {
  assert.match(source, /production_historical_month_closures/);
  assert.match(source, /const closure = closures\.find/);
  assert.match(source, /const fallbackTeamPayment = rows\.filter/);
  assert.doesNotMatch(source, /const financialRows = transactions\.filter/);
  assert.match(source, /label="Importe de producción"/);
  assert.match(source, /label="Facturación bruta"/);
  assert.match(source, /label="Beneficio neto"/);
});

test("limits Gestión to the current operational month while preserving the monthly archive", () => {
  assert.match(source, /const operationalPeriod = madridMonthKey\(\)/);
  assert.match(source, /const monthJobs = jobs\.filter\(belongsToOperationalMonth\)/);
  assert.match(source, /row\.period_key === operationalPeriod/);
});
