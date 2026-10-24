import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(dir, "../scripts/fix-modal-layering.mjs"),"utf8");
test("modal overlay patch keeps regular navigation unchanged", () => {
 assert.match(source, /:has\(\.fixed\.inset-0\)/);
 assert.match(source, /:has\(\[aria-modal=/);
 assert.match(source, /position: relative !important/);
 assert.match(source, /z-index: 200 !important/);
 assert.doesNotMatch(source, /\.app-header\s*\{[^}]*z-index\s*:/);
});
test("patch is idempotent and verifies expected shell", () => {
 assert.match(source, /current\.includes\(marker\)/);
 assert.match(source, /Expected NegoDigi header\/main styles are missing/);
});
