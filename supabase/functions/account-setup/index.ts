import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SETUP_LIFETIME_MS, normalizeSetupEmail, createSetupSecret, createSetupReference, hashSetupSecret, validSetupProof, validSetupPassword } from "./protocol.ts";

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
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};
function headersFor(request: Request) {
  const headers = new Headers(baseHeaders);
  const origin = request.headers.get("origin");
  if (!origin || allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin || "https://app.negodigi.com");
  return headers;
}
const reply = (request: Request, body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: headersFor(request) });
type Body = { action?: string; email?: string; request_id?: string; secret?: string; password?: string; reference?: string; identity_confirmed?: boolean };
type AdminClient = ReturnType<typeof createClient>;

async function rateLimit(admin: AdminClient, key: string, max: number, seconds: number) {
  const { data, error } = await admin.rpc("account_setup_take_limit", { limit_key: await hashSetupSecret(key), max_attempts: max, window_seconds: seconds });
  if (error) throw error;
  return data === true;
}

async function findEmail(admin: AdminClient, email: string) {
  for (let page=1; page<=20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage:100 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 100) break;
  }
  return null;
}

Deno.serve(async (request) => {
  const send = (body: unknown, status = 200) => reply(request, body, status);
  if (request.method === "OPTIONS") return new Response("ok", { headers: headersFor(request) });
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return send({ error: "Origen no permitido." }, 403);
  if (request.method !== "POST") return send({ error:"Método no permitido" },405);
  if (Number(request.headers.get("content-length") || 0)>8192) return send({ error:"Solicitud demasiado grande" },413);
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 8192) return send({ error:"Solicitud demasiado grande" },413);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return send({ error: "Solicitud no válida." }, 400);
    const body = parsed as Body;
    const url=Deno.env.get("SUPABASE_URL"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !service) throw new Error("Missing service configuration");
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});

    if (body.action === "request") {
      const email=normalizeSetupEmail(body.email);
      if (!email) return send({ error:"Escribe un correo válido." },400);
      // Cloudflare overwrites cf-connecting-ip at the edge; x-real-ip may be
      // caller-controlled and must not be trusted for rate-limit identity.
      const address=(request.headers.get("cf-connecting-ip") || "unknown").slice(0,128).trim();
      const [ipAllowed,emailAllowed,globalAllowed]=await Promise.all([
        rateLimit(admin,`setup:ip:${address}`,30,900),
        rateLimit(admin,`setup:email:${email}`,3,1800),
        rateLimit(admin,"setup:global",200,900),
      ]);
      if (!ipAllowed || !emailAllowed || !globalAllowed) return send({ error:"Hay varias solicitudes recientes. Espera unos minutos antes de solicitar otra." },429);
      const cleanup=await admin.from("account_setup_requests").select("id").lt("expires_at",new Date(Date.now()-86400000).toISOString()).limit(100);
      if (!cleanup.error && cleanup.data?.length) await admin.from("account_setup_requests").delete().in("id",cleanup.data.map(row=>row.id));
      const user=await findEmail(admin,email);
      let profile: { organization_id:string;active:boolean;access_state:string } | null=null;
      if (user) {
        const result=await admin.from("profiles").select("organization_id,active,access_state").eq("id",user.id).maybeSingle();
        if (result.error) throw result.error;
        profile=result.data;
      }
      const eligible=Boolean(user && profile && !profile.active && profile.access_state === "pending_invitation");
      const now=new Date().toISOString();
      if (eligible) {
        const {error}=await admin.from("account_setup_requests").update({status:"expired"}).eq("user_id",user!.id).in("status",["pending","approved","processing"]).lte("expires_at",now);
        if (error) throw error;
      }
      const id=crypto.randomUUID(), secret=createSetupSecret(), reference=createSetupReference();
      const expiresAt=new Date(Date.now()+SETUP_LIFETIME_MS).toISOString();
      const row={id,token_hash:await hashSetupSecret(secret),reference,email,expires_at:expiresAt,status:"pending",user_id:eligible?user!.id:null,organization_id:eligible?profile!.organization_id:null};
      let {error}=await admin.from("account_setup_requests").insert(row);
      if (error?.code === "23505") {
        // A new caller can never replace an existing applicant or inherit an
        // approval. Return the same generic waiting flow with a decoy record.
        ({error}=await admin.from("account_setup_requests").insert({...row,user_id:null,organization_id:null}));
      }
      if (error) throw error;
      return send({request_id:id,secret,reference,expires_at:expiresAt,status:"pending"},201);
    }

    if (body.action === "status" || body.action === "complete") {
      if (!validSetupProof(body.request_id,body.secret)) return send({ error:"Solicitud no válida." },400);
      const tokenHash=await hashSetupSecret(body.secret!);
      const {data:setup,error}=await admin.from("account_setup_requests").select("id,status,expires_at,user_id,organization_id,password_saved_at").eq("id",body.request_id!).eq("token_hash",tokenHash).maybeSingle();
      if (error) throw error;
      if (!setup) return send({status:"expired"});
      if (setup.status === "consumed") return send({status:"consumed"});
      if (Date.parse(setup.expires_at)<=Date.now()) return send({status:"expired"});
      if (body.action === "status") return send({status:setup.status,expires_at:setup.expires_at,password_saved:Boolean(setup.password_saved_at)});
      if (!setup.password_saved_at && !validSetupPassword(body.password)) return send({error:typeof body.password!=="string" || body.password.length<8 ? "La contraseña debe tener al menos 8 caracteres." : "Tu contraseña es demasiado larga. Acórtala o usa menos caracteres especiales."},400);
      if (!await rateLimit(admin,`setup:complete:${setup.id}`,6,1800)) return send({error:"Demasiados intentos. Contacta con Dirección."},429);
      let leaseId=crypto.randomUUID();
      const {data:claim,error:claimError}=await admin.rpc("account_setup_claim",{request_id:setup.id,request_token_hash:tokenHash,request_lease_id:leaseId});
      if (claimError) throw claimError;
      if (claim?.state === "consumed") return send({status:"consumed"});
      if (!claim?.user_id || !["processing","password_saved"].includes(claim.state)) return send({error:"Esta solicitud todavía no está aprobada o ya no está disponible.",status:claim?.state || "unavailable"},409);
      if (claim.state === "password_saved") leaseId=claim.lease_id;
      // Auth owns passwords. Never put a password in a table, audit event, URL,
      // metadata, log, or response. No ban change here: finalization is atomic.
      if (claim.state !== "password_saved") {
        const {error:passwordError}=await admin.auth.admin.updateUserById(claim.user_id,{password:body.password,email_confirm:true});
        if (passwordError) {
          // Keep processing_at as an audit marker: even if Auth's response was
          // lost after applying the password, the legacy confirmation trigger
          // must not activate this request outside the explicit finalizer.
          await admin.from("account_setup_requests").update({status:"approved",lease_id:null}).eq("id",setup.id).eq("status","processing").eq("lease_id",leaseId);
          return send({error:"No se pudo guardar la contraseña. Puedes intentarlo de nuevo."},503);
        }
        const {data:saved,error:savedError}=await admin.from("account_setup_requests").update({password_saved_at:new Date().toISOString()}).eq("id",setup.id).eq("status","processing").eq("lease_id",leaseId).select("id").maybeSingle();
        if (savedError) throw savedError;
        if (!saved) return send({error:"La solicitud cambió durante el proceso. Contacta con Dirección."},409);
      }
      const {data:finished,error:finishError}=await admin.rpc("account_setup_finalize",{request_id:setup.id,request_token_hash:tokenHash,request_lease_id:leaseId});
      if (finishError) throw finishError;
      if (!finished) return send({error:"La autorización cambió durante el proceso. Contacta con Dirección."},409);
      return send({status:"consumed"});
    }

    if (!["admin_list","admin_approve","admin_reject"].includes(body.action || "")) return send({error:"Acción no válida"},400);
    const bearer=request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!bearer) return send({error:"Sesión no válida"},401);
    const {data:identity,error:identityError}=await admin.auth.getUser(bearer);
    if (identityError || !identity.user) return send({error:"Sesión no válida"},401);
    const {data:actor,error:actorError}=await admin.from("profiles").select("organization_id,role,active,access_state").eq("id",identity.user.id).single();
    if (actorError || !actor?.active || !["owner","admin"].includes(actor.role) || ["revoked","archived"].includes(actor.access_state)) return send({error:"Solo Dirección puede autorizar accesos."},403);
    if (!await rateLimit(admin, `setup:admin:${identity.user.id}`, 120, 60)) return send({error:"Demasiadas operaciones. Espera un minuto."},429);
    if (body.action === "admin_list") {
      const {data:rows,error:rowsError}=await admin.from("account_setup_requests").select("id,user_id,email,reference,status,created_at,expires_at,approved_at").eq("organization_id",actor.organization_id).not("user_id","is",null).in("status",["pending","approved","processing"]).gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(100);
      if (rowsError) throw rowsError;
      const ids=(rows || []).map((row)=>row.user_id);
      const profiles=ids.length ? await admin.from("profiles").select("id,display_name,access_state,active").in("id",ids).eq("organization_id",actor.organization_id) : {data:[],error:null};
      if (profiles.error) throw profiles.error;
      const byId=new Map((profiles.data || []).map((profile)=>[profile.id,profile]));
      return send({requests:(rows || []).filter(row=>{const p=byId.get(row.user_id);return p && !p.active && p.access_state === "pending_invitation";}).map((row)=>({...row,display_name:byId.get(row.user_id)?.display_name || row.email}))});
    }
    if (!body.request_id) return send({error:"Falta la solicitud."},400);
    if (body.action === "admin_reject") {
      const {data,error}=await admin.from("account_setup_requests").update({status:"rejected"}).eq("id",body.request_id).eq("organization_id",actor.organization_id).in("status",["pending","approved"]).select("id").maybeSingle();
      if (error) throw error;
      return data ? send({ok:true}) : send({error:"La solicitud ya cambió de estado."},409);
    }
    if (body.identity_confirmed !== true || !body.reference) return send({error:"Confirma la identidad y la referencia con la persona antes de aprobar."},400);
    const {data:setup,error:setupError}=await admin.from("account_setup_requests").select("id,user_id,reference,status").eq("id",body.request_id).eq("organization_id",actor.organization_id).single();
    if (setupError || !setup || setup.reference !== body.reference || setup.status !== "pending") return send({error:"La solicitud ya cambió de estado."},409);
    const {data:target,error:targetError}=await admin.from("profiles").select("active,access_state").eq("id",setup.user_id).eq("organization_id",actor.organization_id).single();
    if (targetError || target.active || target.access_state !== "pending_invitation") return send({error:"Esta cuenta no admite una activación inicial."},409);
    const {data:approved,error:approvalError}=await admin.from("account_setup_requests").update({status:"approved",approved_at:new Date().toISOString(),approved_by:identity.user.id}).eq("id",setup.id).eq("status","pending").gt("expires_at",new Date().toISOString()).select("id").maybeSingle();
    if (approvalError) throw approvalError;
    return approved ? send({ok:true}) : send({error:"La solicitud ha caducado o ya cambió de estado."},409);
  } catch {
    return send({error:"No se pudo completar la operación. Inténtalo de nuevo."},503);
  }
});

