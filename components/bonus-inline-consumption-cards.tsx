"use client";

import * as React from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buildInlineBonusPatch } from "@/lib/inline-bonus-patch.mjs";

export type BonusInlineUsage = {
  service: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
  unattributedAmount?: number;
};
type MovementRef = { id: string; bonus_id: string };
type Props = {
  bonusId: string;
  bonusName: string;
  usedAmount: number | string;
  rows: BonusInlineUsage[];
  movements: MovementRef[];
  variant?: "compact" | "wide";
};
type Draft = Record<string, { quantity: string; unitPrice: string }>;

const euro = new Intl.NumberFormat("es-ES", {
  style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const draftsFrom = (rows: BonusInlineUsage[]): Draft => Object.fromEntries(
  rows.filter(row => row.service !== "adjustments").map(row => [
    row.service, { quantity: String(row.quantity), unitPrice: String(row.unitPrice) },
  ]),
);

export function BonusInlineConsumptionCards({
  bonusId, bonusName, usedAmount, rows, movements, variant = "compact",
}: Props) {
  const editableRows = rows.filter(row => row.service !== "adjustments");
  const historicalAdjustments = rows.filter(row => row.service === "adjustments");
  const fingerprint = JSON.stringify(editableRows.map(row =>
    [row.service, row.quantity, row.unitPrice, row.amount]));

  const [drafts, setDrafts] = React.useState<Draft>(() => draftsFrom(editableRows));
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "ok" | "error"; text: string } | null>(null);
  const busyRef = React.useRef(false);
  const gridFocused = React.useRef(false);
  const skipNextBlur = React.useRef(false);
  const baselineRef = React.useRef({
    used: Number(usedAmount),
    rows: editableRows,
    ids: movements.map(m => m.id).sort(),
  });

  React.useEffect(() => {
    if (gridFocused.current) return;
    baselineRef.current = {
      used: Number(usedAmount),
      rows: editableRows,
      ids: movements.map(m => m.id).sort(),
    };
    setDrafts((current) => {
      const newDrafts = draftsFrom(editableRows);
      return JSON.stringify(current) === JSON.stringify(newDrafts) ? current : newDrafts;
    });
  // Only update from new ledger values, not parent component rerenders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bonusId, fingerprint]);

  const edit = (service: string, field: "quantity" | "unitPrice", value: string) => {
    setDrafts(prev => ({ ...prev, [service]: { ...prev[service], [field]: value } }));
    setMessage(null);
  };
  const reset = (row: BonusInlineUsage) => {
    const baseline = baselineRef.current.rows.find(item => item.service === row.service) || row;
    setDrafts(prev => ({
      ...prev,
      [row.service]: { quantity: String(baseline.quantity), unitPrice: String(baseline.unitPrice) },
    }));
    setMessage(null);
  };

  async function saveChangedCards() {
    if (busyRef.current) return;
    const baseline = baselineRef.current;
    let change: ReturnType<typeof buildInlineBonusPatch>;
    try {
      change = buildInlineBonusPatch(baseline.rows, drafts);
      if (!change) return;
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Revisa los importes." });
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setMessage({ type: "ok", text: "Guardando cambios…" });
    try {
      const supabase = createSupabaseBrowserClient();
      const [auth, account, balance, ledger] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("bonus_accounts").select("organization_id").eq("id", bonusId).single(),
        supabase.from("bonus_balances").select("used_amount").eq("id", bonusId).single(),
        supabase.from("bonus_movements").select("id").eq("bonus_id", bonusId),
      ]);
      if (auth.error || !auth.data.user) throw new Error("Necesitas una sesión de administrador válida.");
      if (account.error || balance.error || ledger.error || !account.data) {
        throw new Error("No se pudo comprobar el estado del bono. Vuelve a intentarlo.");
      }
      const currentIds = (ledger.data || []).map(m => m.id).sort().join(",");
      if (currentIds !== baseline.ids.join(",") ||
          Math.abs(Number(balance.data?.used_amount) - baseline.used) > 0.005) {
        window.dispatchEvent(new Event("negodigi:bonus-manual-updated"));
        throw new Error("Han llegado nuevas entregas o cambios. Se está actualizando el bono; revisa las casillas antes de guardar.");
      }

      const dateParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric",
      }).formatToParts(new Date());
      const part = (key: string) => dateParts.find(p => p.type === key)?.value || "";
      const occurredOn = part("year") + "-" + part("month") + "-" + part("day");
      const { data: inserted, error: insertError } = await supabase.from("bonus_movements").insert({
        organization_id: account.data.organization_id,
        bonus_id: bonusId,
        movement_type: "usage",
        amount: change.amount,
        description: change.description,
        detail: { ...change.detail, actor_id: auth.data.user.id },
        occurred_on: occurredOn,
      }).select("id").single();

      if (insertError || !inserted) throw new Error("No se pudo guardar el ajuste: " + (insertError?.message || "sin confirmación"));
      // Apply the saved change optimistically. Repeated blurs before a refresh
      // must not duplicate the same debit or credit.
      baselineRef.current = {
        used: baseline.used + change.amount,
        ids: [...baseline.ids, inserted.id].sort(),
        rows: baseline.rows.map(row => {
          const saved = change.detail.services[row.service];
          return saved ? { ...row, quantity: saved.quantity, unitPrice: saved.unitPrice, amount: saved.amount } : row;
        }),
      };
      setMessage({ type: "ok", text: "Guardado automáticamente" });
      window.dispatchEvent(new Event("negodigi:bonus-manual-updated"));
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "No se ha guardado." });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, row: BonusInlineUsage) => {
    if (event.key === "Escape") {
      skipNextBlur.current = true;
      reset(row);
      event.currentTarget.blur();
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  return (
    <div
      className={variant === "wide" ? "mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" : "mt-3 grid gap-2 sm:grid-cols-2"}
      onFocus={() => { gridFocused.current = true; }}
      onBlur={event => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        gridFocused.current = false;
        if (skipNextBlur.current) { skipNextBlur.current = false; return; }
        void saveChangedCards();
      }}
    >
      {editableRows.map(row => {
        const draft = drafts[row.service] || { quantity: String(row.quantity), unitPrice: String(row.unitPrice) };
        const base = baselineRef.current.rows.find(item => item.service === row.service) || row;
        const q = draft.quantity.trim() === "" ? 0 : Number(draft.quantity);
        const p = draft.unitPrice.trim() === "" ? 0 : Number(draft.unitPrice);
        const changed = q !== Number(base.quantity) || p !== Number(base.unitPrice);
        const amount = changed && Number.isFinite(q) && Number.isFinite(p)
          ? (Math.abs(p - base.unitPrice) < 0.005
            ? Number(base.amount ?? base.quantity * base.unitPrice) + (q - base.quantity) * p
            : q * p)
          : Number(base.amount ?? base.quantity * base.unitPrice);
        return (
          <div
            key={row.service}
            className={variant === "wide"
              ? "rounded-xl border border-white/[.07] bg-white/[.02] p-3"
              : "rounded-lg border border-white/[.07] p-2"}
          >
            <p className={variant === "wide" ? "text-sm font-medium text-slate-200" : "text-xs font-medium text-slate-200"}>
              {row.label}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className={variant === "wide" ? "block text-[11px] text-slate-500" : "text-[10px] text-slate-500"}>
                Unidades
                <input
                  aria-label={"Unidades consumidas de " + row.label}
                  type="number" min="0" step="1" disabled={busy}
                  value={draft.quantity}
                  onChange={event => edit(row.service, "quantity", event.target.value)}
                  onKeyDown={event => onGridKeyDown(event, row)}
                  className={variant === "wide"
                    ? "mt-1 h-9 w-full rounded-lg border border-white/[.08] bg-[#111722] px-2 text-sm text-white"
                    : "mt-1 h-8 w-full rounded border border-white/[.08] bg-[#111722] px-2 text-xs text-white"}
                />
              </label>
              <label className={variant === "wide" ? "block text-[11px] text-slate-500" : "text-[10px] text-slate-500"}>
                Precio / unidad
                <input
                  aria-label={"Precio por unidad de " + row.label}
                  type="number" min="0" step="0.01" disabled={busy}
                  value={draft.unitPrice}
                  onChange={event => edit(row.service, "unitPrice", event.target.value)}
                  onKeyDown={event => onGridKeyDown(event, row)}
                  className={variant === "wide"
                    ? "mt-1 h-9 w-full rounded-lg border border-white/[.08] bg-[#111722] px-2 text-sm text-white"
                    : "mt-1 h-8 w-full rounded border border-white/[.08] bg-[#111722] px-2 text-xs text-white"}
                />
              </label>
            </div>
            <p className="mt-1 text-right text-[11px] text-slate-400">{euro.format(amount)}</p>
          </div>
        );
      })}
      {historicalAdjustments.map(row => (
        <div key={row.service} className="rounded-lg border border-white/[.07] p-2">
          <p className="text-xs font-medium text-slate-200">{row.label}</p>
          <p className="mt-1 text-[11px] text-amber-200/80">Ajuste histórico, sin modificar unidades entregadas.</p>
          <p className="mt-1 text-right text-[11px] text-slate-400">{euro.format(row.amount || 0)}</p>
        </div>
      ))}
      {message && (
        <p role={message.type === "error" ? "alert" : "status"}
          className={"text-[11px] sm:col-span-2 " + (message.type === "error" ? "text-rose-300" : "text-slate-400")}>
          {message.text}
        </p>
      )}
    </div>
  );
}
