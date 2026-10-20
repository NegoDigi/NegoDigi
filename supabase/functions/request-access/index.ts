import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const genericResponse = () => new Response(JSON.stringify({ ok: true }), {
  status: 202,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 100) break;
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return genericResponse();
  try {
  const body = await request.json().catch(() => ({})) as { email?: string; kind?: "activation" | "recovery" };
  const email = body.email?.trim().toLowerCase();
  if (!email || !["activation", "recovery"].includes(body.kind || "")) return genericResponse();
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) throw new Error("Service not configured");

  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const user = await findUserByEmail(admin, email);
  if (!user) return genericResponse();
  const { data: profile, error: profileError } = await admin.from("profiles").select("organization_id,active,access_state").eq("id", user.id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile || ["revoked", "archived"].includes(profile.access_state || "")) return genericResponse();
  const isEligible = body.kind === "activation" ? !profile.active : profile.active;
  if (!isEligible) return genericResponse();
  const { error: requestError } = await admin.from("access_link_requests").upsert({
    organization_id: profile.organization_id,
    user_id: user.id,
    request_kind: body.kind,
    requested_at: new Date().toISOString(),
    handled_at: null,
  }, { onConflict: "organization_id,user_id,request_kind" });
  if (requestError) throw requestError;
  return genericResponse();
  } catch {
    return new Response(JSON.stringify({ error: "No se pudo registrar la solicitud. Inténtalo de nuevo." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
