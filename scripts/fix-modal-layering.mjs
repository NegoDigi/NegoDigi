import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.cwd(), "app/globals.css");
const marker = "NEGODIGI_MODAL_LAYER_FIX_20261024";
const current = readFileSync(file, "utf8");

if (current.includes(marker)) {
  console.log("NegoDigi modal layering: already patched");
} else {
  if (!current.includes(".app-header") || !current.includes(".app-main")) {
    throw new Error("Expected NegoDigi header/main styles are missing. Refusing unsafe modal patch.");
  }
  appendFileSync(file, "\n/* NEGODIGI_MODAL_LAYER_FIX_20261024\n   Modal overlays in the main workspace must cover the global sticky header\n   and fixed sidebar. Restrict the stacking change to open dialogs; normal\n   header dropdowns and sticky navigation remain unaffected.\n*/\n@supports selector(.app-main:has(.fixed.inset-0)) {\n  .app-shell .app-main:has(.fixed.inset-0),\n  .app-shell .app-main:has([aria-modal=\"true\"]) {\n    position: relative !important;\n    z-index: 200 !important;\n  }\n}\n", "utf8");
  console.log("NegoDigi modal layering: fix applied (dialog-only main stacking context)");
}
