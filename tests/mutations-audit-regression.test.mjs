import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Execute the actual UI handlers with a Data API double. A denied UPDATE can
// return zero rows without an error; .single() must make this a failed save.
const source = fs.readFileSync(new URL('../app/operating-system.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(root, predicate) {
  if (predicate(root)) return root;
  let result;
  root.forEachChild((child) => { if (!result) result = findNode(child, predicate); });
  return result;
}
function declaration(name) {
  const found = findNode(ast, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(found, `${name} exists`);
  return found;
}
function executeFunction(name, bindings) {
  const code = ts.transpileModule(declaration(name).getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return ${name};`)(...Object.values(bindings));
}
function executeExpression(expression, bindings) {
  const code = ts.transpileModule(`const value = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), `${code}; return value;`)(...Object.values(bindings));
}
function variable(functionName, name) {
  const found = findNode(declaration(functionName), (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
  assert.ok(found?.initializer, `${functionName}.${name} exists`);
  return found.initializer.getText(ast);
}
function harness({ row = { id: 'saved-row' }, apiError = null } = {}) {
  const errors = [], notices = [], refreshes = [], writes = [];
  let selectRequested = false;
  const result = () => ({ data: selectRequested ? row : null, error: apiError });
  const query = {
    update(payload) { writes.push(payload); return this; },
    insert(payload) { writes.push(payload); return this; },
    delete() { return this; },
    eq() { return this; },
    select() { selectRequested = true; return this; },
    single() { return Promise.resolve({ data: row, error: apiError || (!row ? { message: 'No row was changed', code: 'PGRST116' } : null) }); },
    then(resolve) { return Promise.resolve(result()).then(resolve); },
  };
  const bindings = {
    blockPreviewMutation: () => false,
    profile: { id: 'administrator', organization_id: 'organization', role: 'admin' },
    supabase: { from: () => query, auth: { getSession: async () => ({ data: { session: { user: { id: 'administrator' } } } }) } },
    setError: (message) => errors.push(message), setNotice: (message) => notices.push(message),
    refresh: async (scope) => { refreshes.push(scope); },
  };
  return { bindings, errors, notices, refreshes, writes };
}

test('an RLS-filtered bonus update stays failed and does not emit success', async () => {
  const h = harness({ row: null });
  const save = executeFunction('updateBonus', h.bindings);
  assert.equal(await save('bonus', { name: 'Production', initial_amount: 250, declared_pending_amount: 0, paid_on: '2026-09-10' }), false);
  assert.equal(h.errors.length, 1);
  assert.deepEqual(h.notices, []);
  assert.deepEqual(h.refreshes, []);
});

test('confirmed bonus update refreshes only its data group', async () => {
  const h = harness();
  const save = executeFunction('updateBonus', h.bindings);
  assert.equal(await save('bonus', { name: ' Production ', initial_amount: 250, declared_pending_amount: 0, paid_on: '2026-09-10' }), true);
  assert.equal(h.writes[0].name, 'Production');
  assert.deepEqual(h.refreshes, ['bonuses']);
});

test('a missing delivery cannot be reported as updated or deleted', async () => {
  for (const name of ['updateDelivery', 'deleteDelivery']) {
    const h = harness({ row: null });
    const save = executeFunction(name, h.bindings);
    assert.equal(await save('missing', { quantity: 2, delivered_on: '2026-09-10' }), false);
    assert.equal(h.errors.length, 1);
  }
});

test('all bonus dialogs preserve the form after a failed save', async () => {
  const wrappers = [];
  function visit(node) {
    if (ts.isArrowFunction(node) && /^\{\s*(?:const saved = )?await on(?:Update|Create)Bonus\(/.test(node.body.getText(ast))) wrappers.push(node);
    node.forEachChild(visit);
  }
  visit(ast);
  assert.ok(wrappers.length >= 8, 'all bonus create/edit drawers are covered');
  for (const wrapper of wrappers) {
    const changes = [];
    const callback = executeExpression(wrapper.getText(ast), {
      onUpdateBonus: async () => false, onCreateBonus: async () => false,
      bonus: { id: 'bonus' }, selected: { id: 'bonus' },
      setEditingId: (...args) => changes.push(args), setDrawerMode: (...args) => changes.push(args),
      setSelectedId: (...args) => changes.push(args), setShowForm: (...args) => changes.push(args), setShowCreate: (...args) => changes.push(args),
    });
    assert.equal(await callback({}), false);
    assert.deepEqual(changes, [], `failed save did not close: ${wrapper.getStart(ast)}`);
  }
});

test('current presence includes point-in-time declarations with ended_at set', () => {
  const old = { id: 'old', editor_id: 'editor', status: 'available', started_at: '2026-09-09T10:00:00Z', created_at: '2026-09-09T10:00:00Z', ended_at: null };
  const latest = { ...old, id: 'new', status: 'active', started_at: '2026-09-10T10:00:00Z', created_at: '2026-09-10T10:00:00Z', ended_at: '2026-09-10T10:00:00Z' };
  const selected = executeExpression(variable('EditorAvailabilityControl', 'latest'), { activity: [old, latest], editor: { id: 'editor' } });
  assert.equal(selected.id, 'new');
});

test('partial delivery history leaves the unfinished job visible to its editor', () => {
  const partial = { id: 'partly-delivered', status: 'pending' };
  const jobs = [partial, { id: 'done', status: 'delivered' }, { id: 'cancelled', status: 'cancelled' }];
  const actual = executeExpression(variable('EditorProductionCenterV2', 'workingJobs'), {
    React: { useMemo: (fn) => fn() }, activeJobs: jobs,
    completedJobIds: new Set(['partly-delivered', 'done']),
  });
  assert.deepEqual(actual, [partial]);
});

test('planning updates preserve their creator and create a valid one-hour interval', async () => {
  const h = harness({ row: { id: 'task', status: 'pending' } });
  let planning = [{ id: 'task', created_by: 'original-editor' }];
  const save = executeFunction('savePlanningBlock', {
    ...h.bindings, previewRole: null, recordPreviewAction: async () => {},
    setEditorPlanning: (updater) => { planning = updater(planning); },
  });
  assert.equal(await save({ id: 'task', editorId: 'editor', title: 'Edit', startsAt: '2026-09-10T10:00:00Z', endsAt: '2026-09-10T10:00:00Z', note: '', jobId: '', status: 'pending' }), true);
  assert.equal('created_by' in h.writes[0], false);
  assert.equal(h.writes[0].ends_at, '2026-09-10T11:00:00.000Z');
  assert.deepEqual(h.refreshes, ['planning']);
});

test('a failed attachment URL lookup is not automatically retried forever', () => {
  const files = [{ id: 'failed-file', correction_id: 'correction' }, { id: 'new-file', correction_id: 'correction' }];
  const unresolved = executeExpression(variable('VideoCorrectionsPanel', 'filesToResolve'), {
    visibleFiles: files, correctionIds: new Set(['correction']), attachmentUrls: { 'failed-file': null },
  });
  assert.deepEqual(unresolved, [files[1]]);
});
