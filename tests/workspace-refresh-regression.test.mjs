import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createRefreshCoordinator, createWorkspaceQueryCache } from "../lib/workspace-refresh.ts";

// Execute production callbacks, with only network/React state boundaries mocked.
const source = fs.readFileSync(new URL("../app/operating-system.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("app.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(root, predicate) {
  if (predicate(root)) return root;
  let result;
  root.forEachChild((child) => { if (!result) result = findNode(child, predicate); });
  return result;
}
const component = findNode(ast, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "OperatingSystem");
assert.ok(component);
function callback(name) {
  const node = findNode(component, (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
  assert.ok(node?.initializer && ts.isCallExpression(node.initializer), name);
  return node.initializer.arguments[0];
}
const refreshNode = callback("runRefresh");
const clearNode = callback("clearWorkspace");
const listenerNode = findNode(component, (node) => ts.isCallExpression(node) && node.expression.getText(ast) === "supabase.auth.onAuthStateChange").arguments[0];
function execute(node, bindings) {
  const code = ts.transpileModule(`const value = (${node.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return value;`)(...Object.values(bindings));
}
function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}
const existingProfile = {
  role: "admin", display_name: "Administrator", organization_id: "organization",
  editor_id: null, client_id: null, active: true, access_state: "active",
};
function harness(options = {}) {
  const writes = [], reads = [], timers = [];
  const state = new Map();
  const bindings = {
    refreshEpoch: { current: 1 }, initialLoad: { current: false },
    lastProfile: { current: existingProfile }, sessionIdentity: { current: "user" },
    accessRecordedFor: { current: "user" }, maintenanceAt: { current: Date.now() },
    queryCache: createWorkspaceQueryCache(), defaultRankingSettings: { value_weight: 40 },
    resolvePortalRole: (role) => ["admin", "owner", "editor", "client"].includes(role) ? role : null,
    isAdministrativeRole: (role) => ["admin", "owner"].includes(role),
    hydrateDeliveryItems: (items) => items, jobProductionJoin: "job_production(*)",
    madridMonthKey: () => "2026-09", navigator: { userAgent: "test" },
    console: { error: () => {} },
    refresh: async () => {},
    window: { setTimeout: (fn) => { timers.push(fn); return timers.length; } },
  };
  function collectSetters(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^set[A-Z]/.test(node.expression.text)) {
      const name = node.expression.text;
      bindings[name] = (value) => {
        writes.push([name, value]);
        state.set(name, typeof value === "function" ? value(state.get(name)) : value);
      };
      state.set(name, [{ id: "previous-workspace-data" }]);
    }
    node.forEachChild(collectSetters);
  }
  [refreshNode, clearNode, listenerNode].forEach(collectSetters);
  state.set("setProfile", existingProfile);
  const empty = { data: [], error: null };
  bindings.supabase = {
    auth: {
      getSession: options.getSession || (async () => ({ data: { session: { user: { id: "user" }, expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null })),
      getUser: options.getUser || (async () => ({ data: { user: { id: "user" } }, error: null })),
      refreshSession: async () => ({ data: {}, error: null }),
    },
    from(table) {
      reads.push(table);
      const result = table === "profiles" ? options.profileResult || { data: existingProfile, error: null } : options.results?.[table] || empty;
      const query = new Proxy({}, {
        get(_target, key) {
          if (key === "then") return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
          return () => query;
        },
      });
      return query;
    },
    rpc(name) { reads.push(`rpc:${name}`); return Promise.resolve(empty); },
    functions: { invoke(name) { reads.push(`function:${name}`); return Promise.resolve({ data: { users: [], access_requests: [] }, error: null }); } },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://example.invalid/asset" }, error: null }) }) },
  };
  bindings.clearWorkspace = execute(clearNode, bindings);
  return { bindings, state, writes, reads, timers, run: execute(refreshNode, bindings), listener: execute(listenerNode, bindings) };
}

test("temporary Auth and profile failures preserve the previously validated workspace", async () => {
  for (const options of [
    { getUser: async () => ({ data: { user: null }, error: { status: 503, message: "temporarily unavailable" } }) },
    { profileResult: { data: null, error: { code: "57014", message: "query timed out" } } },
    {
      getSession: async () => ({ data: { session: null }, error: { status: 0, name: "AuthRetryableFetchError", message: "Failed to fetch" } }),
      getUser: async () => ({ data: { user: null }, error: { status: 0, name: "AuthRetryableFetchError", message: "Failed to fetch" } }),
    },
  ]) {
    const h = harness(options);
    await h.run(null);
    assert.equal(h.bindings.lastProfile.current, existingProfile);
    assert.equal(h.state.get("setProfile"), existingProfile);
    assert.equal(h.writes.some(([name]) => name === "setProfile" || name === "setJobs" || name === "setEditors"), false);
    assert.match(h.state.get("setConnectionIssue"), /conectar|conexión|permisos/);
    assert.equal(h.state.get("setLoading"), false);
  }
});

test("an account change during Auth validation discards the old response and its final state writes", async () => {
  const started = deferred(), response = deferred();
  const h = harness({ getUser: () => { started.resolve(); return response.promise; } });
  const running = h.run(null);
  await started.promise;
  h.bindings.refreshEpoch.current += 1;
  h.writes.length = 0;
  response.resolve({ data: { user: { id: "old-account" } }, error: null });
  await running;
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.reads, []);
});

test("an account change while data is loading prevents stale dataset commits", async () => {
  const response = deferred(), started = deferred();
  const h = harness({ results: { clients: response.promise } });
  const originalFrom = h.bindings.supabase.from;
  h.bindings.supabase.from = (table) => { if (table === "clients") started.resolve(); return originalFrom(table); };
  const running = h.run(null);
  await started.promise;
  h.bindings.refreshEpoch.current += 1;
  h.bindings.queryCache.clear();
  h.writes.length = 0;
  response.resolve({ data: [{ id: "old-client" }], error: null });
  await running;
  assert.deepEqual(h.writes, []);
});

test("a confirmed empty session clears previous account datasets", async () => {
  const h = harness({
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
  });
  await h.run(null);
  assert.equal(h.state.get("setProfile"), null);
  assert.equal(h.bindings.lastProfile.current, null);
  for (const name of ["setJobs", "setClients", "setEditors", "setTransactions", "setBonuses", "setReceivables", "setEditorPlanning", "setDirectoryUsers"]) {
    assert.deepEqual(h.state.get(name), [], name);
  }
  assert.equal(h.state.get("setAccessError"), null);
});

test("Auth listener ignores normal token/focus events and clears data and preview on sign-out", () => {
  const h = harness();
  h.listener("TOKEN_REFRESHED", { user: { id: "user" } });
  h.listener("SIGNED_IN", { user: { id: "user" } });
  assert.deepEqual(h.writes, []);
  assert.equal(h.bindings.refreshEpoch.current, 1);
  h.listener("SIGNED_OUT", null);
  assert.equal(h.bindings.refreshEpoch.current, 2);
  assert.equal(h.bindings.lastProfile.current, null);
  assert.equal(h.state.get("setProfile"), null);
  assert.equal(h.state.get("setPreviewRole"), null);
  assert.equal(h.state.get("setEditorPreviewId"), "");
  assert.equal(h.state.get("setClientPreviewId"), "");
  assert.deepEqual(h.state.get("setJobs"), []);
  assert.deepEqual(h.state.get("setEditors"), []);
  assert.equal(h.timers.length, 1);
});

test("activity and checklist refreshes skip unrelated network factories after initial loading", async () => {
  const h = harness();
  await h.run(null);
  assert.ok(h.reads.length > 30, "initial workspace was loaded");
  h.reads.length = 0;
  await h.run(new Set(["activity", "planning"]));
  assert.deepEqual(h.reads.sort(), ["editor_activity_events", "editor_planning_blocks", "profiles"]);
});

test("a real role change on the same account discards cached administrator datasets", async () => {
  const profileResult = { data: { ...existingProfile }, error: null };
  const h = harness({
    profileResult,
    results: {
      bonus_balances: { data: [{ id: "administrator-only-bonus" }], error: null },
      client_private: { data: [{ client_id: "client", notes: "administrator-only" }], error: null },
    },
  });
  await h.run(null);
  assert.equal(h.state.get("setBonuses")[0].id, "administrator-only-bonus");
  assert.equal(h.state.get("setClientPrivate")[0].notes, "administrator-only");

  profileResult.data = { ...existingProfile, role: "editor", editor_id: "editor-1" };
  h.reads.length = 0;
  await h.run(new Set(["directory"]));

  assert.equal(h.state.get("setProfile").role, "editor");
  assert.deepEqual(h.state.get("setBonuses"), []);
  assert.deepEqual(h.state.get("setClientPrivate"), []);
  assert.deepEqual(h.state.get("setDirectoryUsers"), []);
  assert.equal(h.reads.includes("bonus_balances"), false, "restricted factory is skipped for the new role");
  assert.equal(h.reads.includes("client_private"), false, "restricted private data is not requested");
  assert.ok(h.reads.includes("jobs"), "authorized datasets are fetched again under the new permissions");
});

test("200 overlapping workspace refresh requests run at most two serial batches", async () => {
  const started = deferred(), gate = deferred();
  let authCalls = 0;
  const h = harness({ getUser: async () => {
    authCalls += 1;
    if (authCalls === 1) { started.resolve(); await gate.promise; }
    return { data: { user: { id: "user" } }, error: null };
  } });
  let runs = 0, active = 0, maximumActive = 0;
  const coordinator = createRefreshCoordinator(async (scopes) => {
    runs += 1; active += 1; maximumActive = Math.max(maximumActive, active);
    try { await h.run(scopes); } finally { active -= 1; }
  });
  const first = coordinator.refresh();
  await started.promise;
  const queued = Array.from({ length: 200 }, (_, index) => coordinator.refresh(index % 2 ? "activity" : "planning"));
  gate.resolve();
  await Promise.all([first, ...queued]);
  assert.equal(runs, 2);
  assert.equal(maximumActive, 1);
  assert.equal(authCalls, 2);
  assert.equal(h.state.get("setProfile"), existingProfile);
  assert.equal(h.state.get("setConnectionIssue"), null);
});
