"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Camera,
  Compass,
  FileText,
  Handshake,
  Megaphone,
  MessagesSquare,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  contentStages,
  leadStages,
  localDateKey,
  optionalNumber,
  persistMarketingRecord,
  type Details,
  type MarketingRecord,
} from "@/lib/marketing";

type Section =
  "home" | "social" | "channels" | "ads" | "bcc" | "affiliates" | "crm";
type Entity =
  "content" | "lead" | "channel" | "campaign" | "affiliate" | "action";
type CrmTab = "panel" | "contacts" | "pipeline" | "portfolio" | "analytics";
type DialogState = {
  mode: "detail" | "form";
  entity: Entity;
  record?: MarketingRecord;
} | null;
type MarketingData = {
  resources: MarketingRecord[];
  content: MarketingRecord[];
  leads: MarketingRecord[];
};
type Upsell = {
  id: string;
  service: string;
  reason: string;
  probability: string;
  value: string;
  status: string;
  next_action: string;
  next_action_on: string;
};
type CommercialPair = { id: string; issue: string; response: string };

const panel =
  "rounded-2xl border border-slate-700/65 bg-slate-900/55 shadow-[0_12px_30px_rgba(2,6,23,.12)]";
const money = (value: number | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(value);
const number = (value: unknown) => optionalNumber(value) ?? 0;
const info = (record?: MarketingRecord) =>
  (record?.details || record?.marketing_details || {}) as Details;
const date = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("es-ES", {
        day: "numeric",
        month: "short",
      }).format(new Date(`${value}T12:00:00`))
    : "Sin fecha";
const stageLabel = (stage?: string) =>
  leadStages.find(([id]) => id === stage)?.[1] || stage || "Sin etapa";
const contentLabel = (stage?: string) =>
  contentStages.find(([id]) => id === stage)?.[1] || stage || "Sin estado";
const sourceLabel = (source?: string) =>
  ({
    bcc: "B.C.C.",
    social: "Redes sociales",
    channel: "Canal de captación",
    campaign: "Publicidad",
    affiliate: "Referido",
  })[source || ""] || "Sin origen";
const stateStyle: Record<string, string> = {
  active: "border-emerald-400/35 bg-emerald-500/10 text-emerald-200",
  draft: "border-slate-500/50 bg-slate-700/30 text-slate-300",
  paused: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  idea: "border-violet-400/40 bg-violet-500/10 text-violet-200",
  script: "border-sky-400/40 bg-sky-500/10 text-sky-200",
  recording: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  editing: "border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-200",
  scheduled: "border-blue-400/40 bg-blue-500/10 text-blue-200",
  published: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  new: "border-slate-400/40 bg-slate-600/25 text-slate-200",
  contacted: "border-cyan-400/40 bg-cyan-500/10 text-cyan-200",
  qualified: "border-violet-400/40 bg-violet-500/10 text-violet-200",
  negotiation: "border-violet-400/40 bg-violet-500/10 text-violet-200",
  proposal: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  active_client: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  past_client: "border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-200",
  one_off_client: "border-sky-400/40 bg-sky-500/10 text-sky-200",
  won: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  lost: "border-rose-400/40 bg-rose-500/10 text-rose-200",
};
const badge = (state?: string) =>
  stateStyle[state || ""] || "border-slate-600 bg-slate-800 text-slate-300";
const chartTooltip = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 12,
  color: "#e2e8f0",
};
const colors = ["#8b5cf6", "#38bdf8", "#34d399", "#fbbf24", "#fb7185"];

