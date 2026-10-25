"use client";

import * as React from "react";
import { ArrowLeft, Eye, EyeOff, LockKeyhole } from "lucide-react";
import Link from "next/link";

import { createSupabaseRecoveryBrowserClient } from "@/lib/supabase/client";

const fieldClass =
  "h-12 w-full rounded-xl border border-[#dbe5ef] bg-[#f8fafc] px-4 text-sm text-[#142b4a] outline-none placeholder:text-[#94a3b8] focus:border-[#1769e8] focus:ring-4 focus:ring-blue-100";

const logoUrl = "/negodigi-logo.png";

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
      const detail = error.message.toLowerCase();
      setMessage(
        error.code === "same_password" || detail.includes("different from the old password")
          ? "La nueva contraseña debe ser diferente a la anterior. Escribe otra y vuelve a intentarlo."
          : error.code === "weak_password" || (detail.includes("password") && detail.includes("character"))
            ? "La contraseña no cumple las reglas de seguridad de la cuenta. Prueba con al menos 6 caracteres y mezcla letras, números o símbolos."
            : "No se pudo guardar la contraseña. El enlace ya fue validado; prueba con otra contraseña.",
      );
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
    <main className="auth-shell grid min-h-screen place-items-center bg-[#f5f7fb] p-5 text-[#142b4a]">
      <section className="auth-card w-full max-w-md rounded-[28px] border border-[#e2e8f0] bg-white px-7 py-9 shadow-[0_24px_70px_rgba(15,23,42,.10)] sm:px-9">
        <Link href="/" className="inline-flex items-center gap-2 text-xs text-[#64748b] transition hover:text-[#142b4a]">
          <ArrowLeft className="size-4" /> Volver al acceso
        </Link>
        <div className="mt-7 flex justify-center">
          <img src={logoUrl} alt="NegoDigi" className="h-14 w-auto max-w-[200px] object-contain" />
        </div>
        <p className="mt-5 text-center text-[11px] font-semibold uppercase tracking-[.22em] text-[#1769e8]">NegoDigi APP</p>
        <h1 className="mt-3 text-center text-[27px] font-semibold tracking-[-.03em] text-[#102a4a]">Cambia tu contraseña</h1>

        {state === "checking" && <p className="mt-5 text-sm leading-6 text-[#64748b]">Comprobando tu enlace seguro…</p>}
        {state === "awaiting-confirmation" && (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-[#64748b]">Tu enlace está listo. Pulsa el botón para validarlo y elegir una nueva contraseña.</p>
            <button type="button" onClick={() => void continueRecovery()} disabled={working} className="flex h-12 w-full items-center justify-center rounded-xl bg-[#1769e8] text-sm font-semibold text-white shadow-[0_12px_28px_rgba(23,105,232,.24)] transition hover:bg-[#125bc9] disabled:opacity-60">
              {working ? "Validando enlace…" : "Continuar para cambiarla"}
            </button>
          </div>
        )}
        {state === "enter-code" && (
          <form onSubmit={verifyCode} className="mt-6 space-y-4">
            <p className="text-sm leading-6 text-[#64748b]">Introduce el código de 6 dígitos que aparece en el email de NegoDigi. Este método evita que un escáner de correo invalide el enlace.</p>
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-[#334155]">Email</span>
              <input autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} type="email" placeholder="tu@email.com" className={fieldClass} />
            </label>
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-[#334155]">Código de recuperación</span>
              <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required maxLength={6} type="text" placeholder="123456" className={`${fieldClass} text-center text-lg tracking-[.3em]`} />
            </label>
            <button disabled={working} className="h-12 w-full rounded-xl bg-[#1769e8] text-sm font-semibold text-white shadow-[0_12px_28px_rgba(23,105,232,.24)] transition hover:bg-[#125bc9] disabled:opacity-60">{working ? "Verificando…" : "Verificar código"}</button>
          </form>
        )}
        {state === "invalid" && (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-[#64748b]">Este enlace ha caducado o ya se ha utilizado. Solicita uno nuevo y usa el último mensaje que recibas.</p>
            <Link href="/forgot-password" className="flex h-12 items-center justify-center rounded-xl bg-[#1769e8] text-sm font-semibold text-white shadow-[0_12px_28px_rgba(23,105,232,.24)] transition hover:bg-[#125bc9]">Solicitar otro enlace</Link>
          </div>
        )}
        {state === "done" && (
          <div className="mt-5 space-y-4">
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-700" role="status">Tu contraseña se ha cambiado correctamente. Ya puedes entrar con ella.</p>
            <Link href="/" className="flex h-12 items-center justify-center rounded-xl bg-[#1769e8] text-sm font-semibold text-white shadow-[0_12px_28px_rgba(23,105,232,.24)] transition hover:bg-[#125bc9]">Entrar en NegoDigi</Link>
          </div>
        )}
        {state === "ready" && (
          <form onSubmit={submit} className="mt-7 space-y-4">
            <p className="text-sm leading-6 text-[#64748b]">Elige una contraseña nueva para volver a entrar en NegoDigi.</p>
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-[#334155]">Nueva contraseña</span>
              <div className="relative">
                <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#94a3b8]" />
                <input autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={72} type={showPassword ? "text" : "password"} placeholder="Ingresa una contraseña" className={`${fieldClass} pr-11 pl-10`} />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-[#94a3b8] transition hover:text-[#334155]" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </div>
            </label>
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-[#334155]">Repite la contraseña</span>
              <div className="relative">
                <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#94a3b8]" />
                <input autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={72} type={showConfirmation ? "text" : "password"} placeholder="Repite tu contraseña" className={`${fieldClass} pr-11 pl-10`} />
                <button type="button" onClick={() => setShowConfirmation((visible) => !visible)} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-[#94a3b8] transition hover:text-[#334155]" aria-label={showConfirmation ? "Ocultar contraseña" : "Mostrar contraseña"}>{showConfirmation ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </div>
            </label>
            <button disabled={working} className="h-12 w-full rounded-xl bg-[#1769e8] text-sm font-semibold text-white shadow-[0_12px_28px_rgba(23,105,232,.24)] transition hover:bg-[#125bc9] disabled:opacity-60">{working ? "Cambiando…" : "Cambiar contraseña"}</button>
          </form>
        )}
        {message && <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-800">{message}</p>}
      </section>
    </main>
  );
}


