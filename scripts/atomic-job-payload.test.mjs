import assert from "node:assert/strict";
import test from "node:test";
import { buildCreateJobPayload, buildUpdateJobPayload } from "../lib/production/atomic-job.ts";

const ids = () => { let next = 1; return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`; };

test("create preserves allocations for distinct rows sharing a service name", () => {
  const payload = buildCreateJobPayload({
    status: "pending", clientId: "client", assignedOn: "", dueOn: "", deliveredOn: "",
    services: [{ id: "a", service: "Reels", quantity: 2 }, { id: "b", service: "Reels", quantity: 3 }],
    assignments: [{ id: "draft", editorId: "editor", quantities: { a: 2, b: 3 } }],
  }, ids());
  assert.notEqual(payload.items[0].id, payload.items[1].id);
  assert.deepEqual(payload.assignments[0].quantities, {
    [payload.items[0].id]: 2, [payload.items[1].id]: 3,
  });
  assert.equal(payload.assignments[0].is_new, true);
});

test("update remaps new service references consistently in allocations and progress", () => {
  const payload = buildUpdateJobPayload(
    { id: "job", client_id: "client", job_assignments: [{ id: "existing-assignment" }] },
    { due_on: null },
    [{ id: "old-item", service: "Reels", quantity: 1 }, { id: "new-service", service: "Miniatura", quantity: 2 }],
    [{ id: "new-service", delivered: 1 }],
    [{ id: "existing-assignment", editorId: "editor", quantities: { "old-item": 1, "new-service": 2 } }],
    ids(),
  );
  assert.equal(payload.items[0].id, "old-item");
  assert.equal(payload.items[0].is_new, false);
  assert.equal(payload.items[1].service, "Miniaturas");
  assert.equal(payload.items[1].is_new, true);
  assert.equal(payload.progress[0].id, payload.items[1].id);
  assert.equal(payload.assignments[0].quantities[payload.items[1].id], 2);
  assert.equal(payload.assignments[0].id, "existing-assignment");
  assert.equal(payload.assignments[0].is_new, false);
  assert.equal(payload.due_on, null);
  assert.equal(Object.hasOwn(payload, "assigned_on"), false);
});

test("planned orders never create assignments and historical dates survive serialization", () => {
  const draft = { status: "planned", clientId: "client", assignedOn: "2026-09-10", dueOn: "", deliveredOn: "2026-08-09",
    services: [{ id: "a", service: "Reels", quantity: 2 }],
    assignments: [{ id: "draft", editorId: "editor", quantities: { a: 2 } }],
  };
  assert.deepEqual(buildCreateJobPayload(draft, ids()).assignments, []);
  const historical = buildCreateJobPayload({ ...draft, status: "history" }, ids());
  assert.equal(historical.mode, "history");
  assert.equal(historical.delivered_on, "2026-08-09");
});
