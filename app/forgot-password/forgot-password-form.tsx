"use client";

import * as React from "react";
import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const fieldClass =
  "h-12 w-full rounded-xl border border-white/10 bg-white/[.03] px-4 text-sm outline-none focus:ring-2 focus:ring-violet-400/50";

export function ForgotPasswordForm() {
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [sent, setSent] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    setMessage("");
    const slowNotice = window.setTimeout(() => {
      setMessage("El proveedor de correo está tardando más de lo normal. No cierres esta página; el mensaje puede llegar igualmente en unos instantes.");
    }, 7_000);
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo },
      );
      if (error) throw error;
      setSent(true);
    } catch {
      setMessage("No se pudo enviar el email ahora. Inténtalo de nuevo en unos minutos.");
    } finally {
      window.clearTimeout(slowNotice);
      setWorking(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#080b11] p-5 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/[.08] bg-[#111722] p-7 shadow-2xl shadow-black/30">
        <Link href="/" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-white">
          <ArrowLeft className="size-4" /> Volver al acceso
        </Link>
        <span className="mt-7 grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-sm font-bold">N</span>
        <p className="mt-5 text-[11px] uppercase tracking-[.2em] text-violet-300">NegoDigi APP</p>
        <h1 className="mt-2 text-2xl font-semibold">Recupera tu contraseña</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Escribe el email con el que entras en NegoDigi y te enviaremos un código seguro para elegir una nueva contraseña.
        </p>

        {!sent ? (
          <form onSubmit={submit} className="mt-7 space-y-4">
            <label className="block space-y-2 text-sm">
              <span className="text-slate-300">Email</span>
              <div className="relative">
                <Mail className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-600" />
                <input autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} type="email" placeholder="tu@email.com" className={`${fieldClass} pl-10`} />
              </div>
            </label>
            <button disabled={working} className="h-12 w-full rounded-xl bg-violet-500 text-sm font-medium text-white shadow-[0_12px_30px_rgba(23,105,232,.22)] hover:bg-violet-400 disabled:opacity-60" aria-busy={working}>
              {working ? "Enviando…" : "Enviar código seguro"}
            </button>
          </form>
        ) : (
          <div className="mt-7 rounded-2xl border border-emerald-400/20 bg-emerald-400/[.08] p-4 text-sm leading-6 text-emerald-200" role="status">
            Si ese email tiene un acceso, recibirás un mensaje de NegoDigi con el código para cambiar tu contraseña. Revisa también spam o promociones.
          </div>
        )}
        {message && <p role="alert" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[.08] p-3 text-sm leading-5 text-amber-200">{message}</p>}
        <p className="mt-5 text-center text-xs leading-5 text-slate-500">El código es de un solo uso y caduca por seguridad.</p>
      </section>
    </main>
  );
}

