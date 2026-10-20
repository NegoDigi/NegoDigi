"use client";

import * as React from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { callAccountSetup } from "@/lib/account-setup-client";

type SetupRequest = { id: string; display_name: string; email: string; reference: string; status: "pending" | "approved" | "processing"; expires_at: string };

export function AdminSetupRequests() {
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [requests, setRequests] = React.useState<SetupRequest[]>([]);
  const [confirmed, setConfirmed] = React.useState<Record<string, boolean>>({});
  const [working, setWorking] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState("");
  const inFlight = React.useRef<Promise<void> | null>(null);
  const alive = React.useRef(true);
  const refresh = React.useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const task = (async () => {
      try {
        const result = await callAccountSetup<{ requests: SetupRequest[] }>(supabase, { action: "admin_list" });
        if (alive.current) { setRequests(result.requests); setMessage(""); }
      } catch (error) {
        if (alive.current) setMessage(error instanceof Error ? error.message : "No se pudieron cargar las solicitudes.");
      } finally { if (alive.current) setLoading(false); inFlight.current = null; }
    })();
    inFlight.current = task;
    return task;
  }, [supabase]);

  React.useEffect(() => {
    alive.current = true;
    void refresh();
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => { alive.current = false; window.clearInterval(interval); };
  }, [refresh]);

  async function decide(request: SetupRequest, approve: boolean) {
    if (working || (approve && !confirmed[request.id])) return;
    setWorking(request.id);
    setMessage("");
    try {
      await callAccountSetup(supabase, { action: approve ? "admin_approve" : "admin_reject", request_id: request.id, reference: request.reference, identity_confirmed: approve && confirmed[request.id] });
      setConfirmed(current => ({ ...current, [request.id]: false }));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar la solicitud.");
    } finally { setWorking(null); }
  }

  return <section className="rounded-2xl border border-white/[.08] bg-white/[.02] p-5">
    <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-white">Primer acceso desde el dominio</h2><p className="mt-1 text-sm leading-6 text-slate-400">La persona solicita acceso en app.negodigi.com y crea su contraseña después de tu aprobación.</p></div><button type="button" onClick={() => void refresh()} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">Actualizar</button></div>
    {loading && <p className="mt-4 text-sm text-slate-400">Cargando solicitudes…</p>}
    {!loading && !requests.length && !message && <p className="mt-4 text-sm text-slate-400">No hay solicitudes pendientes.</p>}
    <div className="mt-4 space-y-3">{requests.map(request => <div key={request.id} className="rounded-xl border border-white/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-white">{request.display_name}</p><p className="text-sm text-slate-400">{request.email}</p></div><span className="font-mono text-lg tracking-wider text-violet-200">{request.reference}</span></div>
      {request.status === "pending" ? <><p className="mt-3 text-sm leading-6 text-amber-200">Contacta con esta persona por vuestro canal conocido y comprueba que ve esta misma referencia. El correo escrito por sí solo no demuestra su identidad.</p><label className="mt-3 flex items-start gap-3 text-sm leading-6 text-slate-200"><input type="checkbox" checked={Boolean(confirmed[request.id])} onChange={event => setConfirmed(current => ({ ...current, [request.id]: event.target.checked }))} className="mt-1 size-4" /><span>He confirmado con la persona su identidad y esta referencia.</span></label><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={Boolean(working) || !confirmed[request.id]} onClick={() => void decide(request, true)} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{working === request.id ? "Guardando…" : "Autorizar creación de contraseña"}</button><button type="button" disabled={Boolean(working)} onClick={() => void decide(request, false)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-50">Rechazar</button></div></> : <p className="mt-3 text-sm text-emerald-200">{request.status === "approved" ? "Autorizada. La persona ya puede elegir su contraseña en su pestaña." : "La persona está guardando su contraseña."}</p>}
      <p className="mt-3 text-xs text-slate-500">Caduca a las {new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(request.expires_at))}.</p>
    </div>)}</div>
    {message && <p role="alert" className="mt-4 text-sm text-amber-200">{message}</p>}
  </section>;
}
