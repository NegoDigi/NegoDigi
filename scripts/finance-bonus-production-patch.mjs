import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const originalPath = resolve(process.cwd(), "app/operating-system.tsx");
const input = readFileSync(originalPath, "utf8");

const patchFinanceBonusFile = function patchFinanceBonusFile(input) {
  const marker = "/* NEGODIGI_LEDGER_BONUS_V1 */";
  if (input.includes(marker)) return input;
  let source = input;
  const change=(oldValue,newValue,label)=>{
    const count=source.split(oldValue).length-1;
    if(count!==1)throw new Error(`${label} marker occurrences=${count} (expected 1), preventing unsafe patch`);
    source=source.replace(oldValue,newValue);
  };
  const section=(begin,end,transform,label)=>{
    const a=source.indexOf(begin);
    const b=source.indexOf(end,a+begin.length);
    if(a<0||b<a)throw new Error("Missing boundaries: "+label);
    const old=source.slice(a,b),replacement=transform(old);
    if(old===replacement)throw new Error("No change in "+label);
    source=source.slice(0,a)+replacement+source.slice(b);
  };
  change('"use client";','"use client";\n'+marker+'\nimport { calculateBonusServiceUsage } from "@/lib/bonus-service-usage.mjs";',"Ledger import");
  change('type BonusServiceKey = "reels" | "youtube" | "thumbnails" | "other";','type BonusServiceKey = string;',"Service key type");
  change(
    'type BonusServiceUsage = {\n  service: BonusServiceKey;\n  label: string;\n  quantity: number;\n  unitPrice: number;\n  /** Existing usage rows without service-level detail must remain in the total. */\n  unattributedAmount?: number;\n};',
    'type BonusServiceUsage = {\n  service: BonusServiceKey;\n  label: string;\n  quantity: number;\n  unitPrice: number;\n  amount?: number;\n  /** Accounting adjustments are displayed separately without changing billable units. */\n  unattributedAmount?: number;\n};',"Service row type"
  );
  section("const bonusServiceDefinitions:","function isEditorialEditor(",()=>String.raw`function bonusServiceUsage(
  bonus: Bonus,
  movements: BonusMovement[],
  rates: ClientRate[] = [],
  complementaryServices: Array<{
    id: string;
    bonus_id: string | null;
    service_name: string;
    client_price: number | string | null;
  }> = [],
): BonusServiceUsage[] {
  return calculateBonusServiceUsage({
    bonusId: bonus.id,
    usedAmount: bonus.used_amount,
    movements,
    allowedServices: bonus.allowed_services || [],
    rates,
    complementaryServices,
  });
}
`,"Ledger service accumulator");
  section("function FinanceBonusesManagement(","function FinanceBonusesWorkspace(",(value)=>{
    let str=value;
    const old=String.raw`  const [drawerMode, setDrawerMode] = React.useState<"detail" | "edit">(
    "detail",
  );`;
    const next=old+String.raw`
  const [complementaryCatalog, setComplementaryCatalog] = React.useState<
    Array<{ id: string; bonus_id: string | null; service_name: string; client_price: number | string | null }>
  >([]);
  React.useEffect(() => {
    if (!selectedId) return;
    const current = bonuses.find((item) => item.id === selectedId);
    if (!current) return;
    let active = true;
    void createSupabaseBrowserClient()
      .from("complementary_services")
      .select("id,bonus_id,service_name,client_price")
      .eq("client_id", current.client_id)
      .then(({ data, error }) => {
        if (active && !error) setComplementaryCatalog((data || []) as typeof complementaryCatalog);
      });
    return () => { active = false; };
  }, [selectedId]);`;
    const replaceLocal=(x,y,label)=>{if(str.split(x).length!==2)throw Error("Finance management: "+label+" count "+(str.split(x).length-1));str=str.replace(x,y)};
    replaceLocal(old,next,"complementary-service state");
    replaceLocal('serviceUsage={bonusServiceUsage(selected, selectedMovements)}','serviceUsage={bonusServiceUsage(selected, selectedMovements, selectedRates, complementaryCatalog)}',"ledger input");
    return str;
  },"Finance management");
  const inputUpdateRegex=/onChange=\{\(event\) =>\s*setUsage\(\(current\) =>[\s\S]*?\n\s*\}\n\s*(?=className)/g;
  function readonlyForm(value,finance) {
    let s=value;
    const local=(x,y,label)=>{const n=s.split(x).length-1;if(n!==1)throw Error("Read only "+(finance?"finance":"bonuses")+": "+label+" count="+n);s=s.replace(x,y)};
    local("const [usage, setUsage] = React.useState(serviceUsage);","const usage = serviceUsage;","usage is live");
    local("const unattributedAmount = Math.max(0, number(usage[0]?.unattributedAmount));","const unattributedAmount = number(usage[0]?.unattributedAmount);","signed residual");
    local("sum + row.quantity * row.unitPrice","sum + (row.amount ?? row.quantity * row.unitPrice)","exact amount");
    local("            usage_breakdown: usage,\n","","do not post a charge when saving");
    local("    usage_breakdown: BonusServiceUsage[];\n","","no usage input");
    let replaced=0;
    s=s.replace(inputUpdateRegex,()=>{replaced++;return "readOnly\n                  "});
    if(replaced!==2)throw Error("Expected 2 readonly consumption inputs, got "+replaced);
    if(finance)local("Unidades y precio real usados para este bono.","Unidades y precios calculados automáticamente a partir de los servicios entregados.","finance description");
    else local("Ajusta las unidades y el precio real de cada servicio. Esto solo\n              corrige este bono manualmente.","El consumo se actualiza automáticamente con cada entrega registrada.","bonuses description");
    local("euro.format(row.quantity * row.unitPrice)","euro.format(row.amount ?? row.quantity * row.unitPrice)","row amount");
    local("        {unattributedAmount > 0 && (","        {Math.abs(unattributedAmount) >= 0.01 && (","residual signs");
    if(finance) {
      local("{euro.format(unattributedAmount)} de consumos históricos no tienen\n            desglose y se conserva en el total.","Diferencia pendiente de conciliar: {euro.format(unattributedAmount)}. El saldo se conserva.","unattributed label");
      const old=String.raw`          {usage.map((row) => (
            <div
              key={row.service}
              className="rounded-lg border border-white/[.07] p-2"
            >
              <p className="text-xs font-medium text-slate-200">{row.label}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">`;
      const newer=String.raw`          {usage.map((row) => (
            <div
              key={row.service}
              className="rounded-lg border border-white/[.07] p-2"
            >
              <p className="text-xs font-medium text-slate-200">{row.label}</p>
              {row.service === "adjustments" ? (
                <p className="mt-2 text-[11px] text-amber-200/80">
                  Ajuste contable histórico, separado de las entregas.
                </p>
              ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">`;
      local(old,newer,"adjustment row opening");
      const closing=String.raw`                </label>
              </div>
              <p className="mt-1 text-right text-[11px] text-slate-400">
                {euro.format(row.amount ?? row.quantity * row.unitPrice)}
              </p>`;
      const replacedClosing=String.raw`                </label>
              </div>
              )}
              <p className="mt-1 text-right text-[11px] text-slate-400">
                {euro.format(row.amount ?? row.quantity * row.unitPrice)}
              </p>`;
      local(closing,replacedClosing,"adjustment row closure");
    } else {
      // The legacy "Bonos" view also must not debit finance when updating the bono's metadata.
      // Retain the rest of the existing form and the ability to update name/initial credit.
    }
    if(s.includes("setUsage("))throw Error("Usage setter remains in "+(finance?"finance":"bonos")+" form");
    return s;
  }
  section("function FinanceBonusConfigForm(","function LegacyFinancialAnalytics(",v=>readonlyForm(v,true),"Finance service cards");
  section("function BonusEditForm(","function ",v=>readonlyForm(v,false),"Bonos service cards");
  if(source.length<input.length-15000||source.length>input.length+17000)throw Error("Unexpected patch size change");
  return source;
};

const result = patchFinanceBonusFile(input);
if(result !== input) {
 writeFileSync(originalPath, result, "utf8");
 console.log("NegoDigi bonos: patch applied to original production source, bytes=" + input.length + "->" + result.length);
} else {
 console.log("NegoDigi bonos: already patched");
}
