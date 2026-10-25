"use client";

import * as React from "react";
import { ArrowLeft, Eye, EyeOff, LockKeyhole } from "lucide-react";
import Link from "next/link";

import { createSupabaseRecoveryBrowserClient } from "@/lib/supabase/client";

const fieldClass =
  "h-12 w-full rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm outline-none focus:ring-2 focus:ring-violet-400/50";

type PageState =
  | "checking"
  | "awaiting-confirmation"
  | "ready"
  | "invalid"
  | "done";

export function ResetPasswordForm() {
  const supabase = React.useMemo(() => createSupabaseRecoveryBrowserClient(), []);
  const [state, setState] = React.useState<PageState>("checking");
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmation, setShowConfirmation] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const tokenHashRef = React.useRef<string | null>(null);
  const recoveryResolutionRef = React.useRef<Promise<void> | null>(null);

  React.useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // Keep token-hash links pending until the user explicitly continues.
      // Email security scanners must not be able to consume the recovery token.
      if (active && session && !tokenHashRef.current) setState("ready");
    });

    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const authCode = params.get("code");
    tokenHashRef.current = tokenHash;
    const resolveRecovery = async () => {
      if (tokenHash) {
        if (active) setState("awaiting-confirmation");
        return;
      }
      if (authCode) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);
        if (active) setState(!error && data.session ? "ready" : "invalid");
        return;
      }
      if (tokenHash) {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (active) setState(!error && data.session ? "ready" : "invalid");
        return;
      }
      window.setTimeout(() => {
        void supabase.auth.getSession().then(({ data }) => {
          if (active) setState(data.session ? "ready" : "invalid");
        });
      }, 700);
    };
    recoveryResolutionRef.current ||= resolveRecovery();
    void recoveryResolutionRef.current;

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  async function continueRecovery() {
    const tokenHash = tokenHashRef.current;
    if (!tokenHash || working) return;
    setWorking(true);
    setMessage("");
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (error || !data.session) {
      setState("invalid");
      setMessage("Este enlace ya no es válido. Solicita otro para cambiar tu contraseña.");
      setWorking(false);
      return;
    }
    tokenHashRef.current = null;
    window.history.replaceState(null, "", "/reset-password");
    setState("ready");
    setWorking(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (working) return;
    setMessage("");
    if (password !== confirmation) {
      setMessage("Las contraseñas no coinciden.");
      return;
    }
    setWorking(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage("Este enlace ya no es válido. Solicita otro para cambiar tu contraseña.");
      setWorking(false);
      return;
    }
    await supabase.auth.signOut();
    setWorking(false);
    setPassword("");
    setConfirmation("");
    setState("done");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#080b11] p-5 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/[.08] bg-[#111722] p-7 shadow-2xl shadow-black/30">
        <Link href="/" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-white">
          <ArrowLeft className="size-4" /> Volver al acceso
        </Link>
        <span className="mt-7 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-sm font-bold">N</span>
        <p className="mt-5 text-[11px] uppercase tracking-[.2em] text-violet-300">NegoDigi APP</p>
        <h1 className="mt-2 text-2xl font-semibold">Cambia tu contraseña</h1>

        {state === "checking" && <p className="mt-5 text-sm leading-6 text-slate-400">Comprobando tu enlace seguro…</p>}
        {state === "awaiting-confirmation" && (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-slate-300">Tu enlace está listo. Pulsa el botón para validarlo y elegir una nueva contraseña.</p>
            <button type="button" onClick={() => void continueRecovery()} disabled={working} className="flex h-12 w-full items-center justify-center rounded-xl bg-violet-500 text-sm font-medium hover:bg-violet-400 disabled:opacity-60">
              {working ? "Validando enlace…" : "Continuar para cambiarla"}
            </button>
          </div>
        )}
        {state === "invalid" && (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-slate-300">Este enlace ha caducado o ya se ha utilizado. Solicita uno nuevo para cambiar tu contraseña.</p>
            <Link href="/forgot-password" className="flex h-12 items-center justify-center rounded-xl bg-violet-500 text-sm font-medium hover:bg-violet-400">Solicitar otro enlace</Link>
          </div>
        )}
        {state === "done" && (
          <div className="mt-5 space-y-4">
            <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/[.08] p-4 text-sm leading-6 text-emerald-200" role="status">Tu contraseña se ha cambiado correctamente. Ya puedes entrar con ella.</p>
            <Link href="/" className="flex h-12 items-center justify-center rounded-xl bg-violet-500 text-sm font-medium hover:bg-violet-400">Entrar en NegoDigi</Link>
          </div>
        )}
        {state === "ready" && (
          <form onSubmit={submit} className="mt-7 space-y-4">
            <label className="block space-y-2 text-sm">
              <span className="text-slate-300">Nueva contraseña</span>
              <div className="relative">
                <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-600" />
                <input autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={72} type={showPassword ? "text" : "password"} placeholder="Ingresa una contraseña" className={`${fieldClass} pr-11 pl-10`} />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-slate-600 hover:text-white" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </div>
            </label>
            <label className="block space-y-2 text-sm">
              <span className="text-slate-300">Repite la contraseña</span>
              <div className="relative">
                <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-600" />
                <input autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={10} maxLength={72} type={showConfirmation ? "text" : "password"} placeholder="Repite tu contraseña" className={`${fieldClass} pr-11 pl-10`} />
                <button type="button" onClick={() => setShowConfirmation((visible) => !visible)} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-slate-600 hover:text-white" aria-label={showConfirmation ? "Ocultar contraseña" : "Mostrar contraseña"}>{showConfirmation ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </div>
            </label>
            <button disabled={working} className="h-12 w-full rounded-xl bg-violet-500 text-sm font-medium hover:bg-violet-400 disabled:opacity-60">{working ? "Cambiando…" : "Cambiar contraseña"}</button>
          </form>
        )}
        {message && <p role="alert" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[.08] p-3 text-sm leading-5 text-amber-200">{message}</p>}
      </section>
    </main>
  );
}

