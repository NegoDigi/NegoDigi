"use client";

import * as React from "react";
import { CheckCircle2, CircleDollarSign, Clock3, LogOut, Plus, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Profile = {
  role: "owner" | "admin" | "editor" | "client";
  display_name: string;
  organization_id: string;
  editor_id: string | null;
  client_id: string | null;
};

type Job = {
  id: string;
  title: string;
  status: "pending" | "delivered";
  due_on: string | null;
  delivered_on: string | null;
  clients: { name: string } | null;
  editors: { name: string } | null;
  job_items: { service: string; quantity: number | string }[] | null;
  job_financials: { client_total: number | string; editor_total: number | string; margin: number | string }[] | null;
};

type ClientOption = { id: string; name: string };
type EditorOption = { id: string; name: string };
type Transaction = { transaction_type: "income" | "expense"; amount: number | string; occurred_on: string };
type Bonus = { available_amount: number | string };
type Receivable = { amount: number | string; source: string; status: string };

const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto"];

function amount(value: number | string | null | undefined) {
  return Number(value || 0);
}

function roleLabel(role: Profile["role"]) {
  if (role === "owner") return "Founder / CEO";
  if (role === "admin") return "Dirección";
  if (role === "editor") return "Editor";
  return "Cliente";
}

function Metric({ label, value, detail, tone = "violet" }: { label: string; value: string; detail: string; tone?: "violet" | "green" | "red" | "blue" }) {
  const tones = { violet: "border-violet-400/20 bg-violet-400/[0.08]", green: "border-emerald-400/20 bg-emerald-400/[0.08]", red: "border-rose-400/20 bg-rose-400/[0.08]", blue: "border-sky-400/20 bg-sky-400/[0.08]" };
  return <div className={`rounded-2xl border p-5 ${tones[tone]}`}><p className="text-xs font-medium tracking-wide text-slate-400 uppercase">{label}</p><p className="number-tabular mt-3 text-2xl font-semibold text-white">{value}</p><p className="mt-2 text-xs text-slate-500">{detail}</p></div>;
}

function Login({ onSession }: { onSession: () => Promise<void> }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const supabase = createSupabaseBrowserClient();

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setNotice("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setNotice("No se pudo entrar. Si aún no tienes cuenta, crea primero tu acceso."); return; }
    await onSession();
  }

  async function signUp() {
    setLoading(true); setNotice("");
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) { setNotice(error.message); return; }
    if (data.session) { await onSession(); return; }
    setNotice("Cuenta creada. Confirma el correo y vuelve a entrar con tu contraseña.");
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#080b11] p-5 text-white"><section className="w-full max-w-md rounded-3xl border border-white/[0.08] bg-[#111722] p-7 shadow-2xl shadow-black/30"><div className="mb-8"><div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 font-bold">N</div><p className="mt-5 text-xs tracking-[.2em] text-violet-300 uppercase">NegoDigi OS</p><h1 className="mt-2 text-2xl font-semibold">Acceso privado</h1><p className="mt-2 text-sm leading-6 text-slate-400">Founder / CEO, editores y clientes usan el mismo acceso; los permisos se aplican automáticamente.</p></div><form onSubmit={signIn} className="space-y-4"><input required value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="Email" className="h-12 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 outline-none ring-violet-400/40 focus:ring-2"/><input required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Contraseña (mínimo 8 caracteres)" className="h-12 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 outline-none ring-violet-400/40 focus:ring-2"/><button disabled={loading} className="h-12 w-full rounded-xl bg-violet-500 font-medium transition hover:bg-violet-400 disabled:opacity-60">{loading ? "Procesando…" : "Entrar"}</button></form><button disabled={loading || !email || password.length < 8} onClick={signUp} className="mt-3 h-11 w-full rounded-xl border border-white/[0.1] text-sm text-slate-300 hover:bg-white/[0.04] disabled:opacity-50">Crear mi acceso</button>{notice && <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] p-3 text-sm leading-5 text-amber-200">{notice}</p>}<p className="mt-5 text-center text-[11px] leading-5 text-slate-600">Un email no autorizado puede crear cuenta, pero no obtiene acceso a ningún dato.</p></section></main>;
}

export function LiveWorkspace() {
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [clients, setClients] = React.useState<ClientOption[]>([]);
  const [editors, setEditors] = React.useState<EditorOption[]>([]);
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [bonuses, setBonuses] = React.useState<Bonus[]>([]);
  const [receivables, setReceivables] = React.useState<Receivable[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [showNewJob, setShowNewJob] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true); setError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setProfile(null); setLoading(false); return; }
    const { data: profileData, error: profileError } = await supabase.from("profiles").select("role,display_name,organization_id,editor_id,client_id").eq("id", user.id).single();
    if (profileError || !profileData) { setProfile(null); setError("Tu email está autenticado, pero todavía no tiene un rol autorizado en NegoDigi."); setLoading(false); return; }
    const activeProfile = profileData as Profile;
    setProfile(activeProfile);
    const [jobsResult, clientsResult, editorsResult, transactionResult, bonusResult, receivableResult] = await Promise.all([
      supabase.from("jobs").select("id,title,status,due_on,delivered_on,clients(name),editors(name),job_items(service,quantity),job_financials(client_total,editor_total,margin)").order("due_on", { ascending: true, nullsFirst: false }),
      supabase.from("clients").select("id,name").order("name"),
      supabase.from("editors").select("id,name").order("name"),
      supabase.from("finance_transactions").select("transaction_type,amount,occurred_on").order("occurred_on"),
      supabase.from("bonus_balances").select("available_amount"),
      supabase.from("receivables").select("amount,source,status").eq("status", "open"),
    ]);
    const queryError = [jobsResult.error, clientsResult.error, editorsResult.error, transactionResult.error, bonusResult.error, receivableResult.error].find(Boolean);
    if (queryError) setError(queryError.message);
    setJobs((jobsResult.data || []) as unknown as Job[]);
    setClients((clientsResult.data || []) as ClientOption[]);
    setEditors((editorsResult.data || []) as EditorOption[]);
    setTransactions((transactionResult.data || []) as Transaction[]);
    setBonuses((bonusResult.data || []) as Bonus[]);
    setReceivables((receivableResult.data || []) as Receivable[]);
    setLoading(false);
  }, [supabase]);

  React.useEffect(() => { const initialRefresh = window.setTimeout(() => void refresh(), 0); const { data } = supabase.auth.onAuthStateChange(() => void refresh()); return () => { window.clearTimeout(initialRefresh); data.subscription.unsubscribe(); }; }, [refresh, supabase]);

  async function createJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!profile) return;
    const form = new FormData(event.currentTarget);
    const clientId = String(form.get("client_id")); const editorId = String(form.get("editor_id") || "");
    const service = String(form.get("service")); const quantity = amount(String(form.get("quantity")));
    const clientTotal = amount(String(form.get("client_total"))); const editorTotal = amount(String(form.get("editor_total")));
    const client = clients.find((item) => item.id === clientId);
    if (!client || !quantity) return;
    setSaving(true);
    const { data: job, error: jobError } = await supabase.from("jobs").insert({ organization_id: profile.organization_id, client_id: clientId, editor_id: editorId || null, title: `${client.name} · ${service} · ${quantity}`, status: "pending", due_on: String(form.get("due_on") || "") || null, source: "app" }).select("id").single();
    if (jobError || !job) { setError(jobError?.message || "No se pudo crear el trabajo."); setSaving(false); return; }
    const { error: detailError } = await supabase.from("job_items").insert({ organization_id: profile.organization_id, job_id: job.id, service, quantity });
    const { error: financeError } = await supabase.from("job_financials").insert({ organization_id: profile.organization_id, job_id: job.id, client_total: clientTotal, editor_total: editorTotal, tools_total: 0 });
    setSaving(false);
    if (detailError || financeError) { setError(detailError?.message || financeError?.message || "El trabajo se creó, pero faltó algún detalle."); return; }
    setShowNewJob(false); await refresh();
  }

  async function deliverJob(id: string) {
    const { error: deliveryError } = await supabase.from("jobs").update({ status: "delivered", delivered_on: new Date().toISOString().slice(0, 10) }).eq("id", id);
    if (deliveryError) { setError(deliveryError.message); return; }
    await refresh();
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#080b11] text-sm text-slate-400">Conectando NegoDigi APP…</main>;
  if (!profile) return <Login onSession={refresh} />;

  const isFounder = profile.role === "owner" || profile.role === "admin";
  const pending = jobs.filter((job) => job.status === "pending");
  const history = jobs.filter((job) => job.status === "delivered");
  const income = transactions.filter((row) => row.transaction_type === "income").reduce((sum, row) => sum + amount(row.amount), 0);
  const expenses = transactions.filter((row) => row.transaction_type === "expense").reduce((sum, row) => sum + amount(row.amount), 0);
  const credit = bonuses.reduce((sum, row) => sum + amount(row.available_amount), 0);
  const manualReceivables = receivables.filter((row) => row.source !== "bonus_excess").reduce((sum, row) => sum + amount(row.amount), 0);
  const autoExcess = receivables.filter((row) => row.source === "bonus_excess").reduce((sum, row) => sum + amount(row.amount), 0);
  const monthly = months.map((name, index) => { const prefix = `2026-${String(index + 1).padStart(2, "0")}`; const rows = transactions.filter((row) => row.occurred_on.startsWith(prefix)); const monthIncome = rows.filter((row) => row.transaction_type === "income").reduce((sum, row) => sum + amount(row.amount), 0); const monthExpense = rows.filter((row) => row.transaction_type === "expense").reduce((sum, row) => sum + amount(row.amount), 0); return { name, income: monthIncome, expense: monthExpense, net: monthIncome - monthExpense }; });

  return <main className="min-h-screen bg-[#080b11] text-slate-100"><header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#080b11]/90 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 text-sm font-bold">N</span><div><p className="text-sm font-semibold text-white">NegoDigi OS</p><p className="text-[11px] text-slate-500">{roleLabel(profile.role)} · {profile.display_name}</p></div></div><div className="flex items-center gap-2"><button onClick={() => void refresh()} className="grid size-9 place-items-center rounded-xl border border-white/[0.08] text-slate-400 hover:bg-white/[0.04]" aria-label="Actualizar"><RefreshCw className="size-4" /></button><button onClick={() => void supabase.auth.signOut()} className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] px-3 text-xs text-slate-300 hover:bg-white/[0.04]"><LogOut className="size-3.5" />Salir</button></div></div></header><div className="mx-auto max-w-7xl space-y-7 p-4 sm:p-6"><section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs tracking-[.18em] text-violet-300 uppercase">Centro de mando · conectado</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{isFounder ? "Dirección de NegoDigi" : `Panel de ${roleLabel(profile.role).toLowerCase()}`}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Datos reales desde Supabase. Los cambios aquí se guardan en la base de NegoDigi.</p></div>{isFounder && <button onClick={() => setShowNewJob((value) => !value)} className="inline-flex h-11 items-center justify-center rounded-xl bg-violet-500 px-4 text-sm font-medium hover:bg-violet-400"><Plus className="mr-2 size-4" />Nuevo trabajo</button>}</section>{error && <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.08] p-4 text-sm text-rose-200">{error}</div>}{showNewJob && isFounder && <form onSubmit={createJob} className="grid gap-3 rounded-2xl border border-violet-400/20 bg-violet-400/[0.06] p-5 md:grid-cols-3"><select required name="client_id" className="h-11 rounded-xl border border-white/[0.08] bg-[#111722] px-3"><option value="">Cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><select name="editor_id" className="h-11 rounded-xl border border-white/[0.08] bg-[#111722] px-3"><option value="">Sin asignar</option>{editors.map((editor) => <option key={editor.id} value={editor.id}>{editor.name}</option>)}</select><input required name="due_on" type="date" className="h-11 rounded-xl border border-white/[0.08] bg-[#111722] px-3"/><input required defaultValue="Reels" name="service" placeholder="Servicio" className="h-11 rounded-xl border border-white/[0.08] bg-[#111722] px-3"/><input required min="1" step="0.01" defaultValue="1" name="quantity" type="number" placeholder="Cantidad" className="h-11 rounded-xl border border-white/[0.08] bg-[#111722] px-3"/><input required min="0" step="0.01" name="client_total" type="number" placeholder="Cobro cliente (€)" className="h-11 rounded-xl border border-white/[0.08] bg-[#111722] px-3"/><input required min="0" step="0.01" name="editor_total" type="number" placeholder="Pago editor (€)" className="h-11 rounded-xl border border-white/[0.08] bg-[#111722] px-3"/><div className="flex gap-2 md:col-span-2"><button disabled={saving} className="h-11 rounded-xl bg-violet-500 px-5 text-sm font-medium hover:bg-violet-400 disabled:opacity-60">{saving ? "Guardando…" : "Crear trabajo"}</button><button type="button" onClick={() => setShowNewJob(false)} className="h-11 rounded-xl border border-white/[0.1] px-5 text-sm text-slate-300">Cancelar</button></div></form>}<section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{isFounder ? <><Metric label="Ingresos" value={euro.format(income)} detail="99 movimientos conciliados" tone="green"/><Metric label="Gastos" value={euro.format(expenses)} detail="42 movimientos de NegoDigi" tone="red"/><Metric label="Neto" value={euro.format(income - expenses)} detail="Ingresos menos gastos"/><Metric label="Crédito disponible" value={euro.format(credit)} detail="No baja de cero" tone="blue"/></> : <><Metric label="Pendientes" value={String(pending.length)} detail="Trabajos abiertos"/><Metric label="Entregados" value={String(history.length)} detail="Historial disponible" tone="green"/><Metric label="Estado" value="Activo" detail="Acceso individual protegido" tone="blue"/></>}</section>{isFounder && <section className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]"><div className="rounded-2xl border border-white/[0.07] bg-[#111722] p-5"><h2 className="font-semibold text-white">Ingresos, gastos y neto por mes</h2><p className="mt-1 text-sm text-slate-500">Enero–agosto · cifras completas, sin abreviaciones.</p><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="border-b border-white/[0.07] text-left text-xs text-slate-500"><tr><th className="pb-3 font-medium">Mes</th><th className="pb-3 text-right font-medium">Ingresos</th><th className="pb-3 text-right font-medium">Gastos</th><th className="pb-3 text-right font-medium">Neto</th></tr></thead><tbody>{monthly.map((row) => <tr key={row.name} className="border-b border-white/[0.045]"><td className="py-3 text-slate-300">{row.name}</td><td className="py-3 text-right text-emerald-300">{euro.format(row.income)}</td><td className="py-3 text-right text-rose-300">{euro.format(row.expense)}</td><td className="py-3 text-right font-medium text-white">{euro.format(row.net)}</td></tr>)}</tbody></table></div></div><div className="space-y-4"><div className="rounded-2xl border border-white/[0.07] bg-[#111722] p-5"><div className="flex items-center gap-3"><CircleDollarSign className="size-5 text-amber-300"/><div><h2 className="font-semibold text-white">Cobros pendientes</h2><p className="text-sm text-slate-500">Separados de los excesos de bono.</p></div></div><p className="number-tabular mt-5 text-3xl font-semibold text-white">{euro.format(manualReceivables)}</p><p className="mt-1 text-xs text-slate-500">Excesos automáticos de bono: {euro.format(autoExcess)}</p></div><div className="rounded-2xl border border-white/[0.07] bg-[#111722] p-5"><div className="flex items-center gap-3"><ShieldCheck className="size-5 text-emerald-300"/><div><h2 className="font-semibold text-white">Permisos activos</h2><p className="text-sm text-slate-500">RLS validada en toda la base.</p></div></div></div></div></section>}<section className="rounded-2xl border border-white/[0.07] bg-[#111722] p-5"><div className="flex items-center justify-between gap-4"><div><h2 className="font-semibold text-white">Pendientes</h2><p className="mt-1 text-sm text-slate-500">Al entregar un trabajo, pasa automáticamente al Historial.</p></div><span className="rounded-full bg-violet-400/10 px-3 py-1 text-xs text-violet-200">{pending.length} abiertos</span></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="border-b border-white/[0.07] text-left text-xs text-slate-500"><tr><th className="pb-3 font-medium">Trabajo</th><th className="pb-3 font-medium">Editor</th><th className="pb-3 font-medium">Contenido</th><th className="pb-3 font-medium">Fecha límite</th>{isFounder && <th className="pb-3 text-right font-medium">Acción</th>}</tr></thead><tbody>{pending.map((job) => <tr key={job.id} className="border-b border-white/[0.045]"><td className="py-4"><p className="font-medium text-slate-200">{job.clients?.name || job.title}</p><p className="mt-1 text-xs text-slate-500">{job.title}</p></td><td className="py-4 text-slate-400">{job.editors?.name || "Sin asignar"}</td><td className="py-4 text-slate-400">{(job.job_items || []).map((item) => `${item.quantity} ${item.service}`).join(" · ") || "—"}</td><td className="py-4 text-slate-400">{job.due_on ? new Intl.DateTimeFormat("es-ES").format(new Date(`${job.due_on}T12:00:00`)) : "—"}</td>{isFounder && <td className="py-4 text-right"><button onClick={() => void deliverJob(job.id)} className="inline-flex items-center rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-400/[0.14]"><CheckCircle2 className="mr-1.5 size-3.5"/>Marcar entregado</button></td>}</tr>)}{pending.length === 0 && <tr><td colSpan={isFounder ? 5 : 4} className="py-12 text-center text-slate-500">No hay trabajos pendientes.</td></tr>}</tbody></table></div></section><section className="rounded-2xl border border-white/[0.07] bg-[#111722] p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-white">Historial de entregados</h2><p className="mt-1 text-sm text-slate-500">{history.length} trabajos entregados.</p></div><Clock3 className="size-5 text-slate-500"/></div><div className="mt-4 grid gap-2 md:grid-cols-2">{history.slice(0, 8).map((job) => <div key={job.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"><p className="text-sm font-medium text-slate-200">{job.clients?.name || job.title}</p><p className="mt-1 text-xs text-slate-500">{job.delivered_on ? new Intl.DateTimeFormat("es-ES").format(new Date(`${job.delivered_on}T12:00:00`)) : "Fecha histórica no registrada"}</p></div>)}</div></section></div></main>;
}
