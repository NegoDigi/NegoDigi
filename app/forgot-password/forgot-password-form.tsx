"use client";

import * as React from "react";
import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const fieldClass =
  "h-12 w-full rounded-xl border border-[#dbe5ef] bg-[#f8fafc] px-4 text-sm text-[#142b4a] outline-none placeholder:text-[#94a3b8] focus:border-[#1769e8] focus:ring-4 focus:ring-blue-100";

const logoUrl = "https://pub-faa10ba6d70742bb8e0160e5bfc808f0.r2.dev/LOGO%20NEGODIGI.png";

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
    <main className="auth-shell grid min-h-screen place-items-center bg-[#f5f7fb] p-5 text-[#142b4a]">
      <section className="auth-card w-full max-w-md rounded-[28px] border border-[#e2e8f0] bg-white px-7 py-9 shadow-[0_24px_70px_rgba(15,23,42,.10)] sm:px-9">
        <Link href="/" className="inline-flex items-center gap-2 text-xs text-[#64748b] transition hover:text-[#142b4a]">
          <ArrowLeft className="size-4" /> Volver al acceso
        </Link>
        <div className="mt-7 flex justify-center">
          <img src={logoUrl} alt="NegoDigi" className="h-14 w-auto max-w-[200px] object-contain" />
        </div>
        <p className="mt-5 text-center text-[11px] font-semibold uppercase tracking-[.22em] text-[#1769e8]">NegoDigi APP</p>
        <h1 className="mt-3 text-center text-[27px] font-semibold tracking-[-.03em] text-[#102a4a]">Recupera tu contraseña</h1>
        <p className="mt-3 text-center text-sm leading-6 text-[#64748b]">
          Escribe el email con el que entras en NegoDigi y te enviaremos un código seguro para elegir una nueva contraseña.
        </p>

        {!sent ? (
          <form onSubmit={submit} className="mt-7 space-y-4">
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-[#334155]">Email</span>
              <div className="relative">
                <Mail className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#94a3b8]" />
                <input autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} type="email" placeholder="tu@email.com" className={`${fieldClass} pl-10`} />
              </div>
            </label>
            <button disabled={working} className="h-12 w-full rounded-xl bg-[#1769e8] text-sm font-semibold text-white shadow-[0_12px_28px_rgba(23,105,232,.24)] transition hover:bg-[#125bc9] disabled:opacity-60" aria-busy={working}>
              {working ? "Enviando…" : "Enviar código seguro"}
            </button>
          </form>
        ) : (
          <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-700" role="status">
            Si ese email tiene un acceso, recibirás un mensaje de NegoDigi con el código para cambiar tu contraseña. Revisa también spam o promociones.
          </div>
        )}
        {message && <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-800">{message}</p>}
        <p className="mt-5 text-center text-xs leading-5 text-[#94a3b8]">El código es de un solo uso y caduca por seguridad.</p>
      </section>
    </main>
  );
}
