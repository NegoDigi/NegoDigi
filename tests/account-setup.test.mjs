import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../supabase/functions/account-setup/protocol.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const protocol = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("first-access proof uses a separate 256-bit random bearer secret", async () => {
  const first = protocol.createSetupSecret();
  const second = protocol.createSetupSecret();
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
  const hash = await protocol.hashSetupSecret(first);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, first);
  assert.equal(await protocol.hashSetupSecret(first), hash);
  assert.notEqual(await protocol.hashSetupSecret(second), hash);
  const reference = protocol.createSetupReference();
  assert.match(reference, /^[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(protocol.validSetupProof(crypto.randomUUID(), reference), false, "The human reference cannot authorize password setup");
});

test("setup validates canonical email, bounded password, and exact proof shape", () => {
  assert.equal(protocol.normalizeSetupEmail(" Editor@Example.com "), "editor@example.com");
  for (const email of [null, {}, "", "a@@example.com", "a@example.com\nother@example.com", `${"a".repeat(255)}@example.com`]) assert.equal(protocol.normalizeSetupEmail(email), null);
  assert.equal(protocol.validSetupProof(crypto.randomUUID(), protocol.createSetupSecret()), true);
  assert.equal(protocol.validSetupProof("not-a-request", protocol.createSetupSecret()), false);
  assert.equal(protocol.validSetupProof(crypto.randomUUID(), "a".repeat(63)), false);
  assert.equal(protocol.validSetupPassword("1234567890"), true);
  for (const password of [null, 1234567890, "123456789", "x".repeat(73)]) assert.equal(protocol.validSetupPassword(password), false);
});

test("password boundary uses UTF-8 bytes, including accents and emoji", () => {
  assert.equal(protocol.validSetupPassword("x".repeat(72)), true);
  assert.equal(protocol.validSetupPassword("é".repeat(36)), true);
  assert.equal(protocol.validSetupPassword("é".repeat(37)), false);
  assert.equal(protocol.validSetupPassword("🙂".repeat(18)), true);
  assert.equal(protocol.validSetupPassword("🙂".repeat(19)), false);
});
