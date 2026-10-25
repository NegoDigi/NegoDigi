"use client";

import * as React from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { LoginForm } from "./login/login-form";
import { OperatingSystem } from "./operating-system";

type GateState = "loading" | "signed-in" | "signed-out";

export function HomeAccessGate() {
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [state, setState] = React.useState<GateState>("loading");

  React.useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setState(data.user ? "signed-in" : "signed-out");
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
      <main className="grid min-h-screen place-items-center bg-[#080b11] p-5 text-white">
        <p className="text-sm text-slate-400">Comprobando acceso…</p>
      </main>
    );
  }

  if (state === "signed-in") return <OperatingSystem />;

  return (
    <main className="grid min-h-screen place-items-center bg-[#080b11] p-5 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/[.08] bg-[#111722] p-7 shadow-2xl shadow-black/30">
        <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 text-sm font-bold">N</span>
        <p className="mt-5 text-[11px] uppercase tracking-[.2em] text-violet-300">NegoDigi APP</p>
        <h1 className="mt-2 text-2xl font-semibold">Acceso privado</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Entra con tu email y contraseña. Si es tu primera vez, crea tu acceso
          con el email que Dirección ya tiene registrado en NegoDigi.
        </p>
        <div className="mt-7">
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