function Status({ state, label }: { state?: string; label: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badge(state)}`}
    >
      {label}
    </span>
  );
}
function Metric({
  label,
  value,
  help,
  tone = "text-white",
}: {
  label: string;
  value: string;
  help: string;
  tone?: string;
}) {
  return (
    <article className={`${panel} min-h-[126px] p-5`}>
      <p className="text-xs font-semibold uppercase tracking-[.12em] text-slate-400">
        {label}
      </p>
      <p className={`mt-4 text-3xl font-semibold tracking-tight ${tone}`}>
        {value}
      </p>
      <p className="mt-2 text-sm text-slate-400">{help}</p>
    </article>
  );
}
function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-950/25 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1.5 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center text-sm text-slate-400">
      <FileText className="mb-3 text-slate-500" size={27} />
      {children}
    </div>
  );
}
function parseUpsells(value?: unknown): Upsell[] {
  try {
    const parsed = JSON.parse(typeof value === "string" ? value : "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => item && typeof item === "object")
          .map((item, index) => ({
            id: String(item.id || crypto.randomUUID?.() || index),
            service: String(item.service || ""),
            reason: String(item.reason || ""),
            probability: String(item.probability || "Media"),
            value: String(item.value || ""),
            status: String(item.status || "Analizar caso"),
            next_action: String(item.next_action || ""),
            next_action_on: String(item.next_action_on || ""),
          }))
      : [];
  } catch {
    return [];
  }
}
function upsellsFor(record: MarketingRecord) {
  return parseUpsells(info(record).upsells);
}
function parsePairs(value?: unknown, fallback?: string): CommercialPair[] {
  try {
    const parsed = JSON.parse(typeof value === "string" ? value : "[]");
    if (Array.isArray(parsed))
      return parsed
        .filter((item) => item && typeof item === "object")
        .map((item, index) => ({
          id: String(item.id || index),
          issue: String(item.issue || ""),
          response: String(item.response || ""),
        }));
  } catch {}
  return fallback ? [{ id: "legacy", issue: fallback, response: "" }] : [];
}
function pairsFor(record: MarketingRecord, key: "problems" | "objections") {
  const d = info(record);
  return parsePairs(
    d[`${key}_json`],
    key === "problems" ? d.detected_problems : d.objections,
  );
}
function parseGoals(value?: unknown, fallback?: string): string[] {
  try {
    const parsed = JSON.parse(typeof value === "string" ? value : "[]");
    if (Array.isArray(parsed))
      return parsed.map((goal) => String(goal).trim()).filter(Boolean);
  } catch {}
  return fallback ? [fallback] : [];
}
function goalsFor(record: MarketingRecord) {
  const d = info(record);
  return parseGoals(d.business_goals_json, d.business_goal);
}
function closingScore(record: MarketingRecord) {
  const d = info(record);
  const phase: { [key: string]: number } = {
    new: 15,
    contacted: 30,
    negotiation: 55,
    proposal: 75,
    active_client: 70,
    past_client: 45,
    one_off_client: 50,
  };
  const potential: { [key: string]: number } = {
    High: 15,
    Medium: 8,
    Low: 2,
    Alta: 15,
    Media: 8,
    Baja: 2,
  };
  const temperature: { [key: string]: number } = {
    HOT: 10,
    MEDIUM: 5,
    COLD: 0,
  };
  return Math.min(
    100,
    (phase[record.stage || ""] || 10) +
      (potential[d.potential || d.upsell_potential || ""] || 0) +
      (temperature[d.temperature || ""] || 0) +
      (d.next_action_on ? 5 : 0) +
      (number(d.deal_value) > 0 ? 5 : 0),
  );
}

export function MarketingWorkspace({
  organizationId,
  canEdit,
  initialSection = "home",
}: {
  organizationId: string;
  canEdit: boolean;
  initialSection?: Section;
}) {
  const db = React.useMemo(() => createSupabaseBrowserClient(), []);
  const [section, setSection] = React.useState<Section>(initialSection);
  const [crmTab, setCrmTab] = React.useState<CrmTab>("panel");
  const [resources, setResources] = React.useState<MarketingRecord[]>([]);
  const [content, setContent] = React.useState<MarketingRecord[]>([]);
  const [leads, setLeads] = React.useState<MarketingRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [stage, setStage] = React.useState("");
  const request = React.useRef(0);

  const load = React.useCallback(async () => {
    if (!organizationId || !canEdit) return;
    const id = ++request.current;
    setLoading(true);
    setLoadError("");
    try {
      const read = async (
        table: "marketing_resources" | "content_items" | "leads",
      ) => {
        const { data, error } = await db
          .from(table)
          .select("*")
          .eq("organization_id", organizationId)
          .order("updated_at", { ascending: false });
        if (error) throw error;
        return (data || []) as MarketingRecord[];
      };
      const [r, c, l] = await Promise.all([
        read("marketing_resources"),
        read("content_items"),
        read("leads"),
      ]);
      if (id === request.current) {
        setResources(r);
        setContent(c);
        setLeads(l);
      }
    } catch (error) {
      if (id === request.current)
        setLoadError(
          error instanceof Error
            ? error.message
            : "No se pudo cargar Marketing.",
        );
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [canEdit, db, organizationId]);
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const data: MarketingData = { resources, content, leads };
  const activeLeads = data.leads.filter(
    (l) =>
      ![
        "lost",
        "do_not_contact",
        "archived",
        "past_client",
        "active_client",
        "one_off_client",
      ].includes(l.stage || ""),
  );
  const won = data.leads.filter((l) => l.stage === "won");
  const pipelineValue = activeLeads.reduce(
    (sum, lead) => sum + number(info(lead).deal_value),
    0,
  );
  const wonValue = won.reduce(
    (sum, lead) => sum + number(info(lead).deal_value),
    0,
  );
  const currentSource = (id?: string) =>
    data.resources.find((r) => r.id === id)?.name || "Sin origen";

  const go = (next: Section) => {
    setSection(next);
    setSearch("");
    setStage("");
  };
  const open = (
    entity: Entity,
    record?: MarketingRecord,
    mode: "detail" | "form" = "detail",
  ) => {
    setFormError("");
    setDialog({ entity, record, mode });
  };

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || dialog.mode !== "form" || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("name") || "").trim();
    if (!title) {
      setFormError("Indica un nombre.");
      return;
    }
    const previous = dialog.record;
    const extra: Details = { ...info(previous) };
    [
      "platform",
      "format",
      "pillar",
      "record_on",
      "edit_on",
      "publish_on",
      "hook",
      "script",
      "cta",
      "offer",
      "action",
      "views",
      "clicks",
      "conversations",
      "budget",
      "spend",
      "objective",
      "creative",
      "next_action",
      "next_action_on",
      "deal_value",
      "interest",
      "method",
      "notes",
      "contact",
      "business_goal",
      "business_goals_json",
      "detected_problems",
      "objections",
      "problems_json",
      "objections_json",
      "renewal_on",
      "payment_method",
      "potential",
      "temperature",
    ].forEach((key) => {
      const value = form.get(key);
      if (typeof value === "string") extra[key] = value.trim();
    });
    const upsells = form.get("upsells_json");
    if (typeof upsells === "string") extra.upsells = upsells;
    const entity = dialog.entity;
    const id = previous?.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      updated_at: now,
    };
    let table: "leads" | "content_items" | "marketing_resources";
    if (entity === "lead") {
      table = "leads";
      Object.assign(payload, {
        name: title,
        contact: extra.contact || previous?.contact || "",
        interest: extra.interest || null,
        stage: String(form.get("status") || "new"),
        source_id: String(form.get("source_id") || "") || null,
        next_action_on: extra.next_action_on || null,
        marketing_details: extra,
      });
    } else if (entity === "content") {
      table = "content_items";
      Object.assign(payload, {
        title,
        status: String(form.get("status") || "idea"),
        platform: extra.platform || null,
        publish_on: extra.publish_on || null,
        marketing_details: extra,
      });
    } else {
      table = "marketing_resources";
      Object.assign(payload, {
        kind: entity,
        name: title,
        status: String(form.get("status") || "draft"),
        details: extra,
      });
    }
    setSaving(true);
    setFormError("");
    try {
      const saved = await persistMarketingRecord(
        db,
        table,
        id,
        organizationId,
        payload,
        previous?.updated_at,
      );
      // Persistence contract: persistMarketingRecord(db,table,id,organizationId,payload,previous?.updated_at)
      if (entity === "lead")
        setLeads((rows) => [saved, ...rows.filter((r) => r.id !== id)]);
      else if (entity === "content")
        setContent((rows) => [saved, ...rows.filter((r) => r.id !== id)]);
      else setResources((rows) => [saved, ...rows.filter((r) => r.id !== id)]);
      setDialog(null);
      toast.success("Guardado");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "No se pudo guardar.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(record: MarketingRecord, entity: Entity) {
    if (
      !canEdit ||
      !window.confirm(
        `Eliminar definitivamente a ${record.name || record.title || "este registro"}? Esta acción no se puede deshacer.`,
      )
    )
      return;
    const table: "leads" | "content_items" | "marketing_resources" =
      entity === "lead"
        ? "leads"
        : entity === "content"
          ? "content_items"
          : "marketing_resources";
    setSaving(true);
    setFormError("");
    try {
      const { error } = await db
        .from(table)
        .delete()
        .eq("id", record.id)
        .eq("organization_id", organizationId);
      if (error) throw error;
      if (entity === "lead")
        setLeads((rows) => rows.filter((row) => row.id !== record.id));
      else if (entity === "content")
        setContent((rows) => rows.filter((row) => row.id !== record.id));
      else setResources((rows) => rows.filter((row) => row.id !== record.id));
      setDialog(null);
      toast.success("Registro eliminado");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar el registro.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit)
    return (
      <section className={`${panel} p-6`}>
        Marketing está disponible para usuarios con acceso de administración.
      </section>
    );
  if (dialog?.entity === "lead")
    return (
      <div className="space-y-6 pb-10">
        <LeadWorkspace
          record={dialog.record}
          mode={dialog.mode}
          resources={data.resources}
          error={formError}
          saving={saving}
          onBack={() => !saving && setDialog(null)}
          onEdit={() => open("lead", dialog.record, "form")}
          onSave={save}
          onDelete={
            dialog.record
              ? () => void remove(dialog.record!, "lead")
              : undefined
          }
        />
      </div>
    );
  return (
    <div className="space-y-6 pb-10">
      {loadError && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {loadError}
        </div>
      )}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {section !== "home" && section !== "crm" && (
            <button
              onClick={() => go("home")}
              className="mb-3 flex items-center gap-2 text-sm text-slate-400 hover:text-white"
            >
              <ArrowLeft size={16} />
              Marketing
            </button>
          )}
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-violet-300">
            {section === "crm" ? "Ventas" : "Marketing"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {titleFor(section)}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{subtitleFor(section)}</p>
        </div>
        {section !== "home" && (
          <Button
            onClick={() =>
              open(
                section === "social"
                  ? "content"
                  : section === "channels"
                    ? "channel"
                    : section === "ads"
                      ? "campaign"
                      : section === "affiliates"
                        ? "affiliate"
                        : "lead",
                undefined,
                "form",
              )
            }
          >
            <Plus size={17} />{" "}
            {section === "crm" || section === "bcc"
              ? "Nuevo contacto"
              : "Añadir"}
          </Button>
        )}
      </header>
      {loading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : (
        <Workspace
          section={section}
          crmTab={crmTab}
          setCrmTab={setCrmTab}
          data={data}
          pipelineValue={pipelineValue}
          wonValue={wonValue}
          activeLeads={activeLeads}
          search={search}
          setSearch={setSearch}
          stage={stage}
          setStage={setStage}
          onGo={go}
          onOpen={open}
          currentSource={currentSource}
        />
      )}
      <Dialog
        open={!!dialog}
        onOpenChange={(isOpen) => {
          if (!isOpen && !saving) setDialog(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>
            {dialog?.mode === "form"
              ? dialog.record
                ? "Editar registro"
                : formTitle(dialog?.entity)
              : dialog?.record?.name || dialog?.record?.title}
          </DialogTitle>
          <DialogDescription>
            {dialog?.mode === "form"
              ? "Actualiza la ficha, la siguiente acción y las oportunidades comerciales."
              : "Ficha de detalle y siguiente acción."}
          </DialogDescription>
          {dialog?.mode === "detail" && dialog.record ? (
            <Detail
              record={dialog.record}
              entity={dialog.entity}
              sourceName={
                dialog.record.source_id
                  ? currentSource(dialog.record.source_id)
                  : sourceLabel(info(dialog.record).method)
              }
              onEdit={() => open(dialog.entity, dialog.record, "form")}
              onDelete={() => void remove(dialog.record!, dialog.entity)}
            />
          ) : dialog?.mode === "form" ? (
            <RecordForm
              entity={dialog.entity}
              record={dialog.record}
              resources={data.resources}
              error={formError}
              saving={saving}
              onSave={save}
              onDelete={
                dialog.record
                  ? () => void remove(dialog.record!, dialog.entity)
                  : undefined
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function titleFor(section: Section) {
  return {
    home: "Panel de marketing",
    social: "Redes sociales",
    channels: "Canales de captación",
    ads: "Publicidad",
    bcc: "B.C.C. · Buscar, contactar, cobrar",
    affiliates: "Afiliados y referidos",
    crm: "Ventas y CRM",
  }[section];
}
function subtitleFor(section: Section) {
  return {
    home: "Planifica la atención, mide qué atrae oportunidades y pasa los contactos al CRM.",
    social:
      "Ideas, guiones, producción y resultados en un calendario operativo.",
    channels: "Dónde aparece NegoDigi y qué acción genera conversaciones.",
    ads: "Campañas, inversión y aprendizaje. Sin lanzar anuncios desde aquí.",
    bcc: "Una cola de prospección simple para convertir conversaciones en oportunidades.",
    affiliates:
      "Preparado para acuerdos de recomendación cuando decidas activarlos.",
    crm: "Pipeline claro, próximos pasos y visión comercial de una sola mirada.",
  }[section];
}
function formTitle(entity?: Entity) {
  return {
    content: "Nueva pieza de contenido",
    lead: "Nuevo contacto",
    channel: "Nuevo canal",
    campaign: "Nueva campaña",
    affiliate: "Nuevo afiliado",
    action: "Nueva acción del plan",
  }[entity || "lead"];
}

function Workspace({
  section,
  crmTab,
  setCrmTab,
  data,
  pipelineValue,
  wonValue,
  activeLeads,
  search,
  setSearch,
  stage,
  setStage,
  onGo,
  onOpen,
  currentSource,
}: {
  section: Section;
  crmTab: CrmTab;
  setCrmTab: (t: CrmTab) => void;
  data: MarketingData;
  pipelineValue: number;
  wonValue: number;
  activeLeads: MarketingRecord[];
  search: string;
  setSearch: (v: string) => void;
  stage: string;
  setStage: (v: string) => void;
  onGo: (s: Section) => void;
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
  currentSource: (id?: string) => string;
}) {
  if (section === "home")
    return (
      <MarketingHome
        data={data}
        activeLeads={activeLeads}
        pipelineValue={pipelineValue}
        onGo={onGo}
        onOpen={onOpen}
      />
    );
  if (section === "social") return <Social data={data} onOpen={onOpen} />;
  if (section === "channels")
    return (
      <Channels
        rows={data.resources.filter((r) => r.kind === "channel")}
        leads={data.leads}
        onOpen={onOpen}
      />
    );
  if (section === "ads")
    return (
      <Ads
        rows={data.resources.filter((r) => r.kind === "campaign")}
        leads={data.leads}
        onOpen={onOpen}
      />
    );
  if (section === "bcc")
    return (
      <Bcc
        leads={data.leads.filter((l) => info(l).method === "bcc")}
        onOpen={onOpen}
      />
    );
  if (section === "affiliates")
    return (
      <Affiliates
        rows={data.resources.filter((r) => r.kind === "affiliate")}
        onOpen={onOpen}
      />
    );
  return (
    <SalesCrm
      data={data}
      tab={crmTab}
      setTab={setCrmTab}
      search={search}
      setSearch={setSearch}
      stage={stage}
      setStage={setStage}
      onOpen={onOpen}
      currentSource={currentSource}
    />
  );
}

function MarketingHome({
  data,
  activeLeads,
  pipelineValue,
  onGo,
  onOpen,
}: {
  data: MarketingData;
  activeLeads: MarketingRecord[];
  pipelineValue: number;
  onGo: (s: Section) => void;
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  const scheduled = data.content.filter((r) =>
    ["recording", "editing", "scheduled"].includes(r.status || ""),
  ).length;
  const due = activeLeads.filter(
    (l) => info(l).next_action_on && info(l).next_action_on <= localDateKey(),
  );
  const cards: [Section, string, string, React.ElementType, string][] = [
    [
      "social",
      "Redes sociales",
      "Idea → guion → grabación → edición → publicación",
      Camera,
      "text-violet-300",
    ],
    [
      "channels",
      "Canales de captación",
      "Perfiles, comunidades, anuncios y páginas de servicio",
      Compass,
      "text-sky-300",
    ],
    [
      "ads",
      "Publicidad",
      "Campañas, inversión y coste por oportunidad",
      Megaphone,
      "text-amber-300",
    ],
    [
      "bcc",
      "B.C.C.",
      "Buscar, contactar, cobrar: la prospección diaria",
      MessagesSquare,
      "text-emerald-300",
    ],
    [
      "affiliates",
      "Afiliados",
      "Referidos y acuerdos de recomendación",
      Handshake,
      "text-rose-300",
    ],
  ];
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Oportunidades activas"
          value={String(activeLeads.length)}
          help="Contactos con un siguiente paso"
        />
        <Metric
          label="Seguimientos hoy"
          value={String(due.length)}
          help="Acciones que requieren atención"
          tone="text-amber-200"
        />
        <Metric
          label="Valor en pipeline"
          value={money(pipelineValue)}
          help="Propuestas y oportunidades abiertas"
          tone="text-violet-200"
        />
        <Metric
          label="Contenido en marcha"
          value={String(scheduled)}
          help="Grabación, edición o programado"
          tone="text-sky-200"
        />
      </section>
      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {cards.map(([id, title, description, Icon, color]) => (
          <button
            key={id}
            onClick={() => onGo(id)}
            className={`${panel} group min-h-48 p-6 text-left transition hover:-translate-y-0.5 hover:border-violet-400/50`}
          >
            <Icon className={color} size={25} />
            <h2 className="mt-7 text-xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {description}
            </p>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-blue-300">
              Abrir espacio <ArrowRight size={16} />
            </span>
          </button>
        ))}
      </section>
      <section className={`${panel} p-5 sm:p-6`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-300">
              Prioridad comercial
            </p>
            <h2 className="mt-2 text-lg font-semibold">Siguientes acciones</h2>
          </div>
          <Button variant="outline" onClick={() => onGo("crm")}>
            Abrir CRM
          </Button>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {due.slice(0, 3).map((lead) => (
            <button
              key={lead.id}
              onClick={() => onOpen("lead", lead)}
              className="rounded-xl border border-slate-700 bg-slate-950/25 p-4 text-left hover:border-blue-400/60"
            >
              <p className="font-medium">{lead.name}</p>
              <p className="mt-1 text-sm text-slate-400">
                {info(lead).next_action || "Sin acción registrada"}
              </p>
              <p className="mt-3 text-xs text-amber-300">
                {date(info(lead).next_action_on)}
              </p>
            </button>
          ))}
          {!due.length && <Empty>No hay seguimientos vencidos.</Empty>}
        </div>
      </section>
    </>
  );
}

function Social({
  data,
  onOpen,
}: {
  data: MarketingData;
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  const content = data.content;
  const published = content.filter((r) => r.status === "published");
  const views = published.reduce((sum, r) => sum + number(info(r).views), 0);
  const stages = [
    "idea",
    "script",
    "recording",
    "editing",
    "scheduled",
    "published",
  ];
  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Ideas en cartera"
          value={String(content.filter((r) => r.status === "idea").length)}
          help="Pendientes de validar"
        />
        <Metric
          label="En producción"
          value={String(
            content.filter((r) =>
              ["recording", "editing"].includes(r.status || ""),
            ).length,
          )}
          help="Grabación y edición"
          tone="text-amber-200"
        />
        <Metric
          label="Programado"
          value={String(content.filter((r) => r.status === "scheduled").length)}
          help="Listo para publicar"
          tone="text-sky-200"
        />
        <Metric
          label="Alcance medido"
          value={views.toLocaleString("es-ES")}
          help="Solo publicaciones medidas"
          tone="text-emerald-200"
        />
      </section>
      <section className={`${panel} overflow-hidden`}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 p-5 sm:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">
              Plan de contenido
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              De la idea a la publicación
            </h2>
          </div>
          <Button
            variant="outline"
            onClick={() => onOpen("content", undefined, "form")}
          >
            <Plus size={16} />
            Nueva idea
          </Button>
        </header>
        <div className="grid gap-3 overflow-x-auto p-4 lg:grid-cols-6">
          {stages.map((state) => (
            <div
              key={state}
              className="min-w-48 rounded-xl border border-slate-700/55 bg-slate-950/25 p-3"
            >
              <div className="mb-3 flex items-center justify-between">
                <Status state={state} label={contentLabel(state)} />
                <span className="text-xs text-slate-500">
                  {content.filter((r) => r.status === state).length}
                </span>
              </div>
              <div className="space-y-2">
                {content
                  .filter((r) => r.status === state)
                  .map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onOpen("content", item)}
                      className="w-full rounded-lg border border-slate-700/60 bg-slate-900 p-3 text-left hover:border-violet-400/60"
                    >
                      <p className="line-clamp-2 text-sm font-medium">
                        {item.title}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        {item.platform || "Sin plataforma"}
                      </p>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <EditorialCalendar records={content} onOpen={onOpen} />
      <section className={`${panel} p-5 sm:p-6`}>
        <div className="flex items-center gap-2">
          <BarChart3 className="text-emerald-300" size={19} />
          <h2 className="text-lg font-semibold">Resultados de publicaciones</h2>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={published.map((r) => ({
                  name: (r.title || "").slice(0, 18),
                  views: number(info(r).views),
                  clicks: number(info(r).clicks),
                }))}
              >
                <CartesianGrid stroke="#334155" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  interval={0}
                />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={chartTooltip} />
                <Bar dataKey="views" fill="#38bdf8" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3">
            {published.map((item) => (
              <button
                key={item.id}
                onClick={() => onOpen("content", item)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-700/60 px-4 py-3 text-left hover:border-blue-400/50"
              >
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-400">{item.platform}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-sky-200">
                    {number(info(item).views).toLocaleString("es-ES")}
                  </p>
                  <p className="text-xs text-slate-400">visualizaciones</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function EditorialCalendar({
  records,
  onOpen,
}: {
  records: MarketingRecord[];
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  const [month, setMonth] = React.useState("2026-09");
  const events = records
    .flatMap((record) =>
      [
        ["record_on", "Grabación", "bg-violet-500/15 text-violet-200"],
        ["edit_on", "Edición", "bg-amber-500/15 text-amber-200"],
        ["publish_on", "Publicación", "bg-sky-500/15 text-sky-200"],
      ].map(([key, label, style]) => ({
        record,
        date: info(record)[key],
        label,
        style,
      })),
    )
    .filter((e) => e.date?.startsWith(month));
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const offset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  return (
    <section className={`${panel} overflow-hidden`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <CalendarDays className="text-violet-300" size={19} />
          <div>
            <h2 className="text-lg font-semibold">Calendario de producción</h2>
            <p className="mt-1 text-sm text-slate-400">
              Grabación, edición y publicación en el mismo plan.
            </p>
          </div>
        </div>
        <Input
          aria-label="Mes de calendario"
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          className="w-44"
        />
      </header>
      <div className="hidden grid-cols-7 p-4 sm:grid">
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
          <div className="p-2 text-center text-xs text-slate-400" key={day}>
            {day}
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = String(i + 1).padStart(2, "0");
          const dayEvents = events.filter((e) => e.date === `${month}-${day}`);
          return (
            <div key={day} className="min-h-28 border border-slate-700/40 p-2">
              <p className="mb-2 text-xs text-slate-400">{i + 1}</p>
              {dayEvents.map((event) => (
                <button
                  key={`${event.record.id}-${event.label}`}
                  onClick={() => onOpen("content", event.record)}
                  className={`mb-1 w-full rounded px-2 py-1.5 text-left text-[11px] ${event.style}`}
                >
                  <span className="block truncate font-medium">
                    {event.record.title}
                  </span>
                  {event.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="space-y-2 p-4 sm:hidden">
        {events.map((event) => (
          <button
            key={`${event.record.id}-${event.label}`}
            onClick={() => onOpen("content", event.record)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-700 p-3 text-left"
          >
            <span>{event.record.title}</span>
            <span className="text-sm text-slate-400">
              {date(event.date)} · {event.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Channels({
  rows,
  leads,
  onOpen,
}: {
  rows: MarketingRecord[];
  leads: MarketingRecord[];
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  return (
    <section className={`${panel} overflow-hidden`}>
      <header className="flex items-center justify-between border-b border-slate-700/60 p-5 sm:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-sky-300">
            Captación orgánica y externa
          </p>
          <h2 className="mt-2 text-xl font-semibold">Canales de captación</h2>
        </div>
        <Button
          variant="outline"
          onClick={() => onOpen("channel", undefined, "form")}
        >
          <Plus size={16} />
          Canal
        </Button>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="bg-slate-950/25 text-xs uppercase tracking-[.1em] text-slate-400">
            <tr>
              {[
                "Canal",
                "Acción activa",
                "Visitas",
                "Conversaciones",
                "Leads",
                "Próximo paso",
                "Estado",
              ].map((h) => (
                <th className="px-5 py-4 font-medium" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const d = info(row);
              const related = leads.filter((l) => l.source_id === row.id);
              return (
                <tr
                  key={row.id}
                  className="border-t border-slate-700/55 hover:bg-slate-800/20"
                >
                  <td className="px-5 py-4">
                    <button
                      onClick={() => onOpen("channel", row)}
                      className="font-semibold hover:text-sky-300"
                    >
                      {row.name}
                    </button>
                    <p className="mt-1 text-xs text-slate-400">{d.platform}</p>
                  </td>
                  <td className="max-w-60 px-5 py-4 text-slate-300">
                    {d.action || "Sin acción"}
                  </td>
                  <td className="px-5 py-4">
                    {number(d.views).toLocaleString("es-ES")}
                  </td>
                  <td className="px-5 py-4">{number(d.conversations)}</td>
                  <td className="px-5 py-4">{related.length}</td>
                  <td className="px-5 py-4 text-slate-400">
                    {date(d.next_action_on)}
                  </td>
                  <td className="px-5 py-4">
                    <Status
                      state={row.status}
                      label={row.status === "active" ? "Activo" : "Preparación"}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Ads({
  rows,
  leads,
  onOpen,
}: {
  rows: MarketingRecord[];
  leads: MarketingRecord[];
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  const chart = rows.map((row) => ({
    name: (row.name || "").split("·")[0],
    gasto: number(info(row).spend),
    leads:
      leads.filter((l) => l.source_id === row.id).length ||
      number(info(row).leads),
  }));
  return (
    <div className="space-y-5">
      <section className="grid gap-4 md:grid-cols-3">
        <Metric
          label="Campañas activas"
          value={String(rows.filter((r) => r.status === "active").length)}
          help="Con inversión registrada"
        />
        <Metric
          label="Inversión registrada"
          value={money(rows.reduce((sum, r) => sum + number(info(r).spend), 0))}
          help="No crea gastos en Finanzas"
          tone="text-amber-200"
        />
        <Metric
          label="Coste por lead"
          value={money(
            chart.reduce((s, r) => s + r.gasto, 0) /
              Math.max(
                1,
                chart.reduce((s, r) => s + r.leads, 0),
              ),
          )}
          help="Solo muestra la medición de campañas"
          tone="text-sky-200"
        />
      </section>
      <section className={`${panel} p-5 sm:p-6`}>
        <h2 className="text-lg font-semibold">Inversión y oportunidades</h2>
        <p className="mt-1 text-sm text-slate-400">
          Compara gasto registrado y contactos atribuidos a cada campaña.
        </p>
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid stroke="#334155" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis yAxisId="money" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis
                yAxisId="count"
                orientation="right"
                tick={{ fill: "#94a3b8", fontSize: 12 }}
              />
              <Tooltip contentStyle={chartTooltip} />
              <Bar
                yAxisId="money"
                dataKey="gasto"
                name="Gasto (€)"
                fill="#fbbf24"
                radius={[5, 5, 0, 0]}
              />
              <Bar
                yAxisId="count"
                dataKey="leads"
                name="Leads"
                fill="#38bdf8"
                radius={[5, 5, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((row) => {
          const d = info(row);
          const sourceLeads = leads.filter((l) => l.source_id === row.id);
          const spend = number(d.spend);
          return (
            <article className={`${panel} p-5`} key={row.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <button
                    onClick={() => onOpen("campaign", row)}
                    className="text-left text-lg font-semibold hover:text-amber-300"
                  >
                    {row.name}
                  </button>
                  <p className="mt-1 text-sm text-slate-400">
                    {d.platform} · {d.objective}
                  </p>
                </div>
                <Status
                  state={row.status}
                  label={row.status === "active" ? "Activa" : "Pausada"}
                />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-slate-400">Gasto</p>
                  <p className="mt-1 font-semibold">{money(spend)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Leads</p>
                  <p className="mt-1 font-semibold">
                    {sourceLeads.length || number(d.leads)}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Coste/lead</p>
                  <p className="mt-1 font-semibold">
                    {money(
                      spend /
                        Math.max(1, sourceLeads.length || number(d.leads)),
                    )}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Bcc({
  leads,
  onOpen,
}: {
  leads: MarketingRecord[];
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  const stages = ["new", "contacted", "qualified", "proposal"];
  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-3">
        <Metric
          label="Por iniciar"
          value={String(leads.filter((l) => l.stage === "new").length)}
          help="Perfiles que investigar"
        />
        <Metric
          label="Conversaciones"
          value={String(leads.filter((l) => l.stage === "contacted").length)}
          help="Contacto ya iniciado"
          tone="text-sky-200"
        />
        <Metric
          label="Siguiente paso"
          value={String(leads.filter((l) => info(l).next_action_on).length)}
          help="No enviar mensajes automáticamente"
          tone="text-amber-200"
        />
      </section>
      <section className={`${panel} overflow-x-auto p-4`}>
        <div className="grid min-w-[850px] grid-cols-4 gap-4">
          {stages.map((state) => (
            <div className="rounded-xl bg-slate-950/30 p-3" key={state}>
              <div className="mb-3 flex items-center justify-between">
                <Status state={state} label={stageLabel(state)} />
                <span className="text-xs text-slate-400">
                  {leads.filter((l) => l.stage === state).length}
                </span>
              </div>
              <div className="space-y-3">
                {leads
                  .filter((l) => l.stage === state)
                  .map((lead) => (
                    <button
                      onClick={() => onOpen("lead", lead)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 p-4 text-left hover:border-emerald-400/55"
                      key={lead.id}
                    >
                      <p className="font-medium">{lead.name}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {lead.interest}
                      </p>
                      <p className="mt-3 text-xs text-emerald-300">
                        {info(lead).next_action || "Sin siguiente paso"}
                      </p>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Affiliates({
  rows,
  onOpen,
}: {
  rows: MarketingRecord[];
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <section className={`${panel} p-6`}>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-rose-300">
          Programa de referidos
        </p>
        <h2 className="mt-2 text-xl font-semibold">
          Acuerdos claros antes de automatizar
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
          Aquí se registran los acuerdos, no pagos automáticos. Un referido se
          convierte en oportunidad dentro del CRM cuando existe un contacto
          real.
        </p>
        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <button
              key={row.id}
              onClick={() => onOpen("affiliate", row)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-950/25 p-4 text-left hover:border-rose-400/50"
            >
              <div>
                <p className="font-medium">{row.name}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {info(row).terms || "Condiciones pendientes"}
                </p>
              </div>
              <Status
                state={row.status}
                label={row.status === "draft" ? "Borrador" : "Activo"}
              />
            </button>
          ))}
        </div>
      </section>
      <section className={`${panel} p-6`}>
        <Handshake size={27} className="text-rose-300" />
        <h2 className="mt-6 text-lg font-semibold">Flujo recomendado</h2>
        <ol className="mt-4 space-y-4 text-sm text-slate-300">
          <li>
            <b className="mr-2 text-rose-300">1.</b>Define la comisión y las
            condiciones.
          </li>
          <li>
            <b className="mr-2 text-rose-300">2.</b>Registra el contacto
            referido en CRM.
          </li>
          <li>
            <b className="mr-2 text-rose-300">3.</b>Marca el cierre solo cuando
            sea real.
          </li>
        </ol>
      </section>
    </div>
  );
}

function leadOrigin(
  lead: MarketingRecord,
  currentSource: (id?: string) => string,
) {
  const fromResource = lead.source_id ? currentSource(lead.source_id) : "";
  const imported = String(info(lead).notion_source || "").trim();
  return fromResource && fromResource !== "Sin origen"
    ? fromResource
    : imported || "Origen no informado";
}

function SalesCrm({
  data,
  tab,
  setTab,
  search,
  setSearch,
  stage,
  setStage,
  onOpen,
  currentSource,
}: {
  data: MarketingData;
  tab: CrmTab;
  setTab: (tab: CrmTab) => void;
  search: string;
  setSearch: (value: string) => void;
  stage: string;
  setStage: (value: string) => void;
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
  currentSource: (id?: string) => string;
}) {
  const openStages = ["new", "contacted", "negotiation", "proposal"];
  const prospects = data.leads.filter((lead) =>
    openStages.includes(lead.stage || ""),
  );
  const recurring = data.leads.filter((lead) => lead.stage === "active_client");
  const former = data.leads.filter((lead) => lead.stage === "past_client");
  const due = prospects.filter(
    (lead) => lead.next_action_on && lead.next_action_on <= localDateKey(),
  );
  const pipelineValue = prospects.reduce(
    (sum, lead) => sum + number(info(lead).deal_value),
    0,
  );
  const filtered = data.leads.filter((lead) => {
    const haystack =
      `${lead.name} ${lead.contact || ""} ${lead.interest || ""} ${leadOrigin(lead, currentSource)}`.toLowerCase();
    return (
      (!search || haystack.includes(search.toLowerCase())) &&
      (!stage || lead.stage === stage)
    );
  });
  const sourceData = Object.entries(
    data.leads.reduce<Record<string, number>>((all, lead) => {
      const source = leadOrigin(lead, currentSource) || "Sin origen";
      all[source] = (all[source] || 0) + 1;
      return all;
    }, {}),
  )
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const openPhase = (nextStage: string) => {
    setSearch("");
    setStage(nextStage);
    setTab(
      ["active_client", "past_client", "one_off_client"].includes(nextStage)
        ? "portfolio"
        : "contacts",
    );
  };
  return (
    <div className="space-y-5">
      <nav
        className={`${panel} flex flex-wrap gap-2 p-2`}
        aria-label="Vistas CRM"
      >
        {(
          [
            ["panel", "Resumen"],
            ["contacts", "Todos los contactos"],
            ["pipeline", "Embudo comercial"],
            ["portfolio", "Cartera y upsells"],
            ["analytics", "Analítica"],
          ] as [CrmTab, string][]
        ).map(([id, label]) => (
          <button
            type="button"
            onClick={() => {
              setTab(id);
              if (id === "portfolio") setStage("");
            }}
            key={id}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === id ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "panel" && (
        <CommercialDashboard
          leads={data.leads}
          resources={data.resources}
          due={due}
          prospects={prospects}
          recurring={recurring}
          former={former}
          pipelineValue={pipelineValue}
          onOpen={onOpen}
          onOpenPhase={openPhase}
        />
      )}
      {tab === "contacts" && (
        <SalesContacts
          leads={filtered}
          search={search}
          setSearch={setSearch}
          stage={stage}
          setStage={setStage}
          onOpen={onOpen}
          currentSource={currentSource}
        />
      )}
      {tab === "pipeline" && (
        <SalesPipeline leads={prospects} onOpen={onOpen} />
      )}
      {tab === "portfolio" && (
        <CommercialPortfolio
          leads={data.leads.filter((lead) =>
            ["active_client", "past_client", "one_off_client"].includes(
              lead.stage || "",
            ),
          )}
          stage={stage}
          setStage={setStage}
          onOpen={onOpen}
        />
      )}
      {tab === "analytics" && (
        <CommercialAnalytics
          leads={data.leads}
          prospects={prospects}
          recurring={recurring}
          former={former}
        />
      )}
    </div>
  );
}

function commercialValue(lead: MarketingRecord) {
  return number(info(lead).deal_value);
}
function CommercialDashboard({
  leads,
  resources,
  due,
  prospects,
  recurring,
  former,
  pipelineValue,
  onOpen,
  onOpenPhase,
}: {
  leads: MarketingRecord[];
  resources: MarketingRecord[];
  due: MarketingRecord[];
  prospects: MarketingRecord[];
  recurring: MarketingRecord[];
  former: MarketingRecord[];
  pipelineValue: number;
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
  onOpenPhase: (stage: string) => void;
}) {
  const stages = [
    ["new", "Nuevos leads"],
    ["contacted", "Contactados"],
    ["negotiation", "Negociación"],
    ["proposal", "Propuesta enviada"],
  ] as const;
  const totalValue = leads.reduce(
    (sum, lead) => sum + commercialValue(lead),
    0,
  );
  const recurringValue = recurring.reduce(
    (sum, lead) => sum + commercialValue(lead),
    0,
  );
  const priority = [
    ...due,
    ...prospects.filter(
      (lead) =>
        ["proposal", "negotiation"].includes(lead.stage || "") &&
        !due.some((item) => item.id === lead.id),
    ),
  ].slice(0, 5);
  const highPotential = prospects.filter(
    (lead) => String(info(lead).potential).toLowerCase() === "high",
  );
  const withoutContact = prospects.filter((lead) => !lead.contact).length;
  const withoutFollowUp = prospects.filter(
    (lead) => !lead.next_action_on,
  ).length;
  const upsells = leads.flatMap(upsellsFor);
  const openUpsells = upsells.filter(
    (item) => !["Aceptado", "Ganado", "Descartado"].includes(item.status),
  );
  const upsellValue = openUpsells.reduce(
    (sum, item) => sum + number(item.value),
    0,
  );
  const phaseData = stages.map(([id, label]) => ({
    id,
    label,
    count: leads.filter((lead) => lead.stage === id).length,
    value: leads
      .filter((lead) => lead.stage === id)
      .reduce((sum, lead) => sum + commercialValue(lead), 0),
  }));
  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label="Contactos totales"
          value={String(leads.length)}
          help="Base comercial completa"
        />
        <Metric
          label="Pipeline abierto"
          value={money(pipelineValue)}
          help={`${prospects.length} oportunidades en curso`}
          tone="text-violet-200"
        />
        <Metric
          label="Clientes recurrentes"
          value={String(recurring.length)}
          help={`${money(recurringValue)} estimados en cartera`}
          tone="text-emerald-200"
        />
        <Metric
          label="Reactivación posible"
          value={String(former.length)}
          help="Clientes anteriores, no descartados"
          tone="text-sky-200"
        />
        <Metric
          label="Upsells abiertos"
          value={money(upsellValue)}
          help={`${openUpsells.length} oportunidades de expansión`}
          tone="text-amber-200"
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <div className={`${panel} p-5 sm:p-6`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-300">
                Acción prioritaria
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                Qué requiere atención
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Fase, fecha y potencial
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {priority.map((lead) => (
              <button
                type="button"
                key={lead.id}
                onClick={() => onOpen("lead", lead)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950/25 p-4 text-left transition hover:border-blue-400/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{lead.name}</p>
                  <Status state={lead.stage} label={stageLabel(lead.stage)} />
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  {info(lead).next_action ||
                    lead.interest ||
                    "Sin siguiente acción registrada"}
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  <span
                    className={
                      lead.next_action_on &&
                      lead.next_action_on <= localDateKey()
                        ? "text-amber-300"
                        : "text-slate-400"
                    }
                  >
                    {lead.next_action_on
                      ? `Seguimiento: ${date(lead.next_action_on)}`
                      : "Sin fecha de seguimiento"}
                  </span>
                  <span className="text-violet-200">
                    {String(info(lead).potential || "Potencial sin informar")}
                  </span>
                </div>
              </button>
            ))}
            {!priority.length && (
              <Empty>
                No hay seguimientos vencidos ni negociaciones con acción
                pendiente.
              </Empty>
            )}
          </div>
        </div>
        <div className={`${panel} p-5 sm:p-6`}>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">
            Salud del seguimiento
          </p>
          <h2 className="mt-2 text-xl font-semibold">Señales para decidir</h2>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <MiniStat
              label="Seguimientos vencidos"
              value={String(due.length)}
            />
            <MiniStat
              label="Alto potencial abierto"
              value={String(highPotential.length)}
            />
            <MiniStat
              label="Sin fecha de seguimiento"
              value={String(withoutFollowUp)}
            />
            <MiniStat label="Sin contacto" value={String(withoutContact)} />
          </div>
          <div className="mt-5 space-y-3 border-t border-slate-700/60 pt-4 text-sm">
            <p className="flex justify-between gap-4">
              <span className="text-slate-400">Valor estimado documentado</span>
              <b>{money(totalValue)}</b>
            </p>
            <p className="flex justify-between gap-4">
              <span className="text-slate-400">Propuestas activas</span>
              <b>
                {prospects.filter((lead) => lead.stage === "proposal").length}
              </b>
            </p>
            <p className="flex justify-between gap-4">
              <span className="text-slate-400">Conversaciones iniciadas</span>
              <b>
                {
                  prospects.filter((lead) =>
                    ["contacted", "negotiation", "proposal"].includes(
                      lead.stage || "",
                    ),
                  ).length
                }
              </b>
            </p>
          </div>
        </div>
      </section>
      <CommercialPlanner
        leads={leads}
        actions={resources.filter((resource) => resource.kind === "action")}
        onOpen={onOpen}
      />
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Embudo comercial</h2>
            <p className="mt-1 text-sm text-slate-400">
              Solo fases de captación. La cartera de clientes se trabaja aparte
              en Cartera y upsells.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            Importe estimado, no cobrado
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {phaseData.map((phase) => (
            <button
              key={phase.id}
              type="button"
              onClick={() => onOpenPhase(phase.id)}
              disabled={!phase.count}
              className={`${panel} min-h-36 p-5 text-left transition enabled:hover:-translate-y-0.5 enabled:hover:border-blue-400/50 disabled:cursor-default`}
            >
              <Status state={phase.id} label={phase.label} />
              <p className="mt-5 text-3xl font-semibold">{phase.count}</p>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-400">Ver registros</span>
                <span className="font-medium text-violet-200">
                  {money(phase.value)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function CommercialPlanner({
  leads,
  actions,
  onOpen,
}: {
  leads: MarketingRecord[];
  actions: MarketingRecord[];
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  const [month, setMonth] = React.useState(localDateKey().slice(0, 7));
  const scheduled = [
    ...leads
      .filter((lead) => lead.next_action_on)
      .map((lead) => ({
        id: `lead-${lead.id}`,
        date: lead.next_action_on!,
        title: lead.name || "Contacto",
        subtitle: info(lead).next_action || "Seguimiento comercial",
        stage: lead.stage || "new",
        entity: "lead" as Entity,
        record: lead,
      })),
    ...leads.flatMap((lead) =>
      upsellsFor(lead)
        .filter((upsell) => upsell.next_action_on)
        .map((upsell) => ({
          id: `upsell-${lead.id}-${upsell.id}`,
          date: upsell.next_action_on,
          title: lead.name || "Cliente",
          subtitle: `Upsell · ${upsell.next_action || upsell.service || "Revisar oportunidad"}`,
          stage: lead.stage || "new",
          entity: "lead" as Entity,
          record: lead,
        })),
    ),
    ...actions
      .filter((action) => info(action).next_action_on)
      .map((action) => ({
        id: `action-${action.id}`,
        date: info(action).next_action_on!,
        title: action.name || "Acción",
        subtitle:
          info(action).action || info(action).next_action || "Plan de acción",
        stage: action.status || "active",
        entity: "action" as Entity,
        record: action,
      })),
  ]
    .filter((event) => event.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date));
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const offset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const styleFor = (stage: string) =>
    ({
      new: "border-slate-500/45 bg-slate-600/20 text-slate-200",
      contacted: "border-cyan-400/40 bg-cyan-500/10 text-cyan-100",
      negotiation: "border-violet-400/40 bg-violet-500/10 text-violet-100",
      proposal: "border-amber-400/40 bg-amber-500/10 text-amber-100",
      active: "border-blue-400/40 bg-blue-500/10 text-blue-100",
      draft: "border-slate-500/45 bg-slate-600/20 text-slate-200",
    })[stage] || "border-slate-700 bg-slate-950/25 text-slate-200";
  const actionRows = actions
    .filter((action) => action.status !== "paused")
    .sort((a, b) =>
      (info(a).next_action_on || "9999").localeCompare(
        info(b).next_action_on || "9999",
      ),
    );
  return (
    <section className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
      <div className={`${panel} p-5 sm:p-6`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-sky-300">
              Organización comercial
            </p>
            <h2 className="mt-2 text-xl font-semibold">Plan de acción</h2>
            <p className="mt-1 text-sm text-slate-400">
              Tareas que decides ejecutar, separadas de los seguimientos
              automáticos del CRM.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpen("action", undefined, "form")}
            className="rounded-lg border border-blue-400/40 px-3 py-2 text-sm font-medium text-blue-100 hover:bg-blue-500/10"
          >
            <Plus className="mr-1 inline" size={15} />
            Añadir
          </button>
        </div>
        <div className="mt-5 space-y-3">
          {actionRows.map((action) => (
            <button
              type="button"
              key={action.id}
              onClick={() => onOpen("action", action)}
              className="w-full rounded-xl border border-slate-700/60 bg-slate-950/25 p-4 text-left hover:border-blue-400/60"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">{action.name}</p>
                <Status
                  state={action.status}
                  label={
                    action.status === "active"
                      ? "En curso"
                      : action.status === "paused"
                        ? "En pausa"
                        : "Planificada"
                  }
                />
              </div>
              <p className="mt-2 text-sm text-slate-400">
                {info(action).action ||
                  info(action).next_action ||
                  info(action).offer ||
                  "Sin detalle"}
              </p>
              <p className="mt-3 text-xs text-sky-200">
                {info(action).next_action_on
                  ? `Programada: ${date(info(action).next_action_on)}`
                  : "Sin fecha programada"}
              </p>
            </button>
          ))}
          {!actionRows.length && (
            <Empty>
              Aún no hay acciones planificadas. Añade llamadas, revisiones de
              upsell o bloques de captación.
            </Empty>
          )}
        </div>
      </div>
      <div className={`${panel} overflow-hidden`}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <CalendarDays className="text-violet-300" size={19} />
            <div>
              <h2 className="text-lg font-semibold">Calendario comercial</h2>
              <p className="mt-1 text-sm text-slate-400">
                Seguimientos y acciones programadas por fecha.
              </p>
            </div>
          </div>
          <Input
            aria-label="Mes del calendario comercial"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="w-44"
          />
        </header>
        <div className="hidden grid-cols-7 p-4 sm:grid">
          {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => (
            <div key={day} className="p-2 text-center text-xs text-slate-400">
              {day}
            </div>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const day = String(i + 1).padStart(2, "0");
            const events = scheduled.filter(
              (event) => event.date === `${month}-${day}`,
            );
            return (
              <div
                key={day}
                className="min-h-28 border border-slate-700/40 p-2"
              >
                <p className="mb-2 text-xs text-slate-400">{i + 1}</p>
                {events.slice(0, 3).map((event) => (
                  <button
                    type="button"
                    key={event.id}
                    onClick={() => onOpen(event.entity, event.record)}
                    className={`mb-1 w-full rounded border px-2 py-1.5 text-left text-[11px] ${styleFor(event.stage)}`}
                  >
                    <span className="block truncate font-medium">
                      {event.title}
                    </span>
                    <span className="block truncate opacity-80">
                      {event.subtitle}
                    </span>
                  </button>
                ))}
                {events.length > 3 && (
                  <p className="px-1 text-[11px] text-slate-400">
                    +{events.length - 3} más
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="space-y-2 p-4 sm:hidden">
          {scheduled.map((event) => (
            <button
              type="button"
              key={event.id}
              onClick={() => onOpen(event.entity, event.record)}
              className={`w-full rounded-lg border p-3 text-left ${styleFor(event.stage)}`}
            >
              <p className="font-medium">{event.title}</p>
              <p className="mt-1 text-xs opacity-80">
                {date(event.date)} · {event.subtitle}
              </p>
            </button>
          ))}
          {!scheduled.length && (
            <Empty>No hay acciones ni seguimientos programados este mes.</Empty>
          )}
        </div>
      </div>
    </section>
  );
}

function CommercialAnalytics({
  leads,
  prospects,
  recurring,
  former,
}: {
  leads: MarketingRecord[];
  prospects: MarketingRecord[];
  recurring: MarketingRecord[];
  former: MarketingRecord[];
}) {
  const totalValue = leads.reduce(
    (sum, lead) => sum + commercialValue(lead),
    0,
  );
  const stageRows = leadStages
    .map(([id, label]) => ({
      name: label,
      contacts: leads.filter((lead) => lead.stage === id).length,
      value: leads
        .filter((lead) => lead.stage === id)
        .reduce((sum, lead) => sum + commercialValue(lead), 0),
    }))
    .filter((row) => row.contacts);
  const potentialRows = ["High", "Medium", "Low", "Sin informar"]
    .map((name) => ({
      name,
      value: leads.filter((lead) => {
        const potential = String(info(lead).potential || "").trim();
        return name === "Sin informar"
          ? !potential
          : potential.toLowerCase() === name.toLowerCase();
      }).length,
    }))
    .filter((row) => row.value);
  const upsells = leads.flatMap((lead) =>
    upsellsFor(lead).map((upsell) => ({ ...upsell, lead })),
  );
  const openUpsells = upsells.filter(
    (item) => !["Aceptado", "Ganado", "Descartado"].includes(item.status),
  );
  const wonUpsells = upsells.filter((item) =>
    ["Aceptado", "Ganado"].includes(item.status),
  );
  const followupsDue = prospects.filter(
    (lead) => lead.next_action_on && lead.next_action_on <= localDateKey(),
  );
  const withoutFollowUp = prospects.filter((lead) => !lead.next_action_on);
  return (
    <div className="space-y-5">
      <section>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">
            Analítica comercial
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            Qué compone la base y dónde actuar
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Lectura de registros reales. Los importes son estimados, no
            facturación cobrada.
          </p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Valor documentado"
            value={money(totalValue)}
            help={`${leads.filter((lead) => commercialValue(lead) > 0).length} registros con importe`}
          />
          <Metric
            label="Valor en oportunidades"
            value={money(
              prospects.reduce((sum, lead) => sum + commercialValue(lead), 0),
            )}
            help={`${prospects.length} fases abiertas`}
            tone="text-violet-200"
          />
          <Metric
            label="Cartera recurrente"
            value={money(
              recurring.reduce((sum, lead) => sum + commercialValue(lead), 0),
            )}
            help={`${recurring.length} clientes activos`}
            tone="text-emerald-200"
          />
          <Metric
            label="Histórico reactivable"
            value={money(
              former.reduce((sum, lead) => sum + commercialValue(lead), 0),
            )}
            help={`${former.length} contactos anteriores`}
            tone="text-sky-200"
          />
        </div>
      </section>
      <section className="grid gap-5 xl:grid-cols-2">
        <div className={`${panel} p-5 sm:p-6`}>
          <h2 className="text-lg font-semibold">Contactos por fase</h2>
          <p className="mt-1 text-sm text-slate-400">
            Distribución real entre prospección y cartera.
          </p>
          <div className="mt-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stageRows}
                layout="vertical"
                margin={{ left: 10, right: 12 }}
              >
                <CartesianGrid stroke="#334155" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={116}
                  tick={{ fill: "#cbd5e1", fontSize: 12 }}
                />
                <Tooltip contentStyle={chartTooltip} />
                <Bar
                  dataKey="contacts"
                  name="Contactos"
                  fill="#8b5cf6"
                  radius={[0, 6, 6, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={`${panel} p-5 sm:p-6`}>
          <h2 className="text-lg font-semibold">Valor estimado por fase</h2>
          <p className="mt-1 text-sm text-slate-400">
            Importe registrado; no equivale a cobro confirmado.
          </p>
          <div className="mt-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stageRows}
                layout="vertical"
                margin={{ left: 10, right: 12 }}
              >
                <CartesianGrid stroke="#334155" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={116}
                  tick={{ fill: "#cbd5e1", fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={chartTooltip}
                  formatter={(value) => money(number(value))}
                />
                <Bar
                  dataKey="value"
                  name="Valor estimado"
                  fill="#38bdf8"
                  radius={[0, 6, 6, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
      <section className="grid gap-5 xl:grid-cols-2">
        <div className={`${panel} p-5 sm:p-6`}>
          <h2 className="text-lg font-semibold">Seguimiento comercial</h2>
          <p className="mt-1 text-sm text-slate-400">
            Estado operativo del embudo: datos que requieren una acción.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <MiniStat
              label="Seguimientos vencidos"
              value={followupsDue.length}
            />
            <MiniStat
              label="Sin próxima fecha"
              value={withoutFollowUp.length}
            />
            <MiniStat
              label="En negociación"
              value={
                prospects.filter((lead) => lead.stage === "negotiation").length
              }
            />
            <MiniStat
              label="Propuestas enviadas"
              value={
                prospects.filter((lead) => lead.stage === "proposal").length
              }
            />
          </div>
          <div className="mt-5 border-t border-slate-700/60 pt-4 text-sm">
            <p className="flex justify-between gap-4">
              <span className="text-slate-400">
                Valor con seguimiento vencido
              </span>
              <b className="text-amber-200">
                {money(
                  followupsDue.reduce(
                    (sum, lead) => sum + commercialValue(lead),
                    0,
                  ),
                )}
              </b>
            </p>
            <p className="mt-3 flex justify-between gap-4">
              <span className="text-slate-400">Valor sin siguiente fecha</span>
              <b>
                {money(
                  withoutFollowUp.reduce(
                    (sum, lead) => sum + commercialValue(lead),
                    0,
                  ),
                )}
              </b>
            </p>
          </div>
        </div>
        <div className={`${panel} p-5 sm:p-6`}>
          <h2 className="text-lg font-semibold">Potencial comercial</h2>
          <p className="mt-1 text-sm text-slate-400">
            Clasificación existente; no es una predicción nueva.
          </p>
          {potentialRows.length ? (
            <>
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={potentialRows}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={82}
                      paddingAngle={3}
                    >
                      {potentialRows.map((_, index) => (
                        <Cell
                          key={index}
                          fill={colors[index % colors.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={chartTooltip} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-slate-300">
                {potentialRows.map((row, index) => (
                  <span key={row.name}>
                    <i
                      className="mr-1 inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: colors[index % colors.length] }}
                    />
                    {row.name} · {row.value}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <Empty>No hay potencial registrado.</Empty>
          )}
        </div>
      </section>
      <section className={`${panel} p-5 sm:p-6`}>
        <div className={`${panel} p-5 sm:p-6`}>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-300">
            Expansión de cartera
          </p>
          <h2 className="mt-2 text-lg font-semibold">
            Upsells y oportunidades
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <MiniStat
              label="Oportunidades abiertas"
              value={openUpsells.length}
            />
            <MiniStat
              label="Valor potencial"
              value={money(
                openUpsells.reduce((sum, item) => sum + number(item.value), 0),
              )}
            />
            <MiniStat label="Aceptadas / ganadas" value={wonUpsells.length} />
            <MiniStat
              label="Valor aceptado"
              value={money(
                wonUpsells.reduce((sum, item) => sum + number(item.value), 0),
              )}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function SalesDashboard({
  due,
  prospects,
  recurring,
  former,
  onOpen,
}: {
  due: MarketingRecord[];
  prospects: MarketingRecord[];
  recurring: MarketingRecord[];
  former: MarketingRecord[];
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  const priority = [
    ...due,
    ...prospects.filter(
      (lead) =>
        lead.stage === "proposal" && !due.some((item) => item.id === lead.id),
    ),
    ...prospects.filter(
      (lead) =>
        lead.stage === "negotiation" &&
        !due.some((item) => item.id === lead.id),
    ),
  ].slice(0, 5);
  const summary = [
    ["Nuevo lead", "new"],
    ["Contactado", "contacted"],
    ["Negociación", "negotiation"],
    ["Propuesta enviada", "proposal"],
  ] as const;
  return (
    <div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]">
      <section className={`${panel} p-5 sm:p-6`}>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-300">
          Atención comercial
        </p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Qué atender ahora</h2>
          <span className="text-xs text-slate-400">
            Basado en tus fechas y fases
          </span>
        </div>
        <div className="mt-5 space-y-3">
          {priority.map((lead) => (
            <button
              type="button"
              key={lead.id}
              onClick={() => onOpen("lead", lead)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950/25 p-4 text-left transition hover:border-blue-400/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{lead.name}</p>
                <Status state={lead.stage} label={stageLabel(lead.stage)} />
              </div>
              <p className="mt-2 text-sm text-slate-400">
                {info(lead).next_action ||
                  lead.interest ||
                  "Sin siguiente acción registrada"}
              </p>
              <p className="mt-3 text-xs text-amber-300">
                {lead.next_action_on
                  ? `Seguimiento: ${date(lead.next_action_on)}`
                  : "Sin fecha de seguimiento"}
              </p>
            </button>
          ))}
          {!priority.length && (
            <Empty>
              No hay oportunidades abiertas que requieran una acción registrada.
            </Empty>
          )}
        </div>
      </section>
      <section className={`${panel} p-5 sm:p-6`}>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">
          Lectura rápida
        </p>
        <h2 className="mt-2 text-xl font-semibold">Estado comercial</h2>
        <div className="mt-5 space-y-3">
          {summary.map(([label, state]) => (
            <div
              key={state}
              className="flex items-center justify-between rounded-xl border border-slate-700/70 bg-slate-950/25 px-4 py-3"
            >
              <Status state={state} label={label} />
              <span className="text-lg font-semibold">
                {prospects.filter((lead) => lead.stage === state).length}
              </span>
            </div>
          ))}
          <div className="mt-5 border-t border-slate-700/60 pt-4 text-sm">
            <p className="flex justify-between">
              <span className="text-slate-400">Clientes recurrentes</span>
              <b>{recurring.length}</b>
            </p>
            <p className="mt-2 flex justify-between">
              <span className="text-slate-400">Clientes anteriores</span>
              <b>{former.length}</b>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function SalesContacts({
  leads,
  search,
  setSearch,
  stage,
  setStage,
  onOpen,
  currentSource,
}: {
  leads: MarketingRecord[];
  search: string;
  setSearch: (value: string) => void;
  stage: string;
  setStage: (value: string) => void;
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
  currentSource: (id?: string) => string;
}) {
  return (
    <section className={`${panel} overflow-hidden`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/60 p-5">
        <div>
          <h2 className="text-lg font-semibold">Todos los contactos</h2>
          <p className="mt-1 text-sm text-slate-400">
            Abre o edita cualquier ficha para actualizar su fase y seguimiento.
          </p>
        </div>
        <span className="text-sm text-slate-400">{leads.length} registros</span>
      </header>
      <div className="flex flex-wrap gap-3 border-b border-slate-700/60 p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-3 text-slate-400" size={16} />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
            placeholder="Buscar nombre, contacto, servicio u origen"
          />
        </div>
        <select
          aria-label="Filtrar etapa"
          value={stage}
          onChange={(event) => setStage(event.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200"
        >
          <option value="">Todas las etapas</option>
          {leadStages.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full text-left text-sm">
          <thead className="bg-slate-950/25 text-xs uppercase tracking-[.1em] text-slate-400">
            <tr>
              {[
                "Contacto",
                "Interés",
                "Origen",
                "Etapa",
                "Valor",
                "Seguimiento",
                "",
              ].map((label) => (
                <th key={label} className="px-5 py-4 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                className="border-t border-slate-700/55 hover:bg-slate-800/20"
                key={lead.id}
              >
                <td className="px-5 py-4">
                  <button
                    type="button"
                    onClick={() => onOpen("lead", lead)}
                    className="font-semibold hover:text-blue-300"
                  >
                    {lead.name}
                  </button>
                  <p className="mt-1 text-xs text-slate-400">
                    {lead.contact || "Sin dato de contacto"}
                  </p>
                </td>
                <td className="px-5 py-4">{lead.interest || "—"}</td>
                <td className="px-5 py-4 text-slate-400">
                  {leadOrigin(lead, currentSource)}
                </td>
                <td className="px-5 py-4">
                  <Status state={lead.stage} label={stageLabel(lead.stage)} />
                </td>
                <td className="px-5 py-4">
                  {money(number(info(lead).deal_value))}
                </td>
                <td className="px-5 py-4">
                  <p>{info(lead).next_action || "—"}</p>
                  <p className="mt-1 text-xs text-amber-300">
                    {lead.next_action_on ? date(lead.next_action_on) : ""}
                  </p>
                </td>
                <td className="px-5 py-4 text-right">
                  <button
                    type="button"
                    onClick={() => onOpen("lead", lead, "form")}
                    className="rounded-lg border border-blue-400/30 px-3 py-2 text-xs font-medium text-blue-200 hover:bg-blue-500/10"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!leads.length && (
          <Empty>No hay contactos que coincidan con estos filtros.</Empty>
        )}
      </div>
    </section>
  );
}

function SalesPipeline({
  leads,
  onOpen,
}: {
  leads: MarketingRecord[];
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  const stages = ["new", "contacted", "negotiation", "proposal"];
  return (
    <section className={`${panel} overflow-x-auto p-4`}>
      <div className="mb-4 px-1">
        <h2 className="text-lg font-semibold">Embudo comercial</h2>
        <p className="mt-1 text-sm text-slate-400">
          Solo oportunidades abiertas. Los clientes activos e históricos
          permanecen en Todos los contactos.
        </p>
      </div>
      <div className="grid min-w-[900px] grid-cols-4 gap-4">
        {stages.map((state) => (
          <div
            className="rounded-xl border border-slate-700/60 bg-slate-950/25 p-3"
            key={state}
          >
            <div className="mb-3 flex items-center justify-between">
              <Status state={state} label={stageLabel(state)} />
              <span className="text-xs text-slate-400">
                {leads.filter((lead) => lead.stage === state).length}
              </span>
            </div>
            <div className="space-y-3">
              {leads
                .filter((lead) => lead.stage === state)
                .map((lead) => (
                  <button
                    type="button"
                    onClick={() => onOpen("lead", lead)}
                    key={lead.id}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 p-4 text-left hover:border-violet-400/60"
                  >
                    <p className="font-medium">{lead.name}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-400">
                      {lead.interest || "Sin servicio definido"}
                    </p>
                    <div className="mt-4 flex items-center justify-between text-xs">
                      <span className="text-slate-400">
                        {lead.next_action_on
                          ? date(lead.next_action_on)
                          : "Sin fecha"}
                      </span>
                      <span className="font-medium text-violet-200">
                        {money(number(info(lead).deal_value))}
                      </span>
                    </div>
                  </button>
                ))}
              {!leads.some((lead) => lead.stage === state) && (
                <p className="rounded-lg border border-dashed border-slate-700 px-3 py-5 text-center text-xs text-slate-500">
                  Sin contactos
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CommercialPortfolio({
  leads,
  stage,
  setStage,
  onOpen,
}: {
  leads: MarketingRecord[];
  stage: string;
  setStage: (value: string) => void;
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  const visible = stage ? leads.filter((lead) => lead.stage === stage) : leads;
  const active = visible.filter((lead) => lead.stage === "active_client");
  const former = visible.filter((lead) => lead.stage === "past_client");
  const oneOff = visible.filter((lead) => lead.stage === "one_off_client");
  const rows = [
    [
      "active_client",
      "Clientes recurrentes",
      active,
      "Cartera actual: renovaciones, mejoras y nuevos servicios.",
    ],
    [
      "past_client",
      "Clientes anteriores",
      former,
      "Reactivación: clientes que ya conocen el servicio.",
    ],
    [
      "one_off_client",
      "Clientes puntuales",
      oneOff,
      "Proyectos cerrados de una vez: oportunidad de una nueva necesidad.",
    ],
  ] as const;
  const allUpsells = visible.flatMap(upsellsFor);
  const open = allUpsells.filter(
    (item) => !["Aceptado", "Ganado", "Descartado"].includes(item.status),
  );
  return (
    <div className="space-y-5">
      <section className={`${panel} border-amber-400/20 p-5 sm:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-300">
              Expansión comercial
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              Cartera y oportunidades de upsell
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              No es un segundo CRM: son los mismos contactos cuando ya existe
              una relación. Aquí se decide qué mejora, renovación o servicio
              adicional proponer.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MiniStat
              label="Oportunidades abiertas"
              value={String(open.length)}
            />
            <MiniStat
              label="Valor potencial"
              value={money(
                open.reduce((sum, item) => sum + number(item.value), 0),
              )}
            />
          </div>
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStage("")}
          className={`rounded-xl border px-4 py-2 text-sm ${!stage ? "border-blue-400/50 bg-blue-500/15 text-blue-100" : "border-slate-700 text-slate-400 hover:bg-slate-800"}`}
        >
          Toda la cartera
        </button>
        {rows.map(([id, label]) => (
          <button
            type="button"
            key={id}
            onClick={() => setStage(id)}
            className={`rounded-xl border px-4 py-2 text-sm ${stage === id ? "border-blue-400/50 bg-blue-500/15 text-blue-100" : "border-slate-700 text-slate-400 hover:bg-slate-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="grid gap-4 xl:grid-cols-2">
        {rows
          .filter(([id]) => !stage || stage === id)
          .map(([id, label, customers, description]) => (
            <article className={`${panel} overflow-hidden`} key={id}>
              <header className="border-b border-slate-700/60 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Status state={id} label={label} />
                    <h3 className="mt-3 text-lg font-semibold">
                      {customers.length} contactos
                    </h3>
                    <p className="mt-1 text-sm text-slate-400">{description}</p>
                  </div>
                  <Sparkles className="text-amber-300" size={20} />
                </div>
              </header>
              <div className="divide-y divide-slate-700/55">
                {customers.map((customer) => {
                  const upsells = upsellsFor(customer);
                  const openCount = upsells.filter(
                    (item) =>
                      !["Aceptado", "Ganado", "Descartado"].includes(
                        item.status,
                      ),
                  ).length;
                  const potential = upsells
                    .filter((item) => !["Descartado"].includes(item.status))
                    .reduce((sum, item) => sum + number(item.value), 0);
                  return (
                    <button
                      type="button"
                      onClick={() => onOpen("lead", customer)}
                      key={customer.id}
                      className="flex w-full items-center justify-between gap-4 p-4 text-left transition hover:bg-slate-800/25"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {customer.name}
                        </p>
                        <p className="mt-1 truncate text-sm text-slate-400">
                          {info(customer).business_goal ||
                            customer.interest ||
                            "Objetivo comercial sin documentar"}
                        </p>
                        <p className="mt-2 text-xs text-amber-200">
                          {openCount
                            ? `${openCount} upsell${openCount === 1 ? "" : "s"} abierto${openCount === 1 ? "" : "s"}`
                            : "Sin upsell registrado"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-emerald-200">
                          {money(potential)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">potencial</p>
                      </div>
                    </button>
                  );
                })}
                {!customers.length && (
                  <Empty>No hay contactos en esta cartera.</Empty>
                )}
              </div>
            </article>
          ))}
      </section>
    </div>
  );
}

function Crm({
  data,
  activeLeads,
  pipelineValue,
  wonValue,
  tab,
  setTab,
  search,
  setSearch,
  stage,
  setStage,
  onOpen,
  currentSource,
}: {
  data: MarketingData;
  activeLeads: MarketingRecord[];
  pipelineValue: number;
  wonValue: number;
  tab: CrmTab;
  setTab: (tab: CrmTab) => void;
  search: string;
  setSearch: (value: string) => void;
  stage: string;
  setStage: (value: string) => void;
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
  currentSource: (id?: string) => string;
}) {
  const filtered = data.leads.filter((lead) => {
    const haystack =
      `${lead.name} ${lead.contact} ${lead.interest} ${sourceLabel(info(lead).method)} ${currentSource(lead.source_id)}`.toLowerCase();
    return (
      (!search || haystack.includes(search.toLowerCase())) &&
      (!stage || lead.stage === stage)
    );
  });
  const pipelineStages = ["new", "contacted", "qualified", "proposal", "won"];
  const sourceData = ["social", "channel", "campaign", "bcc"]
    .map((key) => ({
      name: sourceLabel(key),
      value: data.leads.filter((l) => info(l).method === key).length,
    }))
    .filter((row) => row.value);
  const trend = Object.values(
    data.leads.reduce<Record<string, { name: string; leads: number }>>(
      (all, lead) => {
        const day = lead.created_at?.slice(0, 10);
        if (day) all[day] = { name: day, leads: (all[day]?.leads || 0) + 1 };
        return all;
      },
      {},
    ),
  )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(-7);
  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Pipeline abierto"
          value={money(pipelineValue)}
          help={`${activeLeads.length} oportunidades activas`}
        />
        <Metric
          label="Propuestas vivas"
          value={String(
            data.leads.filter((l) => l.stage === "proposal").length,
          )}
          help="Decisiones por cerrar"
          tone="text-amber-200"
        />
        <Metric
          label="Clientes ganados"
          value={String(data.leads.filter((l) => l.stage === "won").length)}
          help={`Valor acordado: ${money(wonValue)}`}
          tone="text-emerald-200"
        />
        <Metric
          label="Conversión actual"
          value={`${Math.round((data.leads.filter((l) => l.stage === "won").length / Math.max(1, data.leads.filter((l) => !["lost", "do_not_contact"].includes(l.stage || "")).length)) * 100)}%`}
          help="Ganados sobre oportunidades"
          tone="text-violet-200"
        />
      </section>
      <nav
        className={`${panel} flex flex-wrap gap-2 p-2`}
        aria-label="Vistas CRM"
      >
        {(
          [
            ["panel", "Panel"],
            ["contacts", "Contactos"],
            ["pipeline", "Embudo"],
            ["analytics", "Analítica"],
          ] as [CrmTab, string][]
        ).map(([id, label]) => (
          <button
            onClick={() => setTab(id)}
            key={id}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === id ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "panel" && (
        <CrmDashboard leads={data.leads} trend={trend} onOpen={onOpen} />
      )}{" "}
      {tab === "contacts" && (
        <Contacts
          leads={filtered}
          search={search}
          setSearch={setSearch}
          stage={stage}
          setStage={setStage}
          onOpen={onOpen}
          currentSource={currentSource}
        />
      )}{" "}
      {tab === "pipeline" && (
        <Pipeline leads={data.leads} stages={pipelineStages} onOpen={onOpen} />
      )}{" "}
      {tab === "analytics" && (
        <Analytics sourceData={sourceData} leads={data.leads} />
      )}
    </div>
  );
}

function CrmDashboard({
  leads,
  trend,
  onOpen,
}: {
  leads: MarketingRecord[];
  trend: { name: string; leads: number }[];
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  const next = leads
    .filter((l) => info(l).next_action_on)
    .sort((a, b) =>
      (info(a).next_action_on || "").localeCompare(
        info(b).next_action_on || "",
      ),
    )
    .slice(0, 4);
  return (
    <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
      <section className={`${panel} p-5 sm:p-6`}>
        <div className="flex items-center gap-2">
          <Target className="text-blue-300" size={19} />
          <h2 className="text-lg font-semibold">Ritmo de captación</h2>
        </div>
        <div className="mt-5 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="leadGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity=".45" />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#334155" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
              />
              <Tooltip contentStyle={chartTooltip} />
              <Area
                type="monotone"
                dataKey="leads"
                name="Leads"
                stroke="#38bdf8"
                fill="url(#leadGradient)"
                strokeWidth={2.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className={`${panel} p-5 sm:p-6`}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Siguiente acción</h2>
          <span className="text-xs text-slate-400">Prioridad</span>
        </div>
        <div className="mt-4 space-y-3">
          {next.map((lead) => (
            <button
              key={lead.id}
              onClick={() => onOpen("lead", lead)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950/20 p-3 text-left hover:border-blue-400/60"
            >
              <div className="flex justify-between gap-3">
                <p className="font-medium">{lead.name}</p>
                <span className="text-xs text-amber-300">
                  {date(info(lead).next_action_on)}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-400">
                {info(lead).next_action}
              </p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Contacts({
  leads,
  search,
  setSearch,
  stage,
  setStage,
  onOpen,
  currentSource,
}: {
  leads: MarketingRecord[];
  search: string;
  setSearch: (v: string) => void;
  stage: string;
  setStage: (v: string) => void;
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
  currentSource: (id?: string) => string;
}) {
  return (
    <section className={`${panel} overflow-hidden`}>
      <div className="flex flex-wrap gap-3 border-b border-slate-700/60 p-4">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-3 text-slate-400" size={16} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            placeholder="Buscar contacto, servicio u origen"
          />
        </div>
        <select
          aria-label="Filtrar etapa"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200"
        >
          <option value="">Todas las etapas</option>
          {leadStages.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[820px] w-full text-left text-sm">
          <thead className="bg-slate-950/25 text-xs uppercase tracking-[.1em] text-slate-400">
            <tr>
              {[
                "Contacto",
                "Interés",
                "Origen",
                "Etapa",
                "Valor",
                "Próximo paso",
              ].map((h) => (
                <th key={h} className="px-5 py-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                className="border-t border-slate-700/55 hover:bg-slate-800/20"
                key={lead.id}
              >
                <td className="px-5 py-4">
                  <button
                    onClick={() => onOpen("lead", lead)}
                    className="font-semibold hover:text-blue-300"
                  >
                    {lead.name}
                  </button>
                  <p className="mt-1 text-xs text-slate-400">{lead.contact}</p>
                </td>
                <td className="px-5 py-4">{lead.interest || "—"}</td>
                <td className="px-5 py-4 text-slate-400">
                  {lead.source_id
                    ? currentSource(lead.source_id)
                    : sourceLabel(info(lead).method)}
                </td>
                <td className="px-5 py-4">
                  <Status state={lead.stage} label={stageLabel(lead.stage)} />
                </td>
                <td className="px-5 py-4">
                  {money(number(info(lead).deal_value))}
                </td>
                <td className="px-5 py-4">
                  <p>{info(lead).next_action || "—"}</p>
                  <p className="mt-1 text-xs text-amber-300">
                    {info(lead).next_action_on
                      ? date(info(lead).next_action_on)
                      : ""}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!leads.length && (
          <Empty>No hay contactos que coincidan con estos filtros.</Empty>
        )}
      </div>
    </section>
  );
}

function Pipeline({
  leads,
  stages,
  onOpen,
}: {
  leads: MarketingRecord[];
  stages: string[];
  onOpen: (e: Entity, r?: MarketingRecord, m?: "detail" | "form") => void;
}) {
  return (
    <section className={`${panel} overflow-x-auto p-4`}>
      <div className="grid min-w-[1100px] grid-cols-5 gap-4">
        {stages.map((state) => (
          <div className="rounded-xl bg-slate-950/25 p-3" key={state}>
            <div className="mb-3 flex items-center justify-between">
              <Status state={state} label={stageLabel(state)} />
              <span className="text-xs text-slate-400">
                {leads.filter((l) => l.stage === state).length}
              </span>
            </div>
            <div className="space-y-3">
              {leads
                .filter((l) => l.stage === state)
                .map((lead) => (
                  <button
                    onClick={() => onOpen("lead", lead)}
                    key={lead.id}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 p-4 text-left hover:border-violet-400/60"
                  >
                    <p className="font-medium">{lead.name}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      {lead.interest || "Sin interés"}
                    </p>
                    <div className="mt-4 flex items-center justify-between text-xs">
                      <span className="text-slate-400">
                        {info(lead).next_action_on
                          ? date(info(lead).next_action_on)
                          : "Sin fecha"}
                      </span>
                      <span className="font-medium text-violet-200">
                        {money(number(info(lead).deal_value))}
                      </span>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Analytics({
  sourceData,
  leads,
}: {
  sourceData: { name: string; value: number }[];
  leads: MarketingRecord[];
}) {
  const statusData = leadStages
    .map(([id, label]) => ({
      name: label,
      value: leads.filter((l) => l.stage === id).length,
    }))
    .filter((row) => row.value);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={`${panel} p-5 sm:p-6`}>
        <h2 className="text-lg font-semibold">Origen de oportunidades</h2>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={sourceData}
                dataKey="value"
                nameKey="name"
                innerRadius={65}
                outerRadius={100}
                paddingAngle={3}
              >
                {sourceData.map((_, index) => (
                  <Cell key={index} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={chartTooltip} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-slate-300">
          {sourceData.map((row, index) => (
            <span key={row.name}>
              <i
                className="mr-1 inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: colors[index % colors.length] }}
              />
              {row.name} · {row.value}
            </span>
          ))}
        </div>
      </section>
      <section className={`${panel} p-5 sm:p-6`}>
        <h2 className="text-lg font-semibold">Estado del pipeline</h2>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={statusData} layout="vertical">
              <CartesianGrid stroke="#334155" horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={102}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
              />
              <Tooltip contentStyle={chartTooltip} />
              <Bar
                dataKey="value"
                name="Contactos"
                fill="#8b5cf6"
                radius={[0, 5, 5, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function LeadWorkspace({
  record,
  mode,
  resources,
  error,
  saving,
  onBack,
  onEdit,
  onSave,
  onDelete,
}: {
  record?: MarketingRecord;
  mode: "detail" | "form";
  resources: MarketingRecord[];
  error: string;
  saving: boolean;
  onBack: () => void;
  onEdit: () => void;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
}) {
  if (mode === "form")
    return (
      <>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft size={16} />
          Volver a Ventas y CRM
        </button>
        <header className={`${panel} p-5 sm:p-6`}>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">
            Ficha comercial
          </p>
          <h1 className="mt-2 text-3xl font-semibold">
            {record ? `Editar ${record.name}` : "Nuevo contacto"}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Toda la información comercial, seguimiento y cartera se mantiene en
            una sola ficha.
          </p>
        </header>
        <section className={`${panel} p-5 sm:p-6`}>
          <RecordForm
            entity="lead"
            record={record}
            resources={resources}
            error={error}
            saving={saving}
            onSave={onSave}
            onDelete={onDelete}
          />
        </section>
      </>
    );
  if (!record) return null;
  const d = info(record);
  const goals = goalsFor(record);
  const problems = pairsFor(record, "problems");
  const objections = pairsFor(record, "objections");
  const upsells = upsellsFor(record);
  const openUpsells = upsells.filter(
    (item) => !["Aceptado", "Ganado", "Descartado"].includes(item.status),
  );
  const wonUpsells = upsells.filter((item) =>
    ["Aceptado", "Ganado"].includes(item.status),
  );
  const isPortfolio = [
    "active_client",
    "past_client",
    "one_off_client",
  ].includes(record.stage || "");
  const score = closingScore(record);
  const scoreLabel = isPortfolio
    ? "Prioridad de expansión"
    : "Probabilidad de cierre";
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft size={16} />
        Volver a Ventas y CRM
      </button>
      <header className={`${panel} border-blue-400/25 p-5 sm:p-7`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-violet-300">
                Ficha comercial
              </p>
              <Status state={record.stage} label={stageLabel(record.stage)} />
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {record.name}
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              {record.contact || "Contacto pendiente"} ·{" "}
              {record.interest || "Servicio por definir"}
            </p>
          </div>
          <Button onClick={onEdit}>Editar ficha</Button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MiniStat label={scoreLabel} value={`${score}/100`} />
          <MiniStat label="Valor actual" value={money(number(d.deal_value))} />
          <MiniStat
            label="Upsells abiertos"
            value={String(openUpsells.length)}
          />
          <MiniStat
            label="Valor potencial"
            value={money(
              openUpsells.reduce((sum, item) => sum + number(item.value), 0),
            )}
          />
        </div>
        <p className="mt-4 text-xs text-slate-500">
          {scoreLabel} calculada con fase, potencial, temperatura, seguimiento y
          valor documentado. Es una guía de priorización, no un cierre
          confirmado.
        </p>
      </header>
      <section className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <article className={`${panel} p-5 sm:p-6`}>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-sky-300">
            Contacto y seguimiento
          </p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <InfoCell label="Contacto" value={record.contact} />
            <InfoCell
              label="Origen"
              value={d.notion_source || "No informado"}
            />
            <InfoCell label="Servicio de interés" value={record.interest} />
            <InfoCell label="Próxima acción" value={d.next_action} />
            <InfoCell
              label="Seguimiento"
              value={
                record.next_action_on ? date(record.next_action_on) : undefined
              }
            />
            <InfoCell
              label="Renovación"
              value={d.renewal_on ? date(d.renewal_on) : undefined}
            />
            <InfoCell label="Método de pago" value={d.payment_method} />
            <InfoCell
              label="Temperatura / potencial"
              value={[d.temperature, d.potential].filter(Boolean).join(" · ")}
            />
          </dl>
        </article>
        <article className={`${panel} p-5 sm:p-6`}>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-300">
            Estrategia comercial
          </p>
          <h2 className="mt-2 text-lg font-semibold">
            Qué necesita y cómo avanzar
          </h2>
          <div className="mt-5 grid gap-4">
            <section>
              <h3 className="text-sm font-semibold">Objetivos del cliente</h3>
              {goals.length ? (
                <ol className="mt-3 grid gap-2">
                  {goals.map((goal, index) => (
                    <li
                      key={`${index}-${goal}`}
                      className="rounded-xl border border-slate-700/60 bg-slate-950/25 px-4 py-3 text-sm"
                    >
                      <span className="mr-2 font-semibold text-emerald-300">
                        {index + 1}.
                      </span>
                      {goal}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  Aún no hay objetivos documentados.
                </p>
              )}
            </section>
            <PairList
              title="Problemas y solución propuesta"
              pairs={problems}
              empty="Aún no hay problemas documentados."
              issueLabel="Problema"
              responseLabel="Solución / propuesta"
            />
            <PairList
              title="Objeciones y respuesta"
              pairs={objections}
              empty="Aún no hay objeciones documentadas."
              issueLabel="Objeción"
              responseLabel="Cómo responder / qué ofrecer"
            />
          </div>
        </article>
      </section>
      <section className={`${panel} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-300">
              Cartera y upsells
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              Oportunidades de expansión
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Analiza, propone y hace seguimiento sin crear otro registro del
              cliente.
            </p>
          </div>
          <div className="flex gap-3">
            <MiniStat label="Abiertas" value={openUpsells.length} />
            <MiniStat label="Aceptadas" value={wonUpsells.length} />
          </div>
        </div>
        {upsells.length ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {upsells.map((item) => (
              <article
                key={item.id}
                className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {item.service || "Servicio por definir"}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      {item.reason || "Sin motivo documentado"}
                    </p>
                  </div>
                  <span className="font-semibold text-emerald-200">
                    {money(number(item.value))}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-amber-400/25 px-2.5 py-1 text-amber-100">
                    {item.status || "Analizar caso"}
                  </span>
                  <span className="rounded-full border border-slate-600 px-2.5 py-1 text-slate-300">
                    Probabilidad {item.probability || "sin informar"}
                  </span>
                  {item.next_action && (
                    <span className="rounded-full border border-sky-400/25 px-2.5 py-1 text-sky-100">
                      {item.next_action}
                      {item.next_action_on
                        ? ` · ${date(item.next_action_on)}`
                        : ""}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty>
            No hay upsells registrados. Añade uno desde Editar ficha cuando
            detectes una oportunidad.
          </Empty>
        )}
      </section>
      <section className={`${panel} p-5 sm:p-6`}>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-slate-400">
          Notas internas
        </p>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
          {d.notes || "Sin notas internas."}
        </p>
      </section>
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-2 rounded-lg border border-rose-400/35 px-3 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/10"
        >
          <Trash2 size={16} />
          Eliminar contacto
        </button>
        <Button onClick={onEdit}>Editar ficha</Button>
      </div>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-950/25 p-4">
      <p className="text-xs font-semibold uppercase tracking-[.11em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
        {value || "Sin informar"}
      </p>
    </div>
  );
}
function PairList({
  title,
  pairs,
  empty,
  issueLabel,
  responseLabel,
}: {
  title: string;
  pairs: CommercialPair[];
  empty: string;
  issueLabel: string;
  responseLabel: string;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      {pairs.length ? (
        <div className="mt-3 space-y-3">
          {pairs.map((pair) => (
            <div
              key={pair.id}
              className="grid gap-3 rounded-xl border border-slate-700/60 bg-slate-950/25 p-4 sm:grid-cols-2"
            >
              <div>
                <p className="text-xs font-medium uppercase tracking-[.1em] text-slate-400">
                  {issueLabel}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {pair.issue || "Sin detalle"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[.1em] text-emerald-300">
                  {responseLabel}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {pair.response || "Pendiente de definir"}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">{empty}</p>
      )}
    </section>
  );
}

function Detail({
  record,
  entity,
  sourceName,
  onEdit,
  onDelete,
}: {
  record: MarketingRecord;
  entity: Entity;
  sourceName: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const d = info(record);
  const upsells = entity === "lead" ? upsellsFor(record) : [];
  const values: [string, string | undefined][] =
    entity === "lead"
      ? [
          ["Contacto", record.contact],
          ["Servicio de interés", record.interest],
          ["Origen", sourceName],
          ["Etapa", stageLabel(record.stage)],
          ["Valor de oportunidad", money(number(d.deal_value))],
          ["Objetivo", d.business_goal],
          ["Problemas detectados", d.detected_problems],
          ["Objeciones", d.objections],
          ["Renovación", d.renewal_on ? date(d.renewal_on) : undefined],
          ["Método de pago", d.payment_method],
          ["Próxima acción", d.next_action],
          [
            "Fecha de seguimiento",
            d.next_action_on ? date(d.next_action_on) : undefined,
          ],
          ["Notas", d.notes],
        ]
      : entity === "content"
        ? [
            ["Plataforma", record.platform],
            ["Estado", contentLabel(record.status)],
            ["Formato", d.format],
            ["Gancho", d.hook],
            ["Guion", d.script],
            ["Grabación", d.record_on ? date(d.record_on) : undefined],
            ["Edición", d.edit_on ? date(d.edit_on) : undefined],
            ["Publicación", d.publish_on ? date(d.publish_on) : undefined],
            ["CTA", d.cta],
          ]
        : [
            ["Estado", record.status === "active" ? "Activo" : "Preparación"],
            ["Plataforma", d.platform],
            ["Oferta / objetivo", d.offer || d.objective],
            ["Acción", d.action || d.creative],
            [
              "Próxima revisión",
              d.next_action_on ? date(d.next_action_on) : undefined,
            ],
            ["Notas", d.notes],
          ];
  return (
    <div className="space-y-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        {values
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div
              className="rounded-xl border border-slate-700/60 bg-slate-950/25 p-4"
              key={label}
            >
              <dt className="text-xs font-semibold uppercase tracking-[.11em] text-slate-400">
                {label}
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                {value}
              </dd>
            </div>
          ))}
      </dl>
      {entity === "lead" && upsells.length > 0 && (
        <section className="rounded-xl border border-amber-400/25 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2">
            <Sparkles size={17} className="text-amber-300" />
            <h3 className="font-semibold">Upsells detectados</h3>
          </div>
          <div className="mt-4 space-y-3">
            {upsells.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-slate-700/60 bg-slate-950/25 p-3"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-medium">
                    {item.service || "Servicio pendiente de definir"}
                  </p>
                  <span className="text-sm font-semibold text-emerald-200">
                    {money(number(item.value))}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  {item.reason || "Sin motivo registrado"}
                </p>
                <p className="mt-2 text-xs text-amber-200">
                  {item.probability || "Probabilidad sin informar"} ·{" "}
                  {item.status || "Pendiente"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="flex flex-wrap justify-between gap-3">
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-2 rounded-lg border border-rose-400/35 px-3 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/10"
        >
          <Trash2 size={16} />
          Eliminar
        </button>
        <Button onClick={onEdit}>Editar</Button>
      </div>
    </div>
  );
}

function GoalsEditor({
  value,
  fallback,
}: {
  value?: string;
  fallback?: string;
}) {
  const [goals, setGoals] = React.useState<string[]>(() =>
    parseGoals(value, fallback),
  );
  const update = (index: number, next: string) =>
    setGoals((rows) => rows.map((goal, i) => (i === index ? next : goal)));
  return (
    <section className="space-y-3 border-t border-slate-700/60 pt-5 sm:col-span-2">
      <input
        type="hidden"
        name="business_goals_json"
        value={JSON.stringify(goals.filter(Boolean))}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Objetivos del cliente</p>
          <p className="mt-1 text-xs text-slate-400">
            Guárdalos uno por uno para poder convertirlos en una propuesta
            concreta.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setGoals((rows) => [...rows, ""])}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/40 px-3 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/10"
        >
          <Plus size={15} />
          Añadir objetivo
        </button>
      </div>
      {goals.map((goal, index) => (
        <div className="flex gap-2" key={`${index}-${goal}`}>
          <Input
            value={goal}
            onChange={(event) => update(index, event.target.value)}
            placeholder="Ej. aumentar alcance, vender un servicio…"
          />
          <button
            type="button"
            onClick={() =>
              setGoals((rows) => rows.filter((_, i) => i !== index))
            }
            className="shrink-0 rounded-lg border border-rose-400/35 px-3 text-rose-200 hover:bg-rose-500/10"
            aria-label="Quitar objetivo"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </section>
  );
}

function PairsEditor({
  name,
  title,
  issueLabel,
  responseLabel,
  value,
  fallback,
}: {
  name: string;
  title: string;
  issueLabel: string;
  responseLabel: string;
  value?: string;
  fallback?: string;
}) {
  const [items, setItems] = React.useState<CommercialPair[]>(() =>
    parsePairs(value, fallback),
  );
  const patch = (id: string, key: "issue" | "response", next: string) =>
    setItems((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [key]: next } : row)),
    );
  return (
    <section className="space-y-3 border-t border-slate-700/60 pt-5 sm:col-span-2">
      <input type="hidden" name={name} value={JSON.stringify(items)} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs text-slate-400">
            Define el caso y la respuesta para que la siguiente conversación sea
            clara.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setItems((rows) => [
              ...rows,
              { id: crypto.randomUUID(), issue: "", response: "" },
            ])
          }
          className="inline-flex items-center gap-2 rounded-lg border border-sky-400/40 px-3 py-2 text-sm font-medium text-sky-100 hover:bg-sky-500/10"
        >
          <Plus size={15} />
          Añadir
        </button>
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className="grid gap-3 rounded-xl border border-slate-700/60 bg-slate-950/25 p-4 sm:grid-cols-2"
        >
          <label className="space-y-1.5 text-xs">
            <span>{issueLabel}</span>
            <Textarea
              rows={2}
              value={item.issue}
              onChange={(event) => patch(item.id, "issue", event.target.value)}
              placeholder="Describe el caso"
            />
          </label>
          <label className="space-y-1.5 text-xs">
            <span>{responseLabel}</span>
            <Textarea
              rows={2}
              value={item.response}
              onChange={(event) =>
                patch(item.id, "response", event.target.value)
              }
              placeholder="Cómo abordarlo"
            />
          </label>
          <button
            type="button"
            onClick={() =>
              setItems((rows) => rows.filter((row) => row.id !== item.id))
            }
            className="text-left text-xs font-medium text-rose-200 hover:text-rose-100 sm:col-span-2"
          >
            <Trash2 className="mr-1 inline" size={13} />
            Quitar
          </button>
        </div>
      ))}
    </section>
  );
}

function UpsellsEditor({ value }: { value?: string }) {
  const [items, setItems] = React.useState<Upsell[]>(() => parseUpsells(value));
  const patch = (id: string, key: keyof Upsell, value: string) =>
    setItems((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  return (
    <section className="space-y-3 border-t border-slate-700/60 pt-5 sm:col-span-2">
      <input type="hidden" name="upsells_json" value={JSON.stringify(items)} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Upsells y oportunidades</p>
          <p className="mt-1 text-xs text-slate-400">
            Registra propuestas de expansión, mejora o reactivación. No modifica
            cobros ni Finanzas.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            setItems((rows) => [
              ...rows,
              {
                id: crypto.randomUUID(),
                service: "",
                reason: "",
                probability: "Media",
                value: "",
                status: "Analizar caso",
                next_action: "",
                next_action_on: "",
              },
            ])
          }
          className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/10"
        >
          <Plus size={15} />
          Añadir upsell
        </button>
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs">
              <span>Servicio</span>
              <Input
                value={item.service}
                onChange={(event) =>
                  patch(item.id, "service", event.target.value)
                }
                placeholder="Automatización, pack, informes…"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span>Precio potencial (€)</span>
              <Input
                type="number"
                value={item.value}
                onChange={(event) =>
                  patch(item.id, "value", event.target.value)
                }
                placeholder="0"
              />
            </label>
            <label className="space-y-1.5 text-xs sm:col-span-2">
              <span>Motivo para proponerlo</span>
              <Input
                value={item.reason}
                onChange={(event) =>
                  patch(item.id, "reason", event.target.value)
                }
                placeholder="Qué necesidad resuelve o por qué le conviene"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span>Probabilidad</span>
              <select
                value={item.probability}
                onChange={(event) =>
                  patch(item.id, "probability", event.target.value)
                }
                className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
              >
                <option>Alta</option>
                <option>Media</option>
                <option>Baja</option>
              </select>
            </label>
            <label className="space-y-1.5 text-xs">
              <span>Estado</span>
              <select
                value={item.status}
                onChange={(event) =>
                  patch(item.id, "status", event.target.value)
                }
                className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm"
              >
                <option>Analizar caso</option>
                <option>Listo para proponer</option>
                <option>Propuesto</option>
                <option>Negociando</option>
                <option>Objeción</option>
                <option>Aceptado</option>
                <option>Descartado</option>
              </select>
            </label>
            <label className="space-y-1.5 text-xs">
              <span>Próxima acción</span>
              <Input
                value={item.next_action}
                onChange={(event) =>
                  patch(item.id, "next_action", event.target.value)
                }
                placeholder="Enviar propuesta…"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span>Fecha</span>
              <Input
                type="date"
                value={item.next_action_on}
                onChange={(event) =>
                  patch(item.id, "next_action_on", event.target.value)
                }
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() =>
              setItems((rows) => rows.filter((row) => row.id !== item.id))
            }
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-rose-200 hover:text-rose-100"
          >
            <Trash2 size={13} />
            Quitar upsell
          </button>
        </div>
      ))}
    </section>
  );
}

function RecordForm({
  entity,
  record,
  resources,
  error,
  saving,
  onSave,
  onDelete,
}: {
  entity: Entity;
  record?: MarketingRecord;
  resources: MarketingRecord[];
  error: string;
  saving: boolean;
  onSave: (event: React.FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
}) {
  const d = info(record);
  const field = (
    name: string,
    placeholder: string,
    type = "text",
    value?: string,
  ) => (
    <Input
      name={name}
      type={type}
      defaultValue={value || ""}
      placeholder={placeholder}
    />
  );
  return (
    <form onSubmit={onSave} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>Nombre *</span>
          {field(
            "name",
            entity === "lead" ? "Nombre o empresa" : "Nombre",
            "text",
            record?.name || record?.title,
          )}
        </label>
        {entity === "content" && (
          <>
            <label className="space-y-2 text-sm">
              <span>Estado</span>
              <select
                name="status"
                defaultValue={record?.status || "idea"}
                className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3"
              >
                {contentStages.map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>Red social</span>
              {field(
                "platform",
                "Instagram, TikTok…",
                "text",
                record?.platform || d.platform,
              )}
            </label>
            <label className="space-y-2 text-sm">
              <span>Formato</span>
              {field("format", "Reel, post, carrusel…", "text", d.format)}
            </label>
            <label className="space-y-2 text-sm">
              <span>Pilar</span>
              {field("pillar", "Educación, prueba social…", "text", d.pillar)}
            </label>
            <label className="space-y-2 text-sm">
              <span>Grabación</span>
              {field("record_on", "", "date", d.record_on)}
            </label>
            <label className="space-y-2 text-sm">
              <span>Edición</span>
              {field("edit_on", "", "date", d.edit_on)}
            </label>
            <label className="space-y-2 text-sm">
              <span>Publicación</span>
              {field(
                "publish_on",
                "",
                "date",
                record?.publish_on || d.publish_on,
              )}
            </label>
            <label className="space-y-2 text-sm">
              <span>Gancho</span>
              {field("hook", "Primera frase", "text", d.hook)}
            </label>
            <label className="space-y-2 text-sm sm:col-span-2">
              <span>Guion / estructura</span>
              <Textarea
                name="script"
                rows={4}
                defaultValue={d.script || ""}
                placeholder="Idea, estructura y CTA"
              />
            </label>
          </>
        )}
        {entity === "lead" && (
          <>
            <label className="space-y-2 text-sm">
              <span>Contacto *</span>
              {field(
                "contact",
                "Email, teléfono o perfil",
                "text",
                record?.contact || d.contact,
              )}
            </label>
            <label className="space-y-2 text-sm">
              <span>Etapa</span>
              <select
                name="status"
                defaultValue={record?.stage || "new"}
                className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3"
              >
                {leadStages.map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>Servicio de interés</span>
              {field(
                "interest",
                "Servicio o necesidad",
                "text",
                record?.interest || d.interest,
              )}
            </label>
            <label className="space-y-2 text-sm">
              <span>Origen</span>
              <select
                name="source_id"
                defaultValue={record?.source_id || ""}
                className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3"
              >
                <option value="">Sin origen</option>
                {resources
                  .filter((r) =>
                    ["channel", "campaign", "affiliate"].includes(r.kind || ""),
                  )
                  .map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>Valor de oportunidad (€)</span>
              {field("deal_value", "", "number", d.deal_value)}
            </label>
            <label className="space-y-2 text-sm">
              <span>Potencial</span>
              <select
                name="potential"
                defaultValue={d.potential || ""}
                className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3"
              >
                <option value="">Sin informar</option>
                <option value="High">Alto</option>
                <option value="Medium">Medio</option>
                <option value="Low">Bajo</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>Temperatura</span>
              <select
                name="temperature"
                defaultValue={d.temperature || ""}
                className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3"
              >
                <option value="">Sin informar</option>
                <option value="HOT">HOT</option>
                <option value="MEDIUM">MEDIA</option>
                <option value="COLD">FRÍA</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>Próximo seguimiento</span>
              {field(
                "next_action_on",
                "",
                "date",
                record?.next_action_on || d.next_action_on,
              )}
            </label>
            <label className="space-y-2 text-sm sm:col-span-2">
              <span>Siguiente acción</span>
              {field(
                "next_action",
                "Qué hay que hacer ahora",
                "text",
                d.next_action,
              )}
            </label>
            <section className="grid gap-4 border-t border-slate-700/60 pt-5 sm:col-span-2 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p className="text-sm font-semibold">Información comercial</p>
                <p className="mt-1 text-xs text-slate-400">
                  Contexto que permite vender mejor y detectar una propuesta
                  útil.
                </p>
              </div>
              <GoalsEditor
                value={d.business_goals_json}
                fallback={d.business_goal}
              />
              <PairsEditor
                name="problems_json"
                title="Problemas y solución"
                issueLabel="Problema detectado"
                responseLabel="Solución / propuesta"
                value={d.problems_json}
                fallback={d.detected_problems}
              />
              <PairsEditor
                name="objections_json"
                title="Objeciones y respuesta"
                issueLabel="Objeción"
                responseLabel="Cómo responder / qué ofrecer"
                value={d.objections_json}
                fallback={d.objections}
              />
              <label className="space-y-2 text-sm">
                <span>Fecha de renovación</span>
                {field("renewal_on", "", "date", d.renewal_on)}
              </label>
              <label className="space-y-2 text-sm">
                <span>Método de pago</span>
                {field(
                  "payment_method",
                  "Wise, transferencia…",
                  "text",
                  d.payment_method,
                )}
              </label>
            </section>
            <UpsellsEditor value={d.upsells} />
          </>
        )}
        {["channel", "campaign", "affiliate", "action"].includes(entity) && (
          <>
            <label className="space-y-2 text-sm">
              <span>Estado</span>
              <select
                name="status"
                defaultValue={record?.status || "draft"}
                className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3"
              >
                <option value="draft">Preparación</option>
                <option value="active">Activo</option>
                <option value="paused">Pausado</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span>
                {entity === "action" ? "Tipo de acción" : "Plataforma"}
              </span>
              {field(
                "platform",
                entity === "action"
                  ? "Llamada, seguimiento, revisión…"
                  : "Meta, Fiverr, comunidad…",
                "text",
                d.platform,
              )}
            </label>
            <label className="space-y-2 text-sm">
              <span>
                {entity === "campaign"
                  ? "Inversión (€)"
                  : entity === "action"
                    ? "Responsable o contexto"
                    : "Oferta / acuerdo"}
              </span>
              {field(
                entity === "campaign" ? "spend" : "offer",
                entity === "campaign"
                  ? "0"
                  : entity === "action"
                    ? "Opcional"
                    : "Qué se ofrece",
                "text",
                entity === "campaign" ? d.spend : d.offer,
              )}
            </label>
            <label className="space-y-2 text-sm">
              <span>
                {entity === "action" ? "Fecha programada" : "Próxima revisión"}
              </span>
              {field("next_action_on", "", "date", d.next_action_on)}
            </label>
            <label className="space-y-2 text-sm sm:col-span-2">
              <span>
                {entity === "action" ? "Qué hay que hacer" : "Acción activa"}
              </span>
              {field(
                entity === "campaign" ? "creative" : "action",
                entity === "action"
                  ? "Describe la acción"
                  : "Qué se está haciendo",
                "text",
                entity === "campaign" ? d.creative : d.action,
              )}
            </label>
          </>
        )}
        <label className="space-y-2 text-sm sm:col-span-2">
          <span>Notas</span>
          <Textarea
            name="notes"
            rows={3}
            defaultValue={d.notes || ""}
            placeholder="Contexto útil para la siguiente decisión"
          />
        </label>
      </div>
      {error && (
        <p className="text-sm text-rose-300" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-3">
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-400/35 px-3 py-2 text-sm font-medium text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
          >
            <Trash2 size={16} />
            Eliminar
          </button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
