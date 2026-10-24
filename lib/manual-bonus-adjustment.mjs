// Every manual action is a separate, auditable bonus ledger movement.
export function euroCents(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
export function makeManualBonusAdjustment({
  mode, serviceName, quantity, unitPrice, currentRow, reason,
}) {
  const label = String(serviceName || "").trim();
  const q = Number(quantity), price = Number(unitPrice);
  const oldQ = Number(currentRow?.quantity ?? 0), oldPrice = Number(currentRow?.unitPrice ?? 0);
  const oldAmount = euroCents(currentRow?.amount ?? oldQ * oldPrice);
  if (!label || label.length > 100 || label.toLowerCase() === "ajustes históricos") {
    throw new Error("Selecciona un servicio válido.");
  }
  if (!Number.isInteger(q) || q < 0 || q > 100000 ||
      !Number.isFinite(price) || price < 0 || price > 1000000 ||
      Math.abs(euroCents(price) - price) > 0.00000001) {
    throw new Error("Las unidades deben ser enteras y el precio debe tener como máximo dos decimales.");
  }
  if (mode !== "add" && mode !== "correct") throw new Error("Modo de ajuste no válido.");
  if (mode === "add" && q < 1) throw new Error("Para añadir consumo, indica al menos una unidad.");
  if (mode === "correct" &&
    (!currentRow || !Number.isInteger(oldQ) || (q === oldQ && price === oldPrice))) {
    throw new Error("Cambia las unidades o el precio para registrar una corrección.");
  }
  const note = String(reason || "").trim();
  if (mode === "correct" && note.length < 3) {
    throw new Error("Indica el motivo de la corrección (al menos 3 caracteres).");
  }
  const source = mode === "add" ? "manual_service_adjustment" : "manual_override";
  const targetAmount = mode === "add"
    ? euroCents(q * price)
    : Math.abs(price - oldPrice) < 0.005
      ? euroCents(oldAmount + (q - oldQ) * price)
      : euroCents(q * price);
  const delta = euroCents(mode === "add" ? targetAmount : targetAmount - oldAmount);
  const labelAction = mode === "add" ? "Alta manual" : "Corrección manual";
  return {
    amount: delta,
    movement_type: "usage",
    description: labelAction + " · " + label + (note ? " · " + note.slice(0, 160) : ""),
    detail: {
      source, manual_version: 2, reason: note || null,
      services: { [label]: { quantity: q, unitPrice: price, amount: targetAmount } },
    },
  };
}
