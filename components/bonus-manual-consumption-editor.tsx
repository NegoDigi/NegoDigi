"use client";

import * as React from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { makeManualBonusAdjustment } from "@/lib/manual-bonus-adjustment.mjs";

type BonusUsageRow = {
  service: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
};
type MovementIdentity = { id: string; bonus_id: string };
type Props = {
  bonusId: string;
  bonusName: string;
  usedAmount: number | string;
  initialAmount: number | string;
  serviceUsage: BonusUsageRow[];
  movements: MovementIdentity[];
};

const euro = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function BonusManualConsumptionEditor({
  bonusId,
  bonusName,
  usedAmount,
  initialAmount,
  serviceUsage,
  movements,
}: Props) {
  const rows = serviceUsage.filter((row) => row.service !== "adjustments");
  const [editing, setEditing] = React.useState(false);
  const [mode, setMode] = React.useState<"add" | "correct">("add");
  const [selected, setSelected] = React.useState("reels");
  const [customService, setCustomService] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [unitPrice, setUnitPrice] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);

  const selectedRow = rows.find((row) => row.service === selected);
  const custom = selected === "__custom__";
  const serviceName = custom ? customService.trim() : (selectedRow?.label || selected);

  React.useEffect(() => {
    if (!editing) return;
    setQuantity(mode === "correct" ? String(selectedRow?.quantity ?? 0) : "1");
    setUnitPrice(selectedRow?.unitPrice ? String(selectedRow.unitPrice) : "");
    setError("");
  // Changes in live props are handled by the save-time ledger revision check.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, mode, selected, bonusId]);

  React.useEffect(() => {
    setEditing(false);
    setNotice("");
    setError("");
    setMode("add");
    setSelected("reels");
    setCustomService("");
  }, [bonusId]);

  const proposal = React.useMemo(() => {
    if (!unitPrice.trim() || !quantity.trim()) return null;
    try {
      return makeManualBonusAdjustment({
        mode, serviceName, quantity: Number(quantity), unitPrice: Number(unitPrice),
        currentRow: custom ? null : selectedRow,
        reason,
      });
    } catch {
      return null;
    }
  }, [mode, serviceName, quantity, unitPrice, selectedRow, reason, custom]);

  async function saveAdjustment() {
    if (savingRef.current) return;
    setError("");
    setNotice("");
    let adjustment;
    try {
      if (!unitPrice.trim() || !quantity.trim()) throw new Error("Introduce unidades y un precio explícito, incluso si es 0 €.");
      if (custom && rows.some((row) => row.label.toLocaleLowerCase("es-ES") === serviceName.toLocaleLowerCase("es-ES"))) {
        throw new Error("El servicio ya existe: selecciónalo en la lista.");
      }
      adjustment = makeManualBonusAdjustment({
        mode, serviceName, quantity: Number(quantity), unitPrice: Number(unitPrice),
        currentRow: custom ? null : selectedRow, reason,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Datos incorrectos.");
      return;
    }

    const changeLabel = euro.format(adjustment.amount);
    const confirmation = mode === "add"
      ? "Vas a añadir " + quantity + " unidades de " + serviceName + " (" + changeLabel + ") al bono " + bonusName + ". ¿Confirmar?"
      : "Vas a corregir " + serviceName + " a " + quantity + " unidades. Variación contable: " + changeLabel + ". ¿Confirmar?";
    if (!window.confirm(confirmation)) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("No se pudo comprobar tu sesión de administrador.");

      // RLS independently enforces owner/admin rights on the INSERT.
      const [profileResult, accountResult, balanceResult, movementResult] = await Promise.all([
        supabase.from("profiles").select("role,organization_id").eq("id", authData.user.id).single(),
        supabase.from("bonus_accounts").select("id,organization_id").eq("id", bonusId).single(),
        supabase.from("bonus_balances").select("used_amount").eq("id", bonusId).single(),
        supabase.from("bonus_movements").select("id").eq("bonus_id", bonusId),
      ]);
      if (profileResult.error || accountResult.error || balanceResult.error || movementResult.error) {
        throw new Error("No se pudo validar el bono. Recarga la información antes de guardarlo.");
      }
      const profile = profileResult.data;
      const account = accountResult.data;
      if (!profile || !["owner", "admin"].includes(profile.role) ||
          !account || profile.organization_id !== account.organization_id) {
        throw new Error("Solo un administrador puede modificar el consumo.");
      }
      const currentUsed = Number(balanceResult.data?.used_amount ?? 0);
      const expectedIds = movements.map((row) => row.id).sort().join(",");
      const currentIds = (movementResult.data || []).map((row) => row.id).sort().join(",");
      if (Math.abs(currentUsed - Number(usedAmount)) > 0.005 || expectedIds !== currentIds) {
        window.dispatchEvent(new Event("negodigi:bonus-manual-updated"));
        throw new Error("Este bono ha cambiado por otra entrega o ajuste. Los datos se están actualizando; vuelve a abrir la edición.");
      }

      const dateParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date());
      const part = (kind: string) => dateParts.find((item) => item.type === kind)?.value || "";
      const madridToday = part("year") + "-" + part("month") + "-" + part("day");

      const { error: insertError } = await supabase.from("bonus_movements").insert({
        organization_id: account.organization_id,
        bonus_id: bonusId,
        movement_type: "usage",
        amount: adjustment.amount,
        description: adjustment.description,
        detail: { ...adjustment.detail, actor_id: authData.user.id },
        occurred_on: madridToday,
      });
      if (insertError) throw new Error("No se pudo guardar el movimiento: " + insertError.message);

      setEditing(false);
      setNotice("Ajuste manual registrado (" + changeLabel + "). Actualizando las unidades y el saldo…");
      setReason("");
      window.dispatchEvent(new Event("negodigi:bonus-manual-updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el movimiento.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-sky-400/20 bg-sky-400/[.035] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-sky-200">Edición manual del consumo</p>
          <p className="mt-1 text-[11px] text-slate-400">
            Añade servicios o corrige sus unidades y precios. Las entregas automáticas se conservan.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setEditing((previous) => !previous); setError(""); setNotice(""); }}
          className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-400/15"
        >
          {editing ? "Cerrar edición" : "Añadir o modificar manualmente"}
        </button>
      </div>

      {editing && (
        <div className="mt-4 space-y-3 border-t border-white/[.08] pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
              Acción
              <select value={mode} onChange={(event) => setMode(event.target.value as "add" | "correct")}
                className="mt-1 h-9 w-full rounded-lg border border-white/[.1] bg-[#111722] px-2 text-sm text-white">
                <option value="add">Añadir unidades entregadas</option>
                <option value="correct">Corregir unidades o precio</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Servicio
              <select value={selected} onChange={(event) => setSelected(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-white/[.1] bg-[#111722] px-2 text-sm text-white">
                {rows.map((row) => <option key={row.service} value={row.service}>{row.label}</option>)}
                {mode === "add" && <option value="__custom__">+ Servicio personalizado</option>}
              </select>
            </label>
          </div>
          {custom && mode === "add" && (
            <label className="block text-xs text-slate-400">
              Nombre del servicio
              <input value={customService} type="text" maxLength={100}
                onChange={(event) => setCustomService(event.target.value)} placeholder="Ej. Diseño de banners"
                className="mt-1 h-9 w-full rounded-lg border border-white/[.1] bg-[#111722] px-3 text-sm text-white" />
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
              {mode === "add" ? "Unidades adicionales" : "Total correcto de unidades"}
              <input type="number" min="0" step="1" value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-white/[.1] bg-[#111722] px-3 text-sm text-white" />
            </label>
            <label className="text-xs text-slate-400">
              {mode === "add" ? "Precio de las unidades añadidas (€)" : "Precio / unidad (€)"}
              <input type="number" min="0" step="0.01" value={unitPrice}
                onChange={(event) => setUnitPrice(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-white/[.1] bg-[#111722] px-3 text-sm text-white" />
            </label>
          </div>
          {mode === "correct" && (
            <p className="text-[11px] text-amber-100/85">
              Unidades actuales: {Number(selectedRow?.quantity ?? 0)}. Solo se modifica el desglose y el cargo del bono; el historial de entregas no se borra.
            </p>
          )}
          <label className="block text-xs text-slate-400">
            Motivo {mode === "correct" ? "(obligatorio)" : "(opcional)"}
            <input type="text" maxLength={160} value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej. 2 vídeos entregados fuera del panel"
              className="mt-1 h-9 w-full rounded-lg border border-white/[.1] bg-[#111722] px-3 text-sm text-white" />
          </label>
          <p className="text-xs text-slate-300">
            {proposal ? (
              <>Variación: <strong className="text-white">{euro.format(proposal.amount)}</strong>
                {" · "}Saldo estimado: <strong className="text-white">{euro.format(Number(initialAmount) - Number(usedAmount) - proposal.amount)}</strong></>
            ) : "Indica unidades y precio válidos para calcular el ajuste."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={saving || !proposal} onClick={() => void saveAdjustment()}
              className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
              {saving ? "Registrando…" : "Guardar ajuste manual"}
            </button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)}
              className="rounded-lg border border-white/[.1] px-3 py-2 text-xs text-slate-300">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
      {notice && <p role="status" className="mt-2 text-xs text-emerald-300">{notice}</p>}
    </section>
  );
}
