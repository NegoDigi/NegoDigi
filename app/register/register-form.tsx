"use client";

import * as React from "react";
import { createSupabaseBrowserClient, createSupabaseEphemeralBrowserClient } from "@/lib/supabase/client";
import { callAccountSetup } from "@/lib/account-setup-client";

type SetupStatus = "pending" | "approved" | "processing" | "consumed" | "rejected" | "expired";
type SetupRequest = { request_id: string; secret: string; reference: string; expires_at: string; email: string };
const storageKey = "negodigi-first-access-request";
const fieldClass = "h-12 w-full rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm outline-none focus:ring-2 focus:ring-violet-400/50";
const buttonClass = "h-12 w-full rounded-xl bg-violet-500 text-sm font-medium hover:bg-violet-400 disabled:opacity-60";

export function RegisterForm() {
  const temporary = React.useMemo(() => createSupabaseEphemeralBrowserClient(), []);
  const [email, setEmail] = React.useState("");
  const [request, setRequest] = React.useState<SetupRequest | null>(null);
  const [status, setStatus] = React.useState<SetupStatus>("pending");
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [completeMessage, setCompleteMessage] = React.useState("");
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(storageKey) || "null") as SetupRequest | null;
      if (saved?.request_id && /^[0-9a-f]{64}$/.test(saved.secret || "") && Date.parse(saved.expires_at) > Date.now()) {
        setRequest(saved);
        setEmail(saved.email);
      } else window.sessionStorage.removeItem(storageKey);
    } catch { /* An unavailable browser store does not block an in-memory request. */ }
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!request || completeMessage) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    async function poll() {
      if (cancelled || inFlight) return;
      if (document.hidden) { timer = setTimeout(() => void poll(), 7000); return; }
      inFlight = true;
      try {
        let result = await callAccountSetup<{ status: SetupStatus; password_saved?: boolean }>(temporary, { action: "status", request_id: request!.request_id, secret: request!.secret });
        if (result.status === "processing" && result.password_saved) {
          // A saved password is never sent again. Resume only the atomic
          // activation if the original finalization response was interrupted.
          result = await callAccountSetup<{ status: SetupStatus }>(temporary, { action: "complete", request_id: request!.request_id, secret: request!.secret });
        }
        if (!cancelled) {
          setStatus(result.status);
          setMessage("");
          if (["consumed", "rejected", "expired"].includes(result.status)) return;
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "No se pudo comprobar la solicitud. Reintentando…");
      } finally {
        inFlight = false;
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 7000);
    }
    const visible = () => { if (!document.hidden) { clearTimeout(timer); void poll(); } };
    void poll();
    document.addEventListener("visibilitychange", visible);
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [request, temporary, completeMessage]);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setMessage("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const result = await callAccountSetup<Omit<SetupRequest, "email">>(temporary, { action: "request", email: normalizedEmail });
      const next = { ...result, email: normalizedEmail };
      setRequest(next);
      setStatus("pending");
      try { window.sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* memory fallback */ }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo solicitar el acceso.");
    } finally { setWorking(false); }
  }

  async function finish(event: React.FormEvent) {
    event.preventDefault();
    if (!request || working || status !== "approved") return;
    if (password.length < 10) { setMessage("La contraseña debe tener al menos 10 caracteres."); return; }
    if (new TextEncoder().encode(password).length > 72) { setMessage("Tu contraseña es demasiado larga. Acórtala o usa menos caracteres especiales."); return; }
    if (password !== confirmation) { setMessage("Las contraseñas no coinciden."); return; }
    setWorking(true);
    setMessage("");
    try {
      const result = await callAccountSetup<{ status: SetupStatus }>(temporary, { action: "complete", request_id: request.request_id, secret: request.secret, password });
      if (result.status !== "consumed") throw new Error("Dirección debe aprobar esta solicitud antes de crear tu contraseña.");
      setStatus("consumed");
      try { window.sessionStorage.removeItem(storageKey); } catch { /* memory fallback */ }
      const { data: signedIn, error: loginError } = await temporary.auth.signInWithPassword({ email: request.email, password });
      if (loginError || !signedIn.session) {
        setCompleteMessage("Tu contraseña ya está guardada. Entra desde la página principal con tu correo y contraseña.");
        return;
      }
      const persistent = createSupabaseBrowserClient();
      const { data: existing, error: existingError } = await persistent.auth.getUser();
      if (existing.user && existing.user.id !== signedIn.user.id) {
        setCompleteMessage("Tu cuenta ya está lista. Hay otra persona conectada en este navegador. Su sesión se mantiene: entra con tu cuenta desde tu navegador o una ventana privada.");
        return;
      }
      // A connectivity error must not replace a session we could not verify.
      if (existingError && existingError.name !== "AuthSessionMissingError") {
        setCompleteMessage("Tu cuenta ya está lista. Entra desde la página principal con tu correo y contraseña.");
        return;
      }
      const { error: sessionError } = await persistent.auth.setSession({ access_token: signedIn.session.access_token, refresh_token: signedIn.session.refresh_token });
      if (sessionError) {
        setCompleteMessage("Tu cuenta ya está lista. Entra desde la página principal con tu correo y contraseña.");
        return;
      }
      window.location.replace("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la contraseña.");
    } finally { setPassword(""); setConfirmation(""); setWorking(false); }
  }

  const newRequest = () => {
    try { window.sessionStorage.removeItem(storageKey); } catch { /* memory fallback */ }
    setRequest(null); setStatus("pending"); setMessage("");
  };

  return <main className="grid min-h-screen place-items-center bg-[#080b11] p-5 text-white">
    <section className="w-full max-w-md rounded-3xl border border-white/[.08] bg-[#111722] p-7 shadow-2xl shadow-black/30">
      <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-sm font-bold">N</span>
      <p className="mt-5 text-[11px] uppercase tracking-[.2em] text-violet-300">NegoDigi APP</p>
      <h1 className="mt-2 text-2xl font-semibold">Crea tu contraseña</h1>
      <p className="mt-2 text-sm leading-6 text-slate-400">Después entrarás siempre en app.negodigi.com con tu correo y contraseña.</p>
      {!hydrated && <p className="mt-6 text-sm text-slate-400">Preparando el acceso…</p>}
      {hydrated && !request && <form onSubmit={ask} className="mt-6 space-y-4">
        <p className="text-sm leading-6 text-slate-300">Solicita tu primer acceso. Dirección verificará que eres tú y te autorizará desde su panel. La contraseña la eliges aquí, sin recibir correos ni abrir enlaces.</p>
        <label className="block space-y-2 text-sm"><span>Correo de tu cuenta</span><input autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} type="email" className={fieldClass} /></label>
        <button disabled={working} className={buttonClass}>{working ? "Solicitando…" : "Solicitar primer acceso"}</button>
      </form>}
      {request && !completeMessage && status === "pending" && <div className="mt-6 space-y-4" aria-live="polite">
        <p className="font-medium">Esperando autorización de Dirección</p>
        <p className="text-sm leading-6 text-slate-300">Contacta con Dirección por vuestro canal habitual y confirma esta referencia. Mantén esta pestaña abierta: podrás crear tu contraseña en cuanto aprueben tu solicitud.</p>
        <div className="rounded-xl border border-white/10 bg-white/[.03] p-4"><p className="text-xs text-slate-400">Referencia de tu solicitud</p><p className="mt-1 font-mono text-2xl tracking-wider">{request.reference}</p></div>
        <p className="text-xs leading-5 text-slate-400">Válida durante 30 minutos. Si ya tienes contraseña, entra desde la página principal. La solicitud no confirma que exista una cuenta con este correo.</p>
      </div>}
      {request && status === "approved" && !completeMessage && <form onSubmit={finish} className="mt-6 space-y-4">
        <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/[.08] p-3 text-sm text-emerald-200">Dirección ha autorizado tu acceso. Elige una contraseña que sólo conozcas tú.</p>
        <label className="block space-y-2 text-sm"><span>Nueva contraseña</span><input value={password} onChange={event => setPassword(event.target.value)} required minLength={10} maxLength={72} type="password" autoComplete="new-password" className={fieldClass} /></label>
        <label className="block space-y-2 text-sm"><span>Repite la contraseña</span><input value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={10} maxLength={72} type="password" autoComplete="new-password" className={fieldClass} /></label>
        <button disabled={working} className={buttonClass}>{working ? "Guardando…" : "Guardar y entrar"}</button>
      </form>}
      {status === "processing" && !completeMessage && <div className="mt-6 space-y-3"><p className="text-sm leading-6 text-slate-300">Se está guardando el acceso. Si la conexión se interrumpe después de guardar la contraseña, esta pestaña reintentará la activación automáticamente.</p><p className="text-xs leading-5 text-slate-400">Si no termina, contacta con Dirección e indica la referencia {request?.reference}. La solicitud caduca a los 30 minutos y podrás iniciar una nueva.</p></div>}
      {(completeMessage || status === "consumed") && <p className="mt-6 rounded-xl border border-emerald-400/20 bg-emerald-400/[.08] p-3 text-sm leading-6 text-emerald-200">{completeMessage || "Tu cuenta ya está lista. Entra desde la página principal con tu correo y contraseña."}</p>}
      {["expired", "rejected"].includes(status) && <div className="mt-6 space-y-4"><p className="text-sm leading-6 text-slate-300">{status === "expired" ? "Esta solicitud ha caducado. Pide una nueva cuando Dirección esté disponible para autorizarte." : "Esta solicitud no ha sido autorizada. Contacta con Dirección para revisar tu acceso."}</p><button type="button" onClick={newRequest} className={buttonClass}>Nueva solicitud</button></div>}
      {message && <p role="alert" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[.08] p-3 text-sm text-amber-200">{message}</p>}
      <a href="/" className="mt-6 block text-center text-sm text-violet-300 hover:text-violet-200">Ya tengo contraseña · Entrar</a>
    </section>
  </main>;
}
