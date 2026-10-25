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
        <Label htmlFor="email" className="text-sm font-medium text-[#334155]">Email</Label>
        <div className="relative">
          <Mail className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#94a3b8]" />
          <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="tu@email.com" className="h-12 rounded-xl border-[#dbe5ef] bg-[#f8fafc] pl-10 !text-[#142b4a] shadow-none placeholder:text-[#94a3b8] selection:bg-[#bfdbfe] selection:text-[#102a4a] focus:border-[#1769e8] focus:ring-4 focus:ring-blue-100" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="password" className="text-sm font-medium text-[#334155]">Contraseña</Label>
        <div className="relative">
          <LockKeyhole className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#94a3b8]" />
          <Input id="password" type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Ingresa tu contraseña" className="h-12 rounded-xl border-[#dbe5ef] bg-[#f8fafc] pr-11 pl-10 !text-[#142b4a] shadow-none placeholder:text-[#94a3b8] selection:bg-[#bfdbfe] selection:text-[#102a4a] focus:border-[#1769e8] focus:ring-4 focus:ring-blue-100" />
          <button type="button" onClick={() => setVisible((value) => !value)} className="absolute top-1/2 right-3.5 -translate-y-1/2 text-[#94a3b8] transition hover:text-[#334155]" aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}>
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <Link href="/forgot-password" className="-mt-1 block text-left text-xs font-medium text-[#1769e8] transition hover:text-[#125bc9]">
        ¿Olvidaste tu contraseña?
      </Link>
      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700">{error}</p>}
      <div className="space-y-3 pt-1">
        <Button type="submit" disabled={loading} className="h-12 w-full rounded-xl bg-[#1769e8] text-white font-semibold shadow-[0_12px_28px_rgba(23,105,232,.24)] transition hover:bg-[#125bc9] hover:shadow-[0_14px_34px_rgba(23,105,232,.30)]">
          {loading ? "Accediendo…" : "Entrar en NegoDigi"}
          {!loading && <ArrowRight className="ml-2 size-4" />}
        </Button>
        <Link href="/register" className="flex h-11 items-center justify-center rounded-xl border border-[#dbe5ef] bg-white text-sm font-medium text-[#334155] transition hover:border-[#9cc5f7] hover:bg-[#f2f7ff]">
          Primer acceso · Crear contraseña
        </Link>
      </div>
      {!isSupabaseConfigured() && <p className="text-center text-[11px] leading-5 text-[#94a3b8]">Vista de revisión: el formulario y los roles están preparados; falta autorizar Supabase.</p>}
    </form>
  );
}

