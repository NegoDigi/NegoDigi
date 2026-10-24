export type InlineBonusUsageRow = {
 service: string;
 label: string;
 quantity: number;
 unitPrice: number;
 amount?: number;
};
export type InlineBonusDraft = Record<string, { quantity: string; unitPrice: string }>;
export type InlineBonusPatch = {
 movement_type: "usage";
 amount: number;
 description: string;
 detail: {
  source: "manual_override";
  manual_version: number;
  reason: string;
  method: "inline_grid";
  services: Record<string,{quantity:number;unitPrice:number;amount:number}>;
 };
};
export function buildInlineBonusPatch(
 currentRows: InlineBonusUsageRow[],
 drafts: InlineBonusDraft,
): InlineBonusPatch | null;
