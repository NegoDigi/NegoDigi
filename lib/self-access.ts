import type { SupabaseClient } from "@supabase/supabase-js";

type SelfAccessResponse = {
  ok?: boolean;
  email?: string;
  role?: "owner" | "admin" | "editor" | "client";
  error?: string;
};

export async function completeSelfAccess(
  client: SupabaseClient,
  email: string,
  password: string,
) {
  const { data, error } = await client.functions.invoke<SelfAccessResponse>(
    "self-access",
    { body: { email, password } },
  );

  if (error) {
    let message = "No se pudo preparar el acceso. Inténtalo de nuevo.";
    if (error.context instanceof Response) {
      const result = await error.context.clone().json().catch(() => null);
      if (typeof result?.error === "string") message = result.error;
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
