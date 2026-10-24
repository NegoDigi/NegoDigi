import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.cwd(), "app/operating-system.tsx");
const input = readFileSync(file, "utf8");
const marker = "/* NEGODIGI_MANUAL_BONUS_EDITOR_V2 */";
if (input.includes(marker)) {
  console.log("NegoDigi manual bonus editor: already applied");
  process.exit(0);
}
if (!input.includes("/* NEGODIGI_LEDGER_BONUS_V1 */")) {
  throw new Error("Apply the automatic bonus reconciliation before the manual adjustment patch.");
}
let source = input;
function replaceOnce(oldText, newText, label) {
  const n = source.split(oldText).length - 1;
  if (n !== 1) throw new Error(label + " should occur once; found " + n);
  source = source.replace(oldText, newText);
}
function patchSection(startText, endText, fn, label) {
  const a = source.indexOf(startText), b = source.indexOf(endText, a + startText.length);
  if (a < 0 || b < 0 || b <= a) throw new Error(label + ": section boundaries missing");
  const before = source.slice(a, b), after = fn(before);
  if (before === after) throw new Error(label + ": no changes made");
  source = source.slice(0, a) + after + source.slice(b);
}
replaceOnce(
  '"use client";',
  '"use client";\n' + marker + '\nimport { BonusManualConsumptionEditor } from "@/components/bonus-manual-consumption-editor";',
  "Manual editor import",
);

patchSection("function BonusEditForm(", "const financeMonthNames = [", (part) => {
  const signature = "  serviceUsage,\n  onCancel,\n  onSave,\n}: {\n  bonus: Bonus;\n  serviceUsage: BonusServiceUsage[];";
  if (part.split(signature).length !== 2) throw new Error("BonusEditForm signature mismatch");
  part = part.replace(signature,
    "  serviceUsage,\n  movements = [],\n  onCancel,\n  onSave,\n}: {\n  bonus: Bonus;\n  serviceUsage: BonusServiceUsage[];\n  movements?: BonusMovement[];");
  const saveButtons = '      <div className="md:col-span-4 flex gap-2">';
  if (part.split(saveButtons).length !== 2) throw new Error("Legacy Bonos footer changed");
  const editor = '      <div className="md:col-span-4">\n' +
    '        <BonusManualConsumptionEditor key={bonus.id} bonusId={bonus.id} bonusName={bonus.name} usedAmount={bonus.used_amount} initialAmount={bonus.initial_amount} serviceUsage={usage} movements={movements} />\n' +
    '      </div>\n';
  return part.replace(saveButtons, editor + saveButtons);
}, "Bonos editor");

patchSection("function BonusesView(", "function BonusCreateForm(", (part) => {
  const before = 'serviceUsage={bonusServiceUsage(bonus, bonusMovements)}';
  const n = part.split(before).length - 1;
  if (n !== 1) throw new Error("BonusesView usage invocation count " + n);
  return part.replace(before, before + '\n                        movements={bonusMovements.filter((row) => row.bonus_id === bonus.id)}');
}, "BonusesView ledger binding");

patchSection("function FinanceBonusConfigForm(", "function LegacyFinancialAnalytics(", (part) => {
  const signature = "  serviceUsage,\n  onCancel,\n  onSave,\n}: {\n  bonus: Bonus;\n  rates: ClientRate[];\n  serviceUsage: BonusServiceUsage[];";
  if (part.split(signature).length !== 2) throw new Error("Finance config signature mismatch");
  part = part.replace(signature,
    "  serviceUsage,\n  movements = [],\n  onCancel,\n  onSave,\n}: {\n  bonus: Bonus;\n  rates: ClientRate[];\n  serviceUsage: BonusServiceUsage[];\n  movements?: BonusMovement[];");
  const before = '      <label className="block text-xs text-slate-400">\n        Notas';
  if (part.split(before).length !== 2) throw new Error("Finance notes anchor mismatch");
  const manualEditor =
    '      <BonusManualConsumptionEditor key={bonus.id} bonusId={bonus.id} bonusName={bonus.name} usedAmount={bonus.used_amount} initialAmount={bonus.initial_amount} serviceUsage={usage} movements={movements} />\n';
  return part.replace(before, manualEditor + before);
}, "Finance bonuses editor");

patchSection("function FinanceBonusesManagement(", "function FinanceBonusesWorkspace(", (part) => {
  const before = 'serviceUsage={bonusServiceUsage(selected, selectedMovements, selectedRates, complementaryCatalog)}';
  if (part.split(before).length !== 2) throw new Error("Finance management usage binding mismatch");
  return part.replace(before, before + '\n                movements={selectedMovements}');
}, "Finance management movement identities");

replaceOnce(
  '  const refreshHiringLeads = React.useCallback(async () => {',
  '  React.useEffect(() => {\n' +
  '    const onBonusManualSaved = () => { void refresh(["bonuses", "finance"]); };\n' +
  '    window.addEventListener("negodigi:bonus-manual-updated", onBonusManualSaved);\n' +
  '    return () => window.removeEventListener("negodigi:bonus-manual-updated", onBonusManualSaved);\n' +
  '  }, [refresh]);\n' +
  '  const refreshHiringLeads = React.useCallback(async () => {',
  "Scoped refresh subscription",
);
writeFileSync(file, source, "utf8");
console.log("NegoDigi manual bonus editor: enabled in Bonos and Finanzas, bytes " + input.length + " to " + source.length);
