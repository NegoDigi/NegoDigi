import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Método no permitido" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response({ error: "Sesión no válida" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return response({ error: "La función no está configurada" }, 500);

  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: identity, error: identityError } = await admin.auth.getUser(authorization.slice(7));
  if (identityError || !identity.user) return response({ error: "Sesión no válida" }, 401);
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,access_state")
    .eq("id", identity.user.id)
    .single();
  if (profileError || !profile || ["revoked", "archived"].includes(profile.access_state || "")) {
    return response({ error: "Este acceso no está autorizado" }, 403);
  }
  const { data: activated, error: updateError } = await admin.from("profiles")
    .update({ active: true, access_state: "active", updated_at: new Date().toISOString() })
    .eq("id", identity.user.id)
    .not("access_state", "in", "(revoked,archived)")
    .select("id").maybeSingle();
  if (updateError) return response({ error: "No se pudo activar el acceso" }, 500);
  if (!activated) return response({ error: "Este acceso ya no está autorizado" }, 403);
  return response({ ok: true });
});
