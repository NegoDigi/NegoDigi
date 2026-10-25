"use client";

import * as React from "react";
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

import { completeSelfAccess } from "@/lib/self-access";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const fieldClass =
  "h-12 w-full rounded-xl border border-[#dbe5ef] bg-[#f8fafc] px-4 text-sm text-[#142b4a] outline-none placeholder:text-[#94a3b8] focus:border-[#1769e8] focus:ring-4 focus:ring-blue-100";

const logoUrl = "https://pub-faa10ba6d70742bb8e0160e5bfc808f0.r2.dev/LOGO%20NEGODIGI.png";

export function RegisterForm() {
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirmation, setShowConfirmation] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [message, setMessage] = React.useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (working) return;
    setMessage("");
    if (password !== confirmation) {
      setMessage("Las contraseñas no coinciden.");
      return;
    }
    setWorking(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await completeSelfAccess(supabase, normalizedEmail, password);
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (error) throw new Error("Tu acceso se preparó, pero no se pudo iniciar la sesión. Vuelve a entrar desde la página principal.");
      window.location.replace("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo preparar el acceso.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="auth-shell grid min-h-screen place-items-center bg-[#f5f7fb] p-5 text-[#142b4a]">
      <section className="auth-card w-full max-w-md rounded-[28px] border border-[#e2e8f0] bg-white px-7 py-9 shadow-[0_24px_70px_rgba(15,23,42,.10)] sm:px-9">
        <a href="/" className="inline-flex items-center gap-2 text-xs text-[#64748b] transition hover:text-[#142b4a]">
          <ArrowLeft className="size-4" /> Volver al acceso
        </a>
        <div className="mt-7 flex justify-center">
          <img src={logoUrl} alt="NegoDigi" className="h-14 w-auto max-w-[200px] object-contain" />
        </div>
        <p className="mt-5 text-center text-[11px] font-semibold uppercase tracking-[.22em] text-[#1769e8]">NegoDigi APP</p>
        <h1 className="mt-3 text-center text-[27px] font-semibold tracking-[-.03em] text-[#102a4a]">Crea tu acceso</h1>
        <p className="mt-3 text-center text-sm leading-6 text-[#64748b]">
          Usa el email que Dirección tiene registrado en NegoDigi y elige tu contraseña. No necesitas recibir ningún correo ni confirmar nada.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block space-y-2 text-sm">
            <span className="font-medium text-[#334155]">Email registrado</span>
            <div className="relative">
              <Mail className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#94a3b8]" />
              <input autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} type="email" placeholder="tu@email.com" className={`${fieldClass} pl-10`} />
            </div>
          </label>
          <label className="block space-y-2 text-sm">
            <span className="font-medium text-[#334155]">Contraseña</span>
            <div className="relative">
              <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#94a3b8]" />
              <input autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={72} type={showPassword ? "text" : "password"} placeholder="Ingresa una contraseña" className={`${fieldClass} pr-11 pl-10`} />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-[#94a3b8] transition hover:text-[#334155]" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          <label className="block space-y-2 text-sm">
            <span className="font-medium text-[#334155]">Repite la contraseña</span>
            <div className="relative">
              <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#94a3b8]" />
              <input autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required maxLength={72} type={showConfirmation ? "text" : "password"} placeholder="Repite tu contraseña" className={`${fieldClass} pr-11 pl-10`} />
              <button type="button" onClick={() => setShowConfirmation((visible) => !visible)} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-[#94a3b8] transition hover:text-[#334155]" aria-label={showConfirmation ? "Ocultar contraseña" : "Mostrar contraseña"}>
                {showConfirmation ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          <button disabled={working} className="h-12 w-full rounded-xl bg-[#1769e8] text-sm font-semibold text-white shadow-[0_12px_28px_rgba(23,105,232,.24)] transition hover:bg-[#125bc9] disabled:opacity-60">
            {working ? "Preparando acceso…" : "Crear acceso y entrar"}
          </button>
        </form>
        {message && <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-800">{message}</p>}
        <p className="mt-5 text-center text-xs leading-5 text-[#94a3b8]">Si el email no está registrado en NegoDigi, tendrás que pedir a Dirección que lo añada.</p>
      </section>
    </main>
  );
}

