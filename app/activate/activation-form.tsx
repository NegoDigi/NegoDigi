"use client";

import * as React from "react";

import {
  createSupabaseBrowserClient,
  createSupabaseEphemeralBrowserClient,
} from "@/lib/supabase/client";

type ActivationState =
  | { kind: "loading" }
  | { kind: "ready"; conflictingSession: boolean }
  | { kind: "error"; message: string }
  | { kind: "complete"; conflictingSession: boolean };

export function ActivationForm() {
  const temporary = React.useMemo(() => createSupabaseEphemeralBrowserClient(), []);
  const [state, setState] = React.useState<ActivationState>({ kind: "loading" });
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState("");
  const activationAttempt = React.useRef<Promise<ActivationState> | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function loadActivation(): Promise<ActivationState> {
      const persistent = createSupabaseBrowserClient();
      const { data: currentIdentity } = await persistent.auth.getUser();
      const query = new URLSearchParams(window.location.search);
      const code = query.get("code");
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      let error: Error | null = null;

      if (hash.get("token_hash")) {
        const result = await temporary.auth.verifyOtp({ token_hash: hash.get("token_hash")!, type: "recovery" });
        error = result.error;
      } else if (code) {
        const result = await temporary.auth.exchangeCodeForSession(code);
        error = result.error;
      } else {
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (!accessToken || !refreshToken) {
          error = new Error("Este enlace no es válido, ya se utilizó o ha caducado.");
        } else {
          const result = await temporary.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          error = result.error;
        }
      }

      const { data: invitedIdentity, error: invitedIdentityError } = await temporary.auth.getUser();
      if (error || invitedIdentityError || !invitedIdentity.user) {
        return {
          kind: "error",
          message: "Este enlace no es válido, ya se utilizó o ha caducado. Solicita uno nuevo a Dirección.",
        };
      }
      window.history.replaceState(null, "", window.location.pathname);
      return {
        kind: "ready",
        conflictingSession: Boolean(
          currentIdentity.user && currentIdentity.user.id !== invitedIdentity.user.id,
        ),
      };
    }

    // React Strict Mode must not consume a single-use token twice.
    activationAttempt.current ||= loadActivation();
    void activationAttempt.current.then((result) => { if (!cancelled) setState(result); }).catch(() => {
      if (!cancelled) setState({ kind: "error", message: "No se pudo validar el acceso. Comprueba tu conexión y vuelve a abrir el enlace." });
    });
    return () => {
      cancelled = true;
    };
  }, [temporary]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state.kind !== "ready") return;
    setFormError("");
    if (password.length < 8) {
      setFormError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setFormError("Tu contraseña es demasiado larga. Acórtala o usa menos caracteres especiales.");
      return;
    }
    if (password !== confirmation) {
      setFormError("Las contraseñas no coinciden.");
      return;
    }

    setSaving(true);
    const { error: passwordError } = await temporary.auth.updateUser({ password });
    if (passwordError) {
      setSaving(false);
      setFormError("No se pudo guardar la contraseña. Solicita un enlace nuevo.");
      return;
    }

    const { error: activationError } = await temporary.functions.invoke("complete-access");
    if (activationError) {
      setSaving(false);
      setFormError("La contraseña se guardó, pero no se pudo activar el acceso. Contacta con Dirección.");
      return;
    }

    if (state.conflictingSession) {
      setSaving(false);
      setState({ kind: "complete", conflictingSession: true });
      return;
    }

    const { data: sessionData } = await temporary.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      setSaving(false);
      setState({ kind: "error", message: "El acceso se activó, pero la sesión temporal expiró. Entra desde la página principal." });
      return;
    }
    const persistent = createSupabaseBrowserClient();
    const { error: persistError } = await persistent.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (persistError) {
      setSaving(false);
      setState({ kind: "complete", conflictingSession: false });
      return;
    }
    window.location.replace("/");
  }

  const notice = state.kind === "error" ? state.message : null;
  const canSubmit = state.kind === "ready" && !saving;

  return (
    <main className="grid min-h-screen place-items-center bg-[#080b11] p-5 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/[.08] bg-[#111722] p-7 shadow-2xl shadow-black/30">
        <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-sm font-bold">N</span>
        <p className="mt-5 text-[11px] tracking-[.2em] text-violet-300 uppercase">NegoDigi APP</p>
        <h1 className="mt-2 text-2xl font-semibold">Activa tu acceso</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">Elige una contraseña para entrar en tu panel asignado.</p>

        {state.kind === "loading" && <p className="mt-6 text-sm text-slate-400">Validando el enlace seguro…</p>}
        {state.kind === "ready" && (
          <form onSubmit={submit} className="mt-7 space-y-3">
            {state.conflictingSession && <p className="rounded-xl border border-amber-400/20 bg-amber-400/[.08] p-3 text-sm leading-5 text-amber-200">Hay otra sesión abierta en este navegador. La activación no la sustituirá. Cuando termines, abre la página principal desde el navegador de la persona invitada e inicia sesión con esta contraseña.</p>}
            {formError && <p className="rounded-xl border border-rose-400/20 bg-rose-400/[.08] p-3 text-sm leading-5 text-rose-200">{formError}</p>}
            <input value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={72} type="password" autoComplete="new-password" placeholder="Nueva contraseña" className="h-12 w-full rounded-xl border border-white/[.08] bg-white/[.03] px-4 text-sm outline-none focus:ring-2 focus:ring-violet-400/50" />
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={8} maxLength={72} type="password" autoComplete="new-password" placeholder="Repite la contraseña" className="h-12 w-full rounded-xl border border-white/[.08] bg-white/[.03] px-4 text-sm outline-none focus:ring-2 focus:ring-violet-400/50" />
            <button disabled={!canSubmit} className="h-12 w-full rounded-xl bg-violet-500 text-sm font-medium hover:bg-violet-400 disabled:opacity-60">{saving ? "Guardando…" : "Guardar y entrar"}</button>
          </form>
        )}
        {state.kind === "complete" && <p className="mt-6 rounded-xl border border-emerald-400/20 bg-emerald-400/[.08] p-3 text-sm leading-5 text-emerald-200">Acceso activado. {state.conflictingSession ? "La sesión anterior sigue intacta." : "Ya puedes iniciar sesión desde la página principal."}</p>}
        {notice && <p className="mt-6 rounded-xl border border-rose-400/20 bg-rose-400/[.08] p-3 text-sm leading-5 text-rose-200">{notice}</p>}
      </section>
    </main>
  );
}
