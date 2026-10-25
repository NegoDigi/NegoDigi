import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://app.negodigi.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);
const responseHeaders = (request: Request) => {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
};
const respond = (request: Request, body: unknown, status = 202) => new Response(JSON.stringify(body), {
  status,
  headers: responseHeaders(request),
});
const genericResponse = (request: Request) => respond(request, { ok: true });

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rateLimit(admin: ReturnType<typeof createClient>, key: string, max: number, seconds: number) {
  const { data, error } = await admin.rpc("account_setup_take_limit", {
    limit_key: await hash(key),
    max_attempts: max,
    window_seconds: seconds,
  });
  if (error) throw error;
  return data === true;
}

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
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return respond(request, { error: "Origen no permitido." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(request) });
  if (request.method !== "POST") return respond(request, { error: "Método no permitido." }, 405);
  if (Number(request.headers.get("content-length") || 0) > 1024) return genericResponse(request);

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 1024) return genericResponse(request);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return genericResponse(request);
    const body = parsed as { email?: unknown; kind?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !["activation", "recovery"].includes(String(body.kind))) return genericResponse(request);

    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !service) throw new Error("Missing service configuration");
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    // Cloudflare overwrites cf-connecting-ip at the edge; x-real-ip may be
    // supplied by the caller and must not be trusted for rate-limit identity.
    const ip = (request.headers.get("cf-connecting-ip") || "unknown").slice(0, 128);
    const [ipAllowed, emailAllowed, globalAllowed] = await Promise.all([
      rateLimit(admin, `access-link:ip:${ip}`, 20, 900),
      rateLimit(admin, `access-link:email:${email}`, 3, 1800),
      rateLimit(admin, "access-link:global", 120, 900),
    ]);
    if (!ipAllowed || !emailAllowed || !globalAllowed) return genericResponse(request);

    const user = await findUserByEmail(admin, email);
    if (!user) return genericResponse(request);
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("organization_id,active,access_state").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || ["revoked", "archived"].includes(profile.access_state || "")) return genericResponse(request);
    const kind = body.kind as "activation" | "recovery";
    const eligible = kind === "activation" ? !profile.active : profile.active;
    if (!eligible) return genericResponse(request);
    const { error: requestError } = await admin.from("access_link_requests").upsert({
      organization_id: profile.organization_id,
      user_id: user.id,
      request_kind: kind,
      requested_at: new Date().toISOString(),
      handled_at: null,
    }, { onConflict: "organization_id,user_id,request_kind" });
    if (requestError) throw requestError;
    return genericResponse(request);
  } catch {
    return respond(request, { error: "No se pudo registrar la solicitud. Inténtalo de nuevo." }, 503);
  }
});

