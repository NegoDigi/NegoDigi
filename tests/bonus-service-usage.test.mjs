import test from "node:test";
import assert from "node:assert/strict";
import { calculateBonusServiceUsage } from "../lib/bonus-service-usage.mjs";

const bonusId = "andres";
const record = (id, amount, source, services, created_at) => ({
  id, bonus_id: bonusId, movement_type: "usage", amount, created_at,
  detail: { source, services },
});
const usage = (options) => calculateBonusServiceUsage({
  bonusId, usedAmount: 0, ...options,
});
const service = (rows, key) => rows.find((row) => row.service === key);

test("Andrés: 9 historical + 4 + 5 delivered reels = 18 and 270€ without a second debit", () => {
  const rows = usage({
    usedAmount: 270,
    movements: [
      record("legacy", 135, "manual_override", { reels: { quantity: 9, unitPrice: 15 } }, "2026-10-05"),
      record("first", 60, "delivery_auto", { reels: { quantity: 4, unitPrice: 15 } }, "2026-10-18"),
      record("second", 75, "delivery_auto", { reels: { quantity: 5, unitPrice: 15 } }, "2026-10-23"),
    ],
  });
  assert.equal(service(rows, "reels").quantity, 18);
  assert.equal(service(rows, "reels").unitPrice, 15);
  assert.equal(service(rows, "reels").amount, 270);
  assert.equal(rows[0].unattributedAmount, 0);
});
test("later snapshots replace prior quantities; later automatic deliveries still accumulate", () => {
  const rows = usage({
    usedAmount: 105,
    movements: [
      record("one", 60, "delivery_auto", { reels: { quantity: 4, unitPrice: 15 } }, "2026-01-01"),
      record("edit", 15, "manual_override", { reels: { quantity: 5, unitPrice: 15 } }, "2026-01-02"),
      record("two", 30, "delivery_auto", { reels: { quantity: 2, unitPrice: 15 } }, "2026-01-03"),
    ],
  });
  assert.equal(service(rows, "reels").quantity, 7);
  assert.equal(service(rows, "reels").amount, 105);
  assert.equal(rows[0].unattributedAmount, 0);
});
test("mixed service prices produce exact money and weighted mean (not last unit price)", () => {
  const rows = usage({
    usedAmount: 86,
    movements: [
      record("one", 25, "delivery_auto", { youtube: { quantity: 1, unitPrice: 25 } }, "2026-01-01"),
      record("two", 50, "delivery_auto", { youtube: { quantity: 2, unitPrice: 25 } }, "2026-01-02"),
      record("three", 11, "delivery_auto", { youtube: { quantity: 1, unitPrice: 11 } }, "2026-01-03"),
    ],
  });
  assert.equal(service(rows, "youtube").quantity, 4);
  assert.equal(service(rows, "youtube").amount, 86);
  assert.equal(service(rows, "youtube").unitPrice, 21.5);
});
test("complementary billing cycles show the actual named service", () => {
  const rows = usage({
    usedAmount: 25,
    movements: [{ id: "cycle", bonus_id: bonusId, movement_type: "usage", amount: 25,
      detail: { source: "complementary_service_cycle", service_id: "a" } }],
    complementaryServices: [{ id: "a", bonus_id: bonusId, service_name: "Automatización WhatsApp" }],
  });
  assert.equal(service(rows, "automatizacion-whatsapp").quantity, 1);
  assert.equal(service(rows, "automatizacion-whatsapp").amount, 25);
  assert.equal(rows[0].unattributedAmount, 0);
});
test("legacy flat quantities and unclassified amounts are reconciled without making up units", () => {
  const rows = usage({
    usedAmount: 75,
    movements: [
      { id: "legacy", bonus_id: bonusId, movement_type: "usage", amount: 45,
        detail: { reels: 3, reelPrice: 15 } },
      { id: "unclassified", bonus_id: bonusId, movement_type: "usage", amount: 30,
        detail: { source: "legacy_unclassified" } },
    ],
  });
  assert.equal(service(rows, "reels").quantity, 3);
  assert.equal(service(rows, "reels").amount, 45);
  assert.equal(rows[0].unattributedAmount, 30);
});
test("different custom services remain separate and appear even before their first delivery", () => {
  const rows = usage({
    usedAmount: 48,
    rates: [{ service: "Diseño de banners", client_unit_price: 12 }],
    movements: [record("a", 48, "delivery_auto", {
      "Carruseles": { quantity: 2, unitPrice: 14 },
      "Copywriting": { quantity: 2, unitPrice: 10 },
    }, "2026-01-01")],
  });
  assert.equal(service(rows, "carousels").quantity, 2);
  assert.equal(service(rows, "copywriting").amount, 20);
  assert.equal(service(rows, "diseno-de-banners").quantity, 0);
  assert.equal(rows[0].unattributedAmount, 0);
});
test("a movement outside this bonus and accounting-only adjustments do not count as consumption", () => {
  const rows = usage({
    usedAmount: 15,
    movements: [
      record("a", 15, "delivery_auto", { reels: { quantity: 1, unitPrice: 15 } }, "2026-01-01"),
      { ...record("other-bonus", 30, "delivery_auto", { reels: { quantity: 2, unitPrice: 15 } }, "2026-01-02"), bonus_id: "another" },
      { ...record("adjustment", 0, "manual_bonus_addition", { reels: { quantity: 4, unitPrice: 15 } }, "2026-01-03"), movement_type: "adjustment" },
    ],
  });
  assert.equal(service(rows, "reels").quantity, 1);
  assert.equal(rows[0].unattributedAmount, 0);
});


