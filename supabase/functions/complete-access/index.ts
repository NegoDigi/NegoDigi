import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://app.negodigi.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);
const baseHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};
function responseHeaders(request: Request) {
  const headers = new Headers(baseHeaders);
  headers.set("Content-Type", "application/json");
  const origin = request.headers.get("origin");
  if (!origin || allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin || "https://app.negodigi.com");
  return headers;
}
const response = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: responseHeaders(request),
});

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rateLimit(admin: ReturnType<typeof createClient>, key: string, maxAttempts: number, windowSeconds: number) {
  const { data, error } = await admin.rpc("account_setup_take_limit", {
    limit_key: await hash(key),
    max_attempts: maxAttempts,
    window_seconds: windowSeconds,
  });
  if (error) throw error;
  return data === true;
}

Deno.serve(async (request) => {
  const send = (body: unknown, status = 200) => response(request, body, status);
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(request) });
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return send({ error: "Origen no permitido." }, 403);
  if (request.method !== "POST") return send({ error: "Método no permitido" }, 405);
  if (Number(request.headers.get("content-length") || 0) > 1024) return send({ error: "Solicitud demasiado grande." }, 413);
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return send({ error: "Sesión no válida" }, 401);
    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !service) return send({ error: "La función no está configurada" }, 503);

    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: identity, error: identityError } = await admin.auth.getUser(authorization.slice(7));
    if (identityError || !identity.user) return send({ error: "Sesión no válida" }, 401);
    if (!await rateLimit(admin, `complete-access:${identity.user.id}`, 12, 900)) return send({ error: "Demasiadas solicitudes. Espera unos minutos." }, 429);
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,organization_id,active,access_state")
      .eq("id", identity.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || ["revoked", "archived"].includes(profile.access_state || "")) {
      return send({ error: "Este acceso no está autorizado" }, 403);
    }

    // Recovery links for existing users can finish without changing their
    // status. Only an administrator-created invitation may activate a user.
    if (profile.active === true && profile.access_state === "active") return send({ ok: true });
    if (profile.active !== false || profile.access_state !== "pending_invitation") {
      return send({ error: "Este acceso no está autorizado" }, 403);
    }

    const { data: activated, error: updateError } = await admin.from("profiles")
      .update({ active: true, access_state: "active", updated_at: new Date().toISOString() })
      .eq("id", identity.user.id)
      .eq("organization_id", profile.organization_id)
      .eq("active", false)
      .eq("access_state", "pending_invitation")
      .select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!activated) return send({ error: "Este acceso ya no está autorizado" }, 403);
    return send({ ok: true });
  } catch {
    return send({ error: "No se pudo completar la operación. Inténtalo de nuevo." }, 503);
  }
});

