export type ManualServiceRow = { quantity: number; unitPrice: number; amount?: number };
export type ManualBonusAdjustment = {
 amount: number;
 movement_type: "usage";
 description: string;
 detail: {
  source: "manual_service_adjustment" | "manual_override";
  manual_version: number;
  reason: string | null;
  services: Record<string, {quantity: number; unitPrice: number; amount: number}>;
 };
};
export function euroCents(value: number | string): number;
export function makeManualBonusAdjustment(input: {
 mode: "add" | "correct";
 serviceName: string;
 quantity: number;
 unitPrice: number;
 currentRow?: ManualServiceRow | null;
 reason?: string;
}): ManualBonusAdjustment;
