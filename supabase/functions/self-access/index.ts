import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://app.negodigi.com",
  "https://www.app.negodigi.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);

type Body = { email?: unknown; password?: unknown };
type AdminClient = ReturnType<typeof createClient>;
type Target = {
  userId: string | null;
  organizationId: string;
  role: "owner" | "admin" | "editor" | "client";
  displayName: string;
  editorId: string | null;
  clientId: string | null;
  accessState: string;
  active: boolean;
};

function responseHeaders(request: Request) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const origin = request.headers.get("origin");
  if (!origin || allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin || "https://app.negodigi.com";
    headers["Access-Control-Allow-Headers"] =
      "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Vary"] = "Origin";
  }
  return headers;
}

function reply(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request),
  });
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function validPassword(value: unknown) {
  if (typeof value !== "string") return false;
  const bytes = new TextEncoder().encode(value).length;
  return value.length >= 10 && bytes <= 72;
}

async function hash(value: string) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function rateLimit(
  admin: AdminClient,
  key: string,
  maxAttempts: number,
  windowSeconds: number,
) {
  const { data, error } = await admin.rpc("account_setup_take_limit", {
    limit_key: await hash(key),
    max_attempts: maxAttempts,
    window_seconds: windowSeconds,
  });
  if (error) throw error;
  return data === true;
}

async function findAuthUser(admin: AdminClient, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw error;
    const user = data.users.find(
      (candidate) => candidate.email?.trim().toLowerCase() === email,
    );
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
}

async function findTarget(admin: AdminClient, email: string): Promise<Target | null> {
  const authUser = await findAuthUser(admin, email);
  if (authUser) {
    const { data: profile, error } = await admin
      .from("profiles")
      .select("id,organization_id,role,display_name,editor_id,client_id,active,access_state")
      .eq("id", authUser.id)
      .maybeSingle();
    if (error) throw error;
    if (profile) {
      return {
        userId: authUser.id,
        organizationId: profile.organization_id,
        role: profile.role,
        displayName: profile.display_name,
        editorId: profile.editor_id,
        clientId: profile.client_id,
        active: profile.active,
        accessState: profile.access_state || "active",
      };
    }
  }

  const [editorPrivate, clientPrivate] = await Promise.all([
    admin.from("editor_private").select("editor_id,email"),
    admin.from("client_private").select("client_id,email"),
  ]);
  if (editorPrivate.error) throw editorPrivate.error;
  if (clientPrivate.error) throw clientPrivate.error;

  const editorMatch = (editorPrivate.data || []).find(
    (row) => row.email?.trim().toLowerCase() === email,
  );
  if (editorMatch) {
    const { data: editor, error } = await admin
      .from("editors")
      .select("id,organization_id,name,user_id,status")
      .eq("id", editorMatch.editor_id)
      .maybeSingle();
    if (error) throw error;
    if (!editor || editor.status === "archived") return null;
    if (editor.user_id && (!authUser || editor.user_id !== authUser.id)) return null;
    return {
      userId: authUser?.id || null,
      organizationId: editor.organization_id,
      role: "editor",
      displayName: editor.name,
      editorId: editor.id,
      clientId: null,
      active: false,
      accessState: "pending_invitation",
    };
  }

  const clientMatch = (clientPrivate.data || []).find(
    (row) => row.email?.trim().toLowerCase() === email,
  );
  if (clientMatch) {
    const { data: client, error } = await admin
      .from("clients")
      .select("id,organization_id,name,user_id,status")
      .eq("id", clientMatch.client_id)
      .maybeSingle();
    if (error) throw error;
    if (!client || client.status === "archived") return null;
    if (client.user_id && (!authUser || client.user_id !== authUser.id)) return null;
    return {
      userId: authUser?.id || null,
      organizationId: client.organization_id,
      role: "client",
      displayName: client.name,
      editorId: null,
      clientId: client.id,
      active: false,
      accessState: "pending_invitation",
    };
  }

  return null;
}

async function ensureTarget(admin: AdminClient, target: Target, userId: string) {
  if (target.editorId) {
    const { data: editor, error: editorLookupError } = await admin
      .from("editors")
      .select("user_id")
      .eq("id", target.editorId)
      .single();
    if (editorLookupError) throw editorLookupError;
    if (editor.user_id && editor.user_id !== userId) {
      throw new Error("EDITOR_ALREADY_LINKED");
    }
    const { error } = await admin
      .from("editors")
      .update({ user_id: userId, updated_at: new Date().toISOString() })
      .eq("id", target.editorId)
      .is("user_id", null);
    if (error) throw error;
  }
  if (target.clientId) {
    const { data: client, error: clientLookupError } = await admin
      .from("clients")
      .select("user_id")
      .eq("id", target.clientId)
      .single();
    if (clientLookupError) throw clientLookupError;
    if (client.user_id && client.user_id !== userId) {
      throw new Error("CLIENT_ALREADY_LINKED");
    }
    const { error } = await admin
      .from("clients")
      .update({ user_id: userId, updated_at: new Date().toISOString() })
      .eq("id", target.clientId)
      .is("user_id", null);
    if (error) throw error;
  }

  const { error } = await admin.from("profiles").upsert(
    {
      id: userId,
      organization_id: target.organizationId,
      role: target.role,
      display_name: target.displayName,
      editor_id: target.editorId,
      client_id: target.clientId,
      active: true,
      access_state: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(request) });
  if (request.method !== "POST") return reply(request, { error: "Método no permitido" }, 405);

  let createdUserId: string | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const email = normalizeEmail(body.email);
    if (!email) return reply(request, { error: "Escribe un email válido." }, 400);
    if (!validPassword(body.password)) {
      return reply(request, { error: "La contraseña debe tener al menos 10 caracteres y no superar 72 bytes." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !service) throw new Error("MISSING_SERVICE_CONFIG");
    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const ip = (request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim();
    const [ipAllowed, emailAllowed] = await Promise.all([
      rateLimit(admin, `self-access:ip:${ip}`, 30, 900),
      rateLimit(admin, `self-access:email:${email}`, 8, 1800),
    ]);
    if (!ipAllowed || !emailAllowed) {
      return reply(request, { error: "Hay demasiados intentos recientes. Espera unos minutos." }, 429);
    }

    const target = await findTarget(admin, email);
    if (!target || ["revoked", "archived"].includes(target.accessState)) {
      return reply(request, {
        error: "No existe un acceso con este email en NegoDigi. Comprueba el correo o solicita a Dirección que lo añada.",
      }, 403);
    }

    let userId = target.userId;
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: body.password as string,
        email_confirm: true,
      });
      if (error || !data.user) {
        const existing = await findAuthUser(admin, email);
        if (!existing) throw error || new Error("AUTH_CREATE_FAILED");
        userId = existing.id;
      } else {
        userId = data.user.id;
        createdUserId = userId;
      }
    } else {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password: body.password as string,
        email_confirm: true,
        ban_duration: "none",
      });
      if (error) throw error;
    }

    await ensureTarget(admin, target, userId);
    return reply(request, { ok: true, email, role: target.role });
  } catch (error) {
    if (createdUserId) {
      await Promise.resolve().then(async () => {
        const url = Deno.env.get("SUPABASE_URL");
        const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!url || !service) return;
        const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
        await admin.auth.admin.deleteUser(createdUserId!);
      }).catch(() => undefined);
    }
    console.error("[self-access] operation failed", error instanceof Error ? error.message : "unknown");
    return reply(request, { error: "No se pudo preparar el acceso. Inténtalo de nuevo o contacta con Dirección." }, 503);
  }
});