test("zero-cost included thumbnails reconcile via explicit historical adjustment", () => {
  const rows = usage({
    usedAmount: 484,
    movements: [
      record("initial", 279, "manual_override", {
        reels: {quantity: 35, unitPrice: 5},
        youtube: {quantity: 3, unitPrice: 20},
        thumbnails: {quantity: 2, unitPrice: 7},
        other: {quantity: 1, unitPrice: 30},
      }, "2026-09-21"),
      record("included", 0, "manual_override", {
        reels: {quantity: 35, unitPrice: 5},
        youtube: {quantity: 3, unitPrice: 20},
        thumbnails: {quantity: 5, unitPrice: 7},
        other: {quantity: 1, unitPrice: 30},
      }, "2026-09-26"),
      record("snapshot", 180, "manual_override", {
        reels: {quantity: 52, unitPrice: 5},
        youtube: {quantity: 4, unitPrice: 20},
        thumbnails: {quantity: 5, unitPrice: 7},
        other: {quantity: 3, unitPrice: 30},
        automation: {quantity: 1, unitPrice: 15},
      }, "2026-09-27"),
      record("delivery", 25, "delivery_auto", {reels: {quantity: 5, unitPrice: 5}}, "2026-09-29"),
    ],
  });
  assert.equal(service(rows, "reels").quantity, 57);
  assert.equal(service(rows, "thumbnails").quantity, 5);
  assert.equal(service(rows, "adjustments").amount, -21);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 484);
  assert.equal(rows[0].unattributedAmount, 0);
});
test("negative manual adjustment is separated without erasing historical service counts", () => {
  const rows = usage({
    usedAmount: 510,
    movements: [
      record("snapshot", 535, "manual_override", {
        reels: {quantity: 50, unitPrice: 6.5},
        youtube: {quantity: 8, unitPrice: 20},
        automation: {quantity: 2, unitPrice: 25},
      }, "2026-10-20T10:00:00"),
      record("credit", -50, "manual_override", {
        reels: {quantity: 50, unitPrice: 6.5},
        youtube: {quantity: 8, unitPrice: 20},
      }, "2026-10-20T11:00:00"),
      {id: "cycle", bonus_id: bonusId, movement_type:"usage", amount:25,
        created_at:"2026-10-24", detail:{source:"complementary_service_cycle",service_id:"a"}},
    ],
    complementaryServices: [{id: "a", bonus_id:bonusId, service_name:"Automatización",client_price:25}],
  });
  assert.equal(service(rows, "automation").quantity, 3);
  assert.equal(service(rows, "adjustments").amount, -50);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), 510);
  assert.equal(rows[0].unattributedAmount, 0);
});
