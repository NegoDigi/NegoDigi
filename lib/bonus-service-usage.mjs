// Ledger-backed breakdown for the Finance > Bonos interface.
// This module is intentionally pure: rendering or editing a bono never debits it.
const baseServices = [
  ["reels", "Reels", "reelPrice"],
  ["youtube", "YouTube", "youtubePrice"],
  ["thumbnails", "Miniaturas", "thumbnailPrice"],
  ["carousels", "Carruseles", "carouselPrice"],
  ["automation", "Automatización", "automationPrice"],
  ["other", "Otros", "otherPrice"],
];

const aliases = {
  reel: "reels",
  reels: "reels",
  short: "reels",
  shorts: "reels",
  "video corto": "reels",
  "videos cortos": "reels",
  youtube: "youtube",
  "video youtube": "youtube",
  "videos youtube": "youtube",
  miniatura: "thumbnails",
  miniaturas: "thumbnails",
  thumbnail: "thumbnails",
  thumbnails: "thumbnails",
  carrusel: "carousels",
  carruseles: "carousels",
  carousel: "carousels",
  carousels: "carousels",
  automatizacion: "automation",
  automatizaciones: "automation",
  automation: "automation",
  automations: "automation",
  otro: "other",
  otros: "other",
  other: "other",
};

function numeric(value) {
  if (value === null || value === undefined || value === "") return 0;
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}
function cents(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function normalized(value) {
  return String(value || "").trim().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
}
function serviceKey(value) {
  const clean = normalized(value);
  return aliases[clean] || clean.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
}

/**
 * @param {Object} input
 * @returns {Array<{service:string,label:string,quantity:number,unitPrice:number,amount:number,unattributedAmount:number}>}
 */
export function calculateBonusServiceUsage(input) {
  const {
    bonusId, usedAmount, movements = [], allowedServices = [],
    rates = [], complementaryServices = [],
  } = input;
  const rows = new Map();
  const prices = new Map();

  function ensure(value) {
    const key = serviceKey(value);
    if (!rows.has(key)) {
      const standard = baseServices.find((item) => item[0] === key);
      rows.set(key, {
        service: key,
        label: standard ? standard[1] : String(value || "Otros").trim(),
        quantity: 0,
        unitPrice: 0,
        amount: 0,
      });
    }
    return rows.get(key);
  }
  for (const [key] of baseServices) ensure(key);
  for (const configured of [...allowedServices, ...rates]) {
    if (!configured || !configured.service) continue;
    const row = ensure(configured.service);
    const price = numeric(configured.client_unit_price);
    if (price > 0) {
      prices.set(row.service, price);
      if (!row.unitPrice) row.unitPrice = price;
    }
  }

  const byComplementaryId = new Map(
    complementaryServices.filter((row) => row && row.id).map((row) => [row.id, row]),
  );
  const ordered = movements
    .filter((movement) => movement.bonus_id === bonusId && movement.movement_type === "usage")
    .slice()
    .sort((a, b) =>
      String(a.created_at || a.occurred_on || "").localeCompare(
        String(b.created_at || b.occurred_on || ""),
      ) || String(a.id || "").localeCompare(String(b.id || "")),
    );

  for (const movement of ordered) {
    const detail = movement.detail && typeof movement.detail === "object" ? movement.detail : {};
    const source = detail.source;
    const snapshot = source === "manual_override";
    const entries = [];
    if (detail.services && typeof detail.services === "object" && !Array.isArray(detail.services)) {
      for (const [name, value] of Object.entries(detail.services)) entries.push([name, value, undefined]);
    } else {
      // Notion/legacy snapshots stored direct quantities and separate prices.
      for (const [name, , priceKey] of baseServices) {
        if (Object.prototype.hasOwnProperty.call(detail, name)) {
          entries.push([name, detail[name], detail[priceKey]]);
        }
      }
    }
    if (entries.length === 0 && detail.service_id && source === "complementary_service_cycle") {
      const service = byComplementaryId.get(String(detail.service_id));
      if (service && (!service.bonus_id || service.bonus_id === bonusId)) {
        // One billing cycle is one service unit; use the actual amount charged.
        entries.push([service.service_name, { quantity: 1, unitPrice: numeric(movement.amount) }, undefined]);
      }
    }

    for (const [name, raw, legacyPrice] of entries) {
      const row = ensure(name);
      const data = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
      const quantity = numeric(data ? data.quantity : raw);
      const declaredPrice = numeric(data ? (data.unitPrice ?? data.unit_price) : legacyPrice);
      const fallbackPrice = prices.get(row.service) || row.unitPrice || 0;
      const unitPrice = declaredPrice > 0 ? declaredPrice : fallbackPrice;
      const explicitAmount = data && data.amount !== undefined ? numeric(data.amount) : null;
      let amount = cents(explicitAmount === null ? quantity * unitPrice : explicitAmount);
      // A single explicitly itemized service with no tariff can still use
      // the posted ledger charge; never invent a tariff for multiple services.
      if (!amount && quantity && entries.length === 1 && numeric(movement.amount) > 0 && !snapshot) {
        amount = cents(numeric(movement.amount));
      }
      row.quantity = cents(snapshot ? quantity : row.quantity + quantity);
      row.amount = cents(snapshot ? amount : row.amount + amount);
      row.unitPrice = row.quantity > 0
        ? cents(row.amount / row.quantity)
        : (unitPrice || 0);
    }
  }

  // The accounting ledger is the authority. Anything not safely itemizable
  // remains explicitly unclassified rather than being invented as extra reels.
  const ledgerTotal = usedAmount === null || usedAmount === undefined
    ? ordered.reduce((sum, movement) => sum + numeric(movement.amount), 0)
    : numeric(usedAmount);
  const itemizedTotal = [...rows.values()].reduce((sum, row) => sum + row.amount, 0);
  const unattributedAmount = cents(ledgerTotal - itemizedTotal);
  return [...rows.values()].map((row) => ({ ...row, unattributedAmount }));
}
