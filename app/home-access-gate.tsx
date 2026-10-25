"use client";

import * as React from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type GateState = "loading" | "signed-in" | "signed-out";

const logoUrl = "/negodigi-logo.png";
const LoginForm = React.lazy(() =>
  import("./login/login-form").then((module) => ({ default: module.LoginForm })),
);
const OperatingSystem = React.lazy(() =>
  import("./operating-system").then((module) => ({ default: module.OperatingSystem })),
);

function AccessLoader({ message }: { message: string }) {
  return (
    <main className="auth-shell grid min-h-screen place-items-center bg-[#f5f7fb] p-5 text-[#142b4a]">
      <div className="flex flex-col items-center gap-4">
        <img src={logoUrl} alt="NegoDigi" className="h-12 w-auto object-contain" />
        <p className="text-sm text-[#64748b]">{message}</p>
      </div>
    </main>
  );
}

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
    return <AccessLoader message="Comprobando acceso…" />;
  }

  if (state === "signed-in") {
    return (
      <React.Suspense fallback={<AccessLoader message="Abriendo NegoDigi…" />}>
        <OperatingSystem />
      </React.Suspense>
    );
  }

  return (
    <main className="auth-shell auth-background relative isolate min-h-screen overflow-hidden bg-[#f5f7fb] px-5 py-10 text-[#142b4a]">
      <span className="auth-bubble auth-bubble--one" aria-hidden="true" />
      <span className="auth-bubble auth-bubble--two" aria-hidden="true" />
      <span className="auth-bubble auth-bubble--three" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-lg items-center justify-center">
        <section className="auth-card w-full rounded-[30px] border border-[#e2e8f0] bg-white px-8 py-10 shadow-[0_24px_70px_rgba(15,23,42,.10)] sm:px-10 sm:py-11">
          <div className="flex flex-col items-center text-center">
            <img src={logoUrl} alt="NegoDigi" className="h-16 w-auto max-w-[220px] object-contain" />
            <p className="mt-5 text-[11px] font-semibold uppercase tracking-[.22em] text-[#1769e8]">NegoDigi APP</p>
            <h1 className="mt-3 text-[28px] font-semibold tracking-[-.03em] text-[#102a4a]">Acceso privado</h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-[#64748b]">
              Entra con tu email y contraseña. Si es tu primera vez, crea tu acceso con el email que Dirección ya tiene registrado en NegoDigi.
            </p>
          </div>
          <div className="mt-8">
            <React.Suspense fallback={<p className="py-8 text-center text-sm text-[#64748b]">Preparando acceso…</p>}>
              <LoginForm />
            </React.Suspense>
          </div>
          <p className="mt-7 text-center text-xs text-[#94a3b8]">Acceso privado para dirección, editores y clientes</p>
        </section>
      </div>
    </main>
  );
}

