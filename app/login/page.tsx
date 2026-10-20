import { ArrowLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { LoginForm } from "./login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <main className="soft-grid flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 inline-flex items-center gap-2 text-xs text-slate-500 transition hover:text-white"><ArrowLeft className="size-4" />Volver al panel</Link>
        <Card className="panel-surface border-white/[0.07] shadow-[0_30px_100px_rgba(0,0,0,.4)]">
          <CardHeader className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 font-bold text-white shadow-[0_15px_40px_rgba(124,92,255,.25)]">N</span>
              <div><p className="font-semibold text-white">NegoDigi APP</p><p className="text-[10px] tracking-[0.16em] text-slate-600 uppercase">Acceso seguro</p></div>
            </div>
            <div>
              <CardTitle className="text-2xl text-white">Bienvenido</CardTitle>
              <CardDescription className="mt-2 leading-6">Tu rol determina automáticamente el panel y los datos que puedes ver.</CardDescription>
            </div>
          </CardHeader>
          <CardContent><LoginForm /></CardContent>
        </Card>
        <p className="mt-5 flex items-center justify-center gap-2 text-[11px] text-slate-600"><ShieldCheck className="size-3.5" />Permisos separados para dirección, editores y clientes</p>
      </div>
    </main>
  );
}
