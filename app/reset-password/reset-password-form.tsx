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
  | "enter-code"
  | "ready"
  | "invalid"
  | "done";

export function ResetPasswordForm() {
  const supabase = React.useMemo(() => createSupabaseRecoveryBrowserClient(), []);
  const [state, setState] = React.useState<PageState>("checking");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmation, setShowConfirmation] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const tokenHashRef = React.useRef<string | null>(null);
  const recoveryResolutionRef = React.useRef<Promise<PageState> | null>(null);

  React.useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session && !tokenHashRef.current) setState("ready");
    });

    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const authCode = params.get("code");
    tokenHashRef.current = tokenHash;
    const resolveRecovery = async (): Promise<PageState> => {
      if (tokenHash) return "awaiting-confirmation";
      if (authCode) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);
        return !error && data.session ? "ready" : "invalid";
      }
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      const { data } = await supabase.auth.getSession();
      return data.session ? "ready" : "enter-code";
    };
    recoveryResolutionRef.current ||= resolveRecovery();
    void recoveryResolutionRef.current.then((nextState) => {
      if (active) setState(nextState);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  function finishRecovery() {
    tokenHashRef.current = null;
    window.history.replaceState(null, "", "/reset-password");
    setState("ready");
    setWorking(false);
  }

  async function continueRecovery() {
    const tokenHash = tokenHashRef.current;
    if (!tokenHash || working) return;
    setWorking(true);
    setMessage("");
    const { data: existingSession } = await supabase.auth.getSession();
    if (existingSession.session) {
      finishRecovery();
      return;
    }
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (error || !data.session) {
      const { data: recoveredSession } = await supabase.auth.getSession();
      if (recoveredSession.session) {
        finishRecovery();
        return;
      }
      setState("invalid");
      setMessage("Este enlace ya no es válido. Solicita otro para cambiar tu contraseña.");
      setWorking(false);
      return;
    }
    finishRecovery();
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (working) return;
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = code.trim();
    if (!normalizedEmail || !/^\d{6}$/.test(normalizedCode)) {
      setMessage("Escribe el email y el código de 6 dígitos que aparecen en el mensaje.");
      return;
    }
    setWorking(true);
    setMessage("");
    const { data, error } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: normalizedCode,
      type: "recovery",
    });
    if (error || !data.session) {
      setMessage("El código no es válido o ya ha caducado. Solicita un código nuevo y usa el último que recibas.");
      setWorking(false);
      return;
    }
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
      setMessage("Este enlace o código ya no es válido. Solicita uno nuevo para cambiar tu contraseña.");
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
            <button type="button" onClick={() => void continueRecovery()} disabled={working} className="flex h-12 w-full items-center justify-center rounded-xl bg-violet-500 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-60">
              {working ? "Validando enlace…" : "Continuar para cambiarla"}
            </button>
          </div>
        )}
        {state === "enter-code" && (
          <form onSubmit={verifyCode} className="mt-6 space-y-4">
            <p className="text-sm leading-6 text-slate-300">Introduce el código de 6 dígitos que aparece en el email de NegoDigi. Este método evita que un escáner de correo invalide el enlace.</p>
            <label className="block space-y-2 text-sm">
              <span className="text-slate-300">Email</span>
              <input autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} type="email" placeholder="tu@email.com" className={fieldClass} />
            </label>
            <label className="block space-y-2 text-sm">
              <span className="text-slate-300">Código de recuperación</span>
              <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required maxLength={6} type="text" placeholder="123456" className={`${fieldClass} text-center text-lg tracking-[.3em]`} />
            </label>
            <button disabled={working} className="h-12 w-full rounded-xl bg-violet-500 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-60">{working ? "Verificando…" : "Verificar código"}</button>
          </form>
        )}
        {state === "invalid" && (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-slate-300">Este enlace ha caducado o ya se ha utilizado. Solicita uno nuevo y usa el último mensaje que recibas.</p>
            <Link href="/forgot-password" className="flex h-12 items-center justify-center rounded-xl bg-violet-500 text-sm font-medium text-white hover:bg-violet-400">Solicitar otro enlace</Link>
          </div>
        )}
        {state === "done" && (
          <div className="mt-5 space-y-4">
            <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/[.08] p-4 text-sm leading-6 text-emerald-200" role="status">Tu contraseña se ha cambiado correctamente. Ya puedes entrar con ella.</p>
            <Link href="/" className="flex h-12 items-center justify-center rounded-xl bg-violet-500 text-sm font-medium text-white hover:bg-violet-400">Entrar en NegoDigi</Link>
          </div>
        )}
        {state === "ready" && (
          <form onSubmit={submit} className="mt-7 space-y-4">
            <p className="text-sm leading-6 text-slate-300">Elige una contraseña nueva para volver a entrar en NegoDigi.</p>
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
            <button disabled={working} className="h-12 w-full rounded-xl bg-violet-500 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-60">{working ? "Cambiando…" : "Cambiar contraseña"}</button>
          </form>
        )}
        {message && <p role="alert" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[.08] p-3 text-sm leading-5 text-amber-200">{message}</p>}
      </section>
    </main>
  );
}

