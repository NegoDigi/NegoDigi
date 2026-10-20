import type { SupabaseClient } from "@supabase/supabase-js";
export type Details = Record<string, string>;
export type MarketingRecord = {
  id: string;
  organization_id: string;
  name?: string;
  title?: string;
  kind?: string;
  status?: string;
  stage?: string;
  platform?: string;
  contact?: string;
  interest?: string;
  next_action_on?: string;
  publish_on?: string;
  strategy_id?: string;
  source_id?: string;
  details?: Details;
  marketing_details?: Details;
  updated_at: string;
  created_at?: string;
};
export const leadStages = [
  ["new", "Nuevo lead"],
  ["contacted", "Contactado"],
  ["negotiation", "Negociación"],
  ["proposal", "Propuesta enviada"],
  ["active_client", "Cliente recurrente"],
  ["past_client", "Cliente anterior"],
  ["one_off_client", "Cliente puntual"],
  ["lost", "Descartado"],
  ["do_not_contact", "No contactar"],
] as const;
export const contentStages = [
  ["idea", "Idea"],
  ["script", "Guion"],
  ["recording", "Por grabar"],
  ["editing", "En edición"],
  ["scheduled", "Programado"],
  ["published", "Publicado"],
] as const;
export function optionalNumber(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function sumKnown(values: unknown[]): number | null {
  const known = values
    .map(optionalNumber)
    .filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
export function rate(
  numerator: number | null,
  denominator: number | null,
): number | null {
  return numerator === null || denominator === null || denominator <= 0
    ? null
    : (numerator / denominator) * 100;
}
export function normalizeContact(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "");
}
export function stateHistory(value: unknown): { at: string; state: string }[] {
  try {
    const entries = JSON.parse(typeof value === "string" ? value : "[]");
    return Array.isArray(entries)
      ? entries.filter(
          (e) =>
            e &&
            typeof e.at === "string" &&
            typeof e.state === "string" &&
            !Number.isNaN(Date.parse(e.at)),
        )
      : [];
  } catch {
    return [];
  }
}
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export async function persistMarketingRecord(
  db: Pick<SupabaseClient, "from">,
  table: "leads" | "content_items" | "marketing_resources",
  id: string,
  organizationId: string,
  payload: Record<string, unknown>,
  previousVersion?: string,
): Promise<MarketingRecord> {
  const values = { ...payload, organization_id: organizationId };
  const query = previousVersion
    ? db
        .from(table)
        .update(values)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .eq("updated_at", previousVersion)
    : db.from(table).insert({ ...values, id });
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  if (!data)
    throw new Error(
      "No se confirmó el guardado. Actualiza y vuelve a intentarlo.",
    );
  return data as MarketingRecord;
}
export function safeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function contentEvents(records: MarketingRecord[]) {
  return records
    .flatMap((record) =>
      [
        {
          date: record.marketing_details?.record_on,
          type: "Grabación",
          record,
        },
        { date: record.marketing_details?.edit_on, type: "Edición", record },
        { date: record.publish_on, type: "Publicación", record },
      ].filter(
        (
          event,
        ): event is { date: string; type: string; record: MarketingRecord } =>
          !!event.date,
      ),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
