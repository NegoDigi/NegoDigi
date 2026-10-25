"use client";

import * as React from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("El acceso real se activará cuando conectemos el proyecto de Supabase.");
      return;
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);

    if (signInError) {
      setError("Email o contraseña incorrectos.");
      return;
    }

    window.location.assign("/");
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email" className="text-xs text-slate-400">Email</Label>
        <div className="relative">
          <Mail className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-600" />
          <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="tu@email.com" className="h-12 rounded-xl border-white/[0.07] bg-white/[0.025] pl-10" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="text-xs text-slate-400">Contraseña</Label>
        <div className="relative">
          <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-600" />
          <Input id="password" type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="••••••••" className="h-12 rounded-xl border-white/[0.07] bg-white/[0.025] pr-11 pl-10" />
          <button type="button" onClick={() => setVisible((value) => !value)} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-slate-600 hover:text-white" aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}>
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      {error && <p className="rounded-xl border border-amber-400/15 bg-amber-400/[0.06] p-3 text-xs leading-5 text-amber-200">{error}</p>}
      <Button type="submit" disabled={loading} className="h-12 w-full rounded-xl bg-violet-500 font-medium hover:bg-violet-400">
        {loading ? "Accediendo…" : "Entrar en NegoDigi"}
        {!loading && <ArrowRight className="ml-2 size-4" />}
      </Button>
      <Link href="/register" className="flex h-11 items-center justify-center rounded-xl border border-white/[0.1] text-sm text-slate-300 transition hover:bg-white/[0.04]">
        Primer acceso · Crear contraseña
      </Link>
      {!isSupabaseConfigured() && <p className="text-center text-[11px] leading-5 text-slate-600">Vista de revisión: el formulario y los roles están preparados; falta autorizar Supabase.</p>}
    </form>
  );
}

