import assert from "node:assert/strict";
import test from "node:test";
import { createRefreshCoordinator, createWorkspaceQueryCache } from "../lib/workspace-refresh.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("serializes concurrent refreshes, merges scopes, and waits for the caller's batch", async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const coordinator = createRefreshCoordinator(async (scopes) => {
    active += 1;
    maxActive = Math.max(active, maxActive);
    calls.push(scopes === null ? null : [...scopes].sort());
    await (calls.length === 1 ? first : second).promise;
    active -= 1;
  });
  const a = coordinator.refresh("profile");
  let bFinished = false;
  const b = coordinator.refresh("production").then(() => { bFinished = true; });
  const c = coordinator.refresh(["finance", "production"]);
  assert.deepEqual(calls, [["profile"]]);
  first.resolve();
  await a;
  assert.equal(bFinished, false);
  assert.deepEqual(calls, [["profile"], ["finance", "production"]]);
  second.resolve();
  await Promise.all([b, c]);
  assert.equal(maxActive, 1);
});

test("a full refresh dominates queued scopes and failures do not stop later batches", async () => {
  const gate = deferred();
  const calls = [];
  const coordinator = createRefreshCoordinator(async (scopes) => {
    calls.push(scopes === null ? null : [...scopes]);
    if (calls.length === 1) { await gate.promise; throw new Error("network failure"); }
  });
  const first = coordinator.refresh("profile");
  const expectedFailure = assert.rejects(first, /network failure/);
  const pending = [coordinator.refresh("production"), coordinator.refresh(), coordinator.refresh("finance")];
  gate.resolve();
  await Promise.all([expectedFailure, ...pending]);
  assert.deepEqual(calls, [["profile"], null]);
  await coordinator.refresh("profile");
  assert.equal(calls.length, 3);
});

test("dispose rejects queued work and prevents later work without overlapping the running request", async () => {
  const gate = deferred();
  let calls = 0;
  const coordinator = createRefreshCoordinator(async () => { calls += 1; await gate.promise; });
  const current = coordinator.refresh();
  const pending = coordinator.refresh("production");
  const rejected = assert.rejects(pending, /disposed/);
  coordinator.dispose();
  await rejected;
  await assert.rejects(coordinator.refresh(), /disposed/);
  gate.resolve();
  await current;
  assert.equal(calls, 1);
});

test("cache skips unrelated fresh queries, but refreshes matching scopes, all scopes, and expired entries", async () => {
  let time = 0;
  let calls = 0;
  const cache = createWorkspaceQueryCache(() => time);
  const factory = () => ({ data: ++calls, error: null });
  const load = (scopes) => cache.load("jobs", factory, scopes, ["production"], 100);
  assert.equal((await load(new Set(["finance"]))).data, 1);
  assert.equal((await load(new Set(["finance"]))).data, 1);
  assert.equal(calls, 1);
  assert.equal((await load(new Set(["production"]))).data, 2);
  assert.equal((await load(null)).data, 3);
  time = 100;
  assert.equal((await load(new Set())).data, 4);
});

test("failed query responses and thrown errors are retried instead of cached", async () => {
  const cache = createWorkspaceQueryCache();
  let calls = 0;
  const factory = () => ({ data: ++calls === 1 ? null : ["ok"], error: calls === 1 ? { message: "temporary" } : null });
  await cache.load("jobs", factory, null, ["production"]);
  assert.deepEqual((await cache.load("jobs", factory, new Set(), ["production"])).data, ["ok"]);
  await assert.rejects(cache.load("jobs", () => { throw new Error("offline"); }, null, ["production"]), /offline/);
  await cache.load("jobs", factory, new Set(), ["production"]);
  assert.equal(calls, 3);
});

test("deduplicates in-flight reads and discards old cache writes after a workspace clear", async () => {
  const cache = createWorkspaceQueryCache();
  const old = deferred();
  let calls = 0;
  const factory = () => { calls += 1; return old.promise; };
  const a = cache.load("profile", factory, null, ["profile"]);
  const b = cache.load("profile", factory, null, ["profile"]);
  await Promise.resolve();
  assert.equal(calls, 1);
  cache.clear();
  await cache.load("profile", () => ({ data: "new", error: null }), null, ["profile"]);
  old.resolve({ data: "old", error: null });
  await Promise.all([a, b]);
  const current = await cache.load("profile", () => assert.fail("fresh value should be cached"), new Set(), ["profile"]);
  assert.equal(current.data, "new");
});
