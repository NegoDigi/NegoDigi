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

type Role = "admin" | "editor" | "client" | "affiliate";
type Action = "list" | "invite" | "update" | "revoke" | "reactivate" | "resend" | "copy_activation_link" | "copy_recovery_link" | "delete" | "dismiss";
type Body = { action?: Action; user_id?: string; email?: string; display_name?: string; role?: Role; editor_id?: string | null; client_id?: string | null; active?: boolean };

function headersFor(request: Request) {
  const headers = new Headers({ ...baseHeaders, "Content-Type": "application/json" });
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
const reply = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headersFor(request) });

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
const activationUrl = "https://app.negodigi.com/activate";

async function listAllAuthUsers(admin: ReturnType<typeof createClient>) {
  const users: Array<{ id: string; email?: string; created_at?: string; invited_at?: string; confirmed_at?: string; last_sign_in_at?: string; banned_until?: string }> = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 100) break;
  }
  return users;
}

Deno.serve(async (request) => {
  const send = (body: unknown, status = 200) => reply(request, body, status);
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return send({ error: "Origen no permitido." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: headersFor(request) });
  if (request.method !== "POST") return send({ error: "Método no permitido" }, 405);
  if (Number(request.headers.get("content-length") || 0) > 16384) return send({ error: "Solicitud demasiado grande." }, 413);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return send({ error: "Sesión no válida" }, 401);
    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !service || !anon) return send({ error: "La función no está configurada" }, 503);

    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { autoRefreshToken: false, persistSession: false } });
    const token = authorization.slice(7);
    const { data: identity, error: identityError } = await admin.auth.getUser(token);
    if (identityError || !identity.user) return send({ error: "Sesión no válida" }, 401);
    const { data: actor, error: actorError } = await admin.from("profiles").select("organization_id,role,active,access_state").eq("id", identity.user.id).single();
    if (actorError || !actor?.active || !["owner", "admin"].includes(actor.role) || ["revoked", "archived"].includes(actor.access_state || "")) return send({ error: "Solo Dirección puede gestionar usuarios" }, 403);
    if (!await rateLimit(admin, `admin-users:${identity.user.id}`, 120, 60)) return send({ error: "Demasiadas operaciones. Espera un minuto." }, 429);

    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 16384) return send({ error: "Solicitud demasiado grande." }, 413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return send({ error: "Solicitud no válida." }, 400);
    const body = parsed as Body;
    const action = body.action || "list";
    const actions: Action[] = ["list", "invite", "update", "revoke", "reactivate", "resend", "copy_activation_link", "copy_recovery_link", "delete", "dismiss"];
    if (typeof action !== "string" || !actions.includes(action as Action)) return send({ error: "Acción no válida." }, 400);
    if (body.user_id !== undefined && (typeof body.user_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.user_id))) return send({ error: "Usuario no válido." }, 400);
    if (body.active !== undefined && typeof body.active !== "boolean") return send({ error: "Estado no válido." }, 400);
    if (body.role !== undefined && !["admin", "editor", "client", "affiliate"].includes(String(body.role))) return send({ error: "Rol no válido." }, 400);
    for (const id of [body.editor_id, body.client_id]) {
      if (id !== undefined && id !== null && (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return send({ error: "Vinculación no válida." }, 400);
    }
    if (action === "list") {
      // Keep the access directory independent from the optional request inbox.
      // A missing/new request table must never make existing editors disappear.
      const [authUsers, profilesResult, accessesResult] = await Promise.all([
        listAllAuthUsers(admin),
        admin.from("profiles").select("id,role,display_name,editor_id,client_id,active,access_state,created_at,updated_at,last_access_at").eq("organization_id", actor.organization_id),
        admin.from("auth_access_history").select("user_id,occurred_at").eq("organization_id", actor.organization_id).eq("result", "success").order("occurred_at", { ascending: false }),
      ]);
      if (profilesResult.error || accessesResult.error) throw profilesResult.error || accessesResult.error;
      const requestsResult = await admin.from("access_link_requests").select("id,user_id,request_kind,requested_at").eq("organization_id", actor.organization_id).is("handled_at", null).order("requested_at", { ascending: false });
      const profileById = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
      const accessById = new Map<string, string>();
      for (const access of accessesResult.data || []) if (access.user_id && !accessById.has(access.user_id)) accessById.set(access.user_id, access.occurred_at);
      return send({
        users: authUsers.filter((user) => profileById.has(user.id)).map((user) => {
          const profile = profileById.get(user.id);
          return { id: user.id, email: user.email || null, created_at: user.created_at || null, invited_at: user.invited_at || null, confirmed_at: user.confirmed_at || null, last_sign_in_at: accessById.get(user.id) || profile?.last_access_at || user.last_sign_in_at || null, banned_until: user.banned_until || null, profile };
        }),
        access_requests: requestsResult.data || [],
        requests_warning: requestsResult.error ? "No se pudieron cargar las solicitudes de acceso" : null,
      });
    }

    if (action === "invite") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
      if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !displayName || displayName.length > 120 || !body.role) return send({ error: "Nombre, email y rol son obligatorios" }, 400);
      if (body.role === "admin" && actor.role !== "owner") return send({ error: "Solo la cuenta propietaria puede asignar el rol de administrador." }, 403);
      const temporaryPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const { data, error } = await admin.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { display_name: displayName } });
      if (error || !data.user) throw error || new Error("No se pudo crear el acceso");
      const { error: profileError } = await caller.rpc("admin_set_user_profile", { target_user_id: data.user.id, target_role: body.role, target_display_name: displayName, target_editor_id: body.editor_id || null, target_client_id: body.client_id || null, target_active: false, target_phone: null });
      if (profileError) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw profileError;
      }
      const { error: stateError } = await admin.from("profiles").update({ active: false, access_state: "pending_invitation", updated_at: new Date().toISOString() }).eq("id", data.user.id).eq("organization_id", actor.organization_id);
      if (stateError) throw stateError;
      return send({ user_id: data.user.id, pending_activation: true }, 201);
    }

    if (!body.user_id) return send({ error: "Falta el usuario" }, 400);
    if (body.user_id === identity.user.id && ["revoke", "delete"].includes(action)) return send({ error: "No puedes modificar tu propio acceso" }, 400);
    const { data: existing, error: existingError } = await admin.from("profiles").select("role,display_name,editor_id,client_id,active,access_state").eq("id", body.user_id).eq("organization_id", actor.organization_id).single();
    if (existingError || !existing) return send({ error: "Usuario no encontrado" }, 404);
    if (existing.role === "owner") return send({ error: "La cuenta propietaria no se modifica desde aquí" }, 400);
    if ((existing.role === "admin" || body.role === "admin") && actor.role !== "owner") return send({ error: "Solo la cuenta propietaria puede gestionar administradores." }, 403);
    if (body.display_name !== undefined && (typeof body.display_name !== "string" || body.display_name.trim().length > 120)) return send({ error: "Nombre no válido." }, 400);
    if (body.email !== undefined && (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))) return send({ error: "Email no válido." }, 400);

    if (action === "dismiss") {
      if (existing.role !== "editor" || !existing.editor_id) return send({ error: "Solo se puede despedir un perfil editorial vinculado" }, 400);
      const now = new Date().toISOString();
      const [editorResult, authResult, profileResult] = await Promise.all([
        admin.from("editors").update({ status: "archived", updated_at: now }).eq("organization_id", actor.organization_id).eq("id", existing.editor_id),
        admin.auth.admin.updateUserById(body.user_id, { ban_duration: "876000h" }),
        admin.from("profiles").update({ active: false, access_state: "archived", updated_at: now }).eq("id", body.user_id).eq("organization_id", actor.organization_id),
      ]);
      if (editorResult.error || authResult.error || profileResult.error) throw editorResult.error || authResult.error || profileResult.error;
      await admin.from("auth_access_history").insert({ organization_id: actor.organization_id, user_id: body.user_id, display_name_snapshot: existing.display_name, result: "dismissed", device_info: null });
      return send({ dismissed: true, editor_id: existing.editor_id });
    }

    if (action === "delete") {
      const now = new Date().toISOString();
      const [targetResult, unlinkEditor, unlinkClient] = await Promise.all([
        admin.auth.admin.getUserById(body.user_id),
        admin.from("editors").update({ user_id: null, updated_at: now }).eq("organization_id", actor.organization_id).eq("user_id", body.user_id),
        admin.from("clients").update({ user_id: null, updated_at: now }).eq("organization_id", actor.organization_id).eq("user_id", body.user_id),
      ]);
      if (unlinkEditor.error || unlinkClient.error) throw unlinkEditor.error || unlinkClient.error;
      await admin.from("auth_access_history").insert({ organization_id: actor.organization_id, user_id: null, display_name_snapshot: existing.display_name, result: "deleted", device_info: null });
      const { error: profileError } = await admin.from("profiles").delete().eq("id", body.user_id).eq("organization_id", actor.organization_id);
      if (profileError) throw profileError;
      const { error: deleteError } = await admin.auth.admin.deleteUser(body.user_id);
      if (deleteError) throw deleteError;
      return send({ deleted: true, email: targetResult.data.user?.email || null });
    }

    if (["copy_activation_link", "copy_recovery_link", "resend"].includes(action)) {
      if (["revoked", "archived"].includes(existing.access_state || "")) return send({ error: "Reactiva el acceso antes de crear un enlace" }, 400);
      const { data: authUser, error: userError } = await admin.auth.admin.getUserById(body.user_id);
      if (userError || !authUser.user?.email) throw userError || new Error("No se encontró email");
      // Older pending invitations were banned and unconfirmed. Only Direction's
      // explicit link action authorizes removing that legacy Auth block.
      if (existing.access_state === "pending_invitation") {
        const { error: unblockError } = await admin.auth.admin.updateUserById(body.user_id, { ban_duration: "none", email_confirm: true });
        if (unblockError) throw unblockError;
      }
      const { data: generated, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email: authUser.user.email, options: { redirectTo: activationUrl } });
      if (linkError || !generated.properties.hashed_token) throw linkError || new Error("No se pudo generar el enlace");
      const pending = existing.access_state === "pending_invitation";
      const { error: stateError } = await admin.from("profiles").update({ active: pending ? false : existing.active, access_state: pending ? "pending_invitation" : "active", updated_at: new Date().toISOString() }).eq("id", body.user_id).eq("organization_id", actor.organization_id);
      if (stateError) throw stateError;
      await admin.from("access_link_requests").update({ handled_at: new Date().toISOString() }).eq("organization_id", actor.organization_id).eq("user_id", body.user_id).eq("request_kind", pending ? "activation" : "recovery").is("handled_at", null);
      // A fragment avoids leaking the single-use secret in server/referrer logs
      // and avoids dependence on Supabase's legacy redirect allow-list.
      return send({ action_link: `${activationUrl}#token_hash=${encodeURIComponent(generated.properties.hashed_token)}&type=recovery`, mode: pending ? "activation" : "recovery" });
    }

    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(body.user_id);
    if (authUserError) throw authUserError;
    const active = action === "revoke" ? false : action === "reactivate" ? true : (body.active ?? existing.active);
    const role = (body.role || existing.role) as Role;
    const displayName = body.display_name?.trim() || existing.display_name;
    const nextEmail = body.email?.trim().toLowerCase();
    const shouldBan = action === "revoke" || (action !== "reactivate" && ["revoked", "archived"].includes(existing.access_state || ""));
    const authUpdate: { ban_duration: string; email?: string; email_confirm?: boolean } = { ban_duration: shouldBan ? "876000h" : "none" };
    if (action === "update" && nextEmail && nextEmail !== (authUser.user?.email || "").toLowerCase()) {
      authUpdate.email = nextEmail;
      authUpdate.email_confirm = true;
    }
    const { error: authError } = await admin.auth.admin.updateUserById(body.user_id, authUpdate);
    if (authError) throw authError;
    const { error: profileError } = await caller.rpc("admin_set_user_profile", { target_user_id: body.user_id, target_role: role, target_display_name: displayName, target_editor_id: body.editor_id === undefined ? existing.editor_id : body.editor_id, target_client_id: body.client_id === undefined ? existing.client_id : body.client_id, target_active: active, target_phone: null });
    if (profileError) throw profileError;
    const nextAccessState = action === "revoke" ? "revoked" : action === "reactivate" ? "active" : existing.access_state;
    const { error: accessStateError } = await admin.from("profiles").update({ access_state: nextAccessState, updated_at: new Date().toISOString() }).eq("id", body.user_id).eq("organization_id", actor.organization_id);
    if (accessStateError) throw accessStateError;
    return send({ user_id: body.user_id, active, updated: true });
  } catch {
    return send({ error: "No se pudo completar la operación. Inténtalo de nuevo." }, 503);
  }
});

