import { makeManualBonusAdjustment, euroCents } from "./manual-bonus-adjustment.mjs";

// One atomic ledger event per inline-grid edit, even if the user changed
// several fields. A snapshot patches only the changed services.
export function buildInlineBonusPatch(currentRows, drafts) {
  const services = {};
  let change = 0;
  const labels = [];
  for (const row of currentRows) {
    if (row.service === "adjustments") continue;
    const draft = drafts[row.service];
    if (!draft) continue;
    const parsedQuantity = draft.quantity.trim() === "" ? 0 : Number(draft.quantity);
    const parsedUnitPrice = draft.unitPrice.trim() === "" ? 0 : Number(draft.unitPrice);
    if (parsedQuantity === Number(row.quantity) &&
        parsedUnitPrice === Number(row.unitPrice)) continue;
    const patch = makeManualBonusAdjustment({
      mode: "correct",
      serviceName: row.service,
      quantity: parsedQuantity,
      unitPrice: parsedUnitPrice,
      currentRow: row,
      reason: "Cambio directo en consumo de bono",
    });
    services[row.service] = patch.detail.services[row.service];
    change = euroCents(change + patch.amount);
    labels.push(row.label);
  }
  if (!labels.length) return null;
  return {
    movement_type: "usage",
    amount: change,
    description: "Edición directa del consumo · " + labels.join(", ").slice(0,160),
    detail: {
      source: "manual_override",
      manual_version: 3,
      reason: "Campos de consumo editados por administrador",
      method: "inline_grid",
      services,
    },
  };
}
