"use client";

import * as React from "react";
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

import { completeSelfAccess } from "@/lib/self-access";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const fieldClass =
  "h-12 w-full rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm outline-none focus:ring-2 focus:ring-violet-400/50";

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
    <main className="grid min-h-screen place-items-center bg-[#080b11] p-5 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/[.08] bg-[#111722] p-7 shadow-2xl shadow-black/30">
        <a href="/" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-white">
          <ArrowLeft className="size-4" /> Volver al acceso
        </a>
        <span className="mt-7 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-sm font-bold">N</span>
        <p className="mt-5 text-[11px] uppercase tracking-[.2em] text-violet-300">NegoDigi APP</p>
        <h1 className="mt-2 text-2xl font-semibold">Crea tu acceso</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Usa el email que Dirección tiene registrado en NegoDigi y elige tu contraseña. No necesitas recibir ningún correo ni confirmar nada.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block space-y-2 text-sm">
            <span className="text-slate-300">Email registrado</span>
            <div className="relative">
              <Mail className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-600" />
              <input autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} type="email" placeholder="tu@email.com" className={`${fieldClass} pl-10`} />
            </div>
          </label>
          <label className="block space-y-2 text-sm">
            <span className="text-slate-300">Contraseña</span>
            <div className="relative">
              <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-600" />
              <input autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={72} type={showPassword ? "text" : "password"} placeholder="Ingresa una contraseña" className={`${fieldClass} pr-11 pl-10`} />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-slate-600 hover:text-white" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          <label className="block space-y-2 text-sm">
            <span className="text-slate-300">Repite la contraseña</span>
            <div className="relative">
              <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-600" />
              <input autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={10} maxLength={72} type={showConfirmation ? "text" : "password"} placeholder="Repite tu contraseña" className={`${fieldClass} pr-11 pl-10`} />
              <button type="button" onClick={() => setShowConfirmation((visible) => !visible)} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-slate-600 hover:text-white" aria-label={showConfirmation ? "Ocultar contraseña" : "Mostrar contraseña"}>
                {showConfirmation ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          <button disabled={working} className="h-12 w-full rounded-xl bg-violet-500 text-sm font-medium hover:bg-violet-400 disabled:opacity-60">
            {working ? "Preparando acceso…" : "Crear acceso y entrar"}
          </button>
        </form>
        {message && <p role="alert" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[.08] p-3 text-sm leading-5 text-amber-200">{message}</p>}
        <p className="mt-5 text-center text-xs leading-5 text-slate-500">Si el email no está registrado en NegoDigi, tendrás que pedir a Dirección que lo añada.</p>
      </section>
    </main>
  );
}
