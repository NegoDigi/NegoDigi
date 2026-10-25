"use client";

import * as React from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { LoginForm } from "./login/login-form";
import { OperatingSystem } from "./operating-system";

type GateState = "loading" | "signed-in" | "signed-out";

const logoUrl = "https://pub-faa10ba6d70742bb8e0160e5bfc808f0.r2.dev/LOGO%20NEGODIGI.png";

export function HomeAccessGate() {
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [state, setState] = React.useState<GateState>("loading");

  React.useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setState(data.session?.user ? "signed-in" : "signed-out");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState(session?.user ? "signed-in" : "signed-out");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  if (state === "loading") {
    return (
      <main className="auth-shell grid min-h-screen place-items-center bg-[#f5f7fb] p-5 text-[#142b4a]">
        <div className="flex flex-col items-center gap-4">
          <img src={logoUrl} alt="NegoDigi" className="h-12 w-auto object-contain" />
          <p className="text-sm text-[#64748b]">Comprobando acceso…</p>
        </div>
      </main>
    );
  }

  if (state === "signed-in") return <OperatingSystem />;

  return (
    <main className="auth-shell min-h-screen bg-[#f5f7fb] px-5 py-10 text-[#142b4a]">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md items-center justify-center">
        <section className="auth-card w-full rounded-[28px] border border-[#e2e8f0] bg-white px-7 py-9 shadow-[0_24px_70px_rgba(15,23,42,.10)] sm:px-9">
          <div className="flex flex-col items-center text-center">
            <img src={logoUrl} alt="NegoDigi" className="h-16 w-auto max-w-[220px] object-contain" />
            <p className="mt-5 text-[11px] font-semibold uppercase tracking-[.22em] text-[#1769e8]">NegoDigi APP</p>
            <h1 className="mt-3 text-[28px] font-semibold tracking-[-.03em] text-[#102a4a]">Acceso privado</h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-[#64748b]">
              Entra con tu email y contraseña. Si es tu primera vez, crea tu acceso con el email que Dirección ya tiene registrado en NegoDigi.
            </p>
          </div>
          <div className="mt-8">
            <LoginForm />
          </div>
          <p className="mt-7 text-center text-xs text-[#94a3b8]">Acceso privado para dirección, editores y clientes</p>
        </section>
      </div>
    </main>
  );
}
