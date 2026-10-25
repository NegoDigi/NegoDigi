import type { SupabaseClient } from "@supabase/supabase-js";

export async function callAccountSetup<T>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke("account-setup", { body });
  if (error) {
    let message = "No se pudo conectar. Inténtalo de nuevo.";
    if (error.context instanceof Response) {
      const result = await error.context.clone().json().catch(() => null);
      if (typeof result?.error === "string") message = result.error;
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

