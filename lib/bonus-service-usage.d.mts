export type BonusServiceSummary = {
  service: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  unattributedAmount: number;
};
export type BonusLedgerMovement = {
  id?: string;
  bonus_id: string;
  movement_type: string;
  amount: number | string;
  occurred_on?: string | null;
  created_at?: string | null;
  detail?: Record<string, unknown> | null;
};
export type BonusCatalogService = {
  service: string;
  client_unit_price?: number | string | null;
};
export type ComplementaryBonusService = {
  id: string;
  bonus_id?: string | null;
  service_name: string;
  client_price?: number | string | null;
};
export function calculateBonusServiceUsage(input: {
  bonusId: string;
  usedAmount: number | string | null | undefined;
  movements?: readonly BonusLedgerMovement[];
  allowedServices?: readonly BonusCatalogService[];
  rates?: readonly BonusCatalogService[];
  complementaryServices?: readonly ComplementaryBonusService[];
}): BonusServiceSummary[];
