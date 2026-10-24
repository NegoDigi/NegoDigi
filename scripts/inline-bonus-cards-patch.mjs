import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.cwd(),"app/operating-system.tsx");
const input = readFileSync(file,"utf8");
const marker = "/* NEGODIGI_DIRECT_EDIT_BONUS_V3 */";
if(input.includes(marker)){
  console.log("NegoDigi direct bonus fields already patched");
  process.exit(0);
}
if(!input.includes("/* NEGODIGI_LEDGER_BONUS_V1 */")){
  throw new Error("The automatic bonus ledger patch must run before direct editing.");
}
if(input.includes("NEGODIGI_MANUAL_BONUS_EDITOR_V2")){
  throw new Error("The old manual editor panel must not be used for this release.");
}
let source=input;
function once(oldText,newText,label){
  const n=source.split(oldText).length-1;
  if(n!==1)throw new Error(label+": expected one anchor, got "+n);
  source=source.replace(oldText,newText);
}
function inSection(start,end,edit,label){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 if(a<0||b<0||b<=a)throw new Error(label+": missing section boundary");
 const old=source.slice(a,b),updated=edit(old);
 if(old===updated)throw new Error(label+": no changes applied");
 source=source.slice(0,a)+updated+source.slice(b);
}
once('"use client";','"use client";\n'+marker+'\nimport { BonusInlineConsumptionCards } from "@/components/bonus-inline-consumption-cards";',"inline cards import");

function withCards(form,layout){
  const pattern=layout==="wide"
    ? /        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">\n          \{usage\.map\(\(row\) => \([\s\S]*?\n          \)\)\}\n        <\/div>/
    : /        <div className="mt-3 grid gap-2 sm:grid-cols-2">\n          \{usage\.map\(\(row\) => \([\s\S]*?\n          \)\)\}\n        <\/div>/;
  const all=form.match(new RegExp(pattern.source,"g"))||[];
  if(all.length!==1)throw new Error(layout+": expected one existing service grid, got "+all.length);
  form=form.replace(pattern,
    '        <BonusInlineConsumptionCards key={bonus.id} bonusId={bonus.id} bonusName={bonus.name} '+
    'usedAmount={bonus.used_amount} rows={usage} movements={movements} variant="'+layout+'" />');
  return form;
}
inSection("function BonusEditForm(","const financeMonthNames = [",(form)=>{
 const sig="  serviceUsage,\n  onCancel,\n  onSave,\n}: {\n  bonus: Bonus;\n  serviceUsage: BonusServiceUsage[];";
 if(form.split(sig).length!==2)throw new Error("Bonos form props changed");
 form=form.replace(sig,"  serviceUsage,\n  movements = [],\n  onCancel,\n  onSave,\n}: {\n  bonus: Bonus;\n  serviceUsage: BonusServiceUsage[];\n  movements?: BonusMovement[];");
 form=withCards(form,"wide");
 form=form.replace("El consumo se actualiza automáticamente con cada entrega registrada.",
  "Entregas automáticas y cambios manuales. Edita directamente las casillas; se guarda al salir.");
 return form;
},"original Bonos edit form");

inSection("function BonusesView(","function BonusCreateForm(",(view)=>{
 const anchor="serviceUsage={bonusServiceUsage(bonus, bonusMovements)}";
 if(view.split(anchor).length!==2)throw new Error("BonusesView ledger call not unique");
 return view.replace(anchor,anchor+"\n                        movements={bonusMovements.filter((item) => item.bonus_id === bonus.id)}");
},"BonusesView service ledger");

inSection("function FinanceBonusConfigForm(","function LegacyFinancialAnalytics(",(form)=>{
 const sig="  serviceUsage,\n  onCancel,\n  onSave,\n}: {\n  bonus: Bonus;\n  rates: ClientRate[];\n  serviceUsage: BonusServiceUsage[];";
 if(form.split(sig).length!==2)throw new Error("Finance form props changed");
 form=form.replace(sig,"  serviceUsage,\n  movements = [],\n  onCancel,\n  onSave,\n}: {\n  bonus: Bonus;\n  rates: ClientRate[];\n  serviceUsage: BonusServiceUsage[];\n  movements?: BonusMovement[];");
 form=withCards(form,"compact");
 const label="Unidades y precios calculados automáticamente a partir de los servicios entregados.";
 if(form.split(label).length!==2)throw new Error("Finance consumption description changed");
 form=form.replace(label,"Edita unidades y precio directamente; el cambio se guarda al salir de la tarjeta.");
 return form;
},"Finance consumption card grid");

inSection("function FinanceBonusesManagement(","function FinanceBonusesWorkspace(",(management)=>{
 const call="serviceUsage={bonusServiceUsage(selected, selectedMovements, selectedRates, complementaryCatalog)}";
 if(management.split(call).length!==2)throw new Error("Finance management serviceUsage prop changed");
 return management.replace(call,call+"\n                movements={selectedMovements}");
},"Finance movement identity binding");

const refreshAnchor="  const refreshHiringLeads = React.useCallback(async () => {";
const effect=[
 '  React.useEffect(() => {',
 '    const onInlineSaved = () => { void refresh(["bonuses", "finance"]); };',
 '    window.addEventListener("negodigi:bonus-manual-updated", onInlineSaved);',
 '    return () => window.removeEventListener("negodigi:bonus-manual-updated", onInlineSaved);',
 '  }, [refresh]);',
 ''
].join("\n");
once(refreshAnchor,effect+refreshAnchor,"scoped refresh after saving a card");

if(source.length < input.length-14000 || source.length > input.length+7000) {
  throw new Error("Unexpected source size change; refusing unsafe release.");
}
if(source.includes("Añadir o modificar manualmente")) {
 throw new Error("Legacy manual panel is still present.");
}
writeFileSync(file,source,"utf8");
console.log("NegoDigi bonos: original cards editable again; preserved automatic ledger, bytes "+input.length+" to "+source.length);
