"use client";

import * as React from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CloudUpload,
  CreditCard,
  FileText,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  LogIn,
  Mic,
  ReceiptEuro,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  UserRound,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { seed } from "./data/seed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";

type Role = "Dirección" | "Editor" | "Cliente";
type ViewId =
  | "inicio"
  | "operaciones"
  | "clientes"
  | "bonos"
  | "finanzas"
  | "equipo"
  | "archivos"
  | "crm"
  | "contenido"
  | "conocimiento"
  | "ajustes";
type Client = (typeof seed.clients)[number];

const euro = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shortDate = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const monthNames = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
] as const;

const monthlyData = monthNames.map((month, index) => {
  const key = `2026-${String(index + 1).padStart(2, "0")}`;
  const rows = seed.finance.filter((row) => row.date.startsWith(key));
  const income = rows
    .filter((row) => row.type === "Ingreso")
    .reduce((sum, row) => sum + row.amount, 0);
  const expenses = rows
    .filter((row) => row.type === "Gasto")
    .reduce((sum, row) => sum + row.amount, 0);

  return {
    month,
    income: Number(income.toFixed(2)),
    expenses: Number(expenses.toFixed(2)),
    net: Number((income - expenses).toFixed(2)),
  };
});

const financeChartConfig = {
  income: { label: "Ingresos", color: "#25d7ad" },
  expenses: { label: "Gastos", color: "#ff718b" },
} satisfies ChartConfig;

const netChartConfig = {
  net: { label: "Neto", color: "#8f76ff" },
} satisfies ChartConfig;

const ownerNavigation = [
  { id: "inicio", label: "Centro de mando", icon: LayoutDashboard },
  { id: "operaciones", label: "Pendientes e historial", icon: ListChecks, badge: seed.pending.length },
  { id: "clientes", label: "Clientes", icon: Users, badge: seed.clients.length },
  { id: "bonos", label: "Bonos", icon: WalletCards, badge: seed.bonuses.length },
  { id: "finanzas", label: "Finanzas", icon: BarChart3 },
  { id: "equipo", label: "Equipo", icon: UserRound, badge: seed.editors.length },
  { id: "archivos", label: "Archivos", icon: FolderOpen },
  { id: "crm", label: "Ventas y CRM", icon: BriefcaseBusiness },
  { id: "contenido", label: "Contenido", icon: CalendarDays },
  { id: "conocimiento", label: "Conocimiento", icon: BookOpen },
  { id: "ajustes", label: "Ajustes", icon: Settings },
] as const;

const editorNavigation = [
  { id: "inicio", label: "Mi panel", icon: LayoutDashboard },
  { id: "operaciones", label: "Mis trabajos", icon: ListChecks },
  { id: "archivos", label: "Entregas y archivos", icon: CloudUpload },
  { id: "conocimiento", label: "NegoDigi Handbook", icon: BookOpen },
] as const;

const clientNavigation = [
  { id: "inicio", label: "Mi panel", icon: LayoutDashboard },
  { id: "operaciones", label: "Mis proyectos", icon: ListChecks },
  { id: "bonos", label: "Mi bono", icon: WalletCards },
  { id: "archivos", label: "Subir material", icon: CloudUpload },
] as const;

function formatDate(value: string | null) {
  if (!value) return "—";
  return shortDate.format(new Date(`${value}T12:00:00`));
}

function statusBadge(status: string) {
  const green = ["Activo", "Disponible", "Entregado"].includes(status);
  const red = ["Agotado", "Saturado", "Vencido"].includes(status);
  return (
    <Badge
      variant="outline"
      className={
        green
          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
          : red
            ? "border-rose-400/25 bg-rose-400/10 text-rose-300"
            : "border-amber-400/25 bg-amber-400/10 text-amber-300"
      }
    >
      {status}
    </Badge>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  tone = "violet",
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "violet" | "green" | "red" | "blue";
}) {
  const tones = {
    violet: "bg-violet-400/10 text-violet-300 ring-violet-400/15",
    green: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/15",
    red: "bg-rose-400/10 text-rose-300 ring-rose-400/15",
    blue: "bg-sky-400/10 text-sky-300 ring-sky-400/15",
  };

  return (
    <Card className="panel-surface gap-4 overflow-hidden border-white/[0.06] py-5 shadow-none">
      <CardHeader className="px-5">
        <CardDescription className="text-xs font-medium tracking-wide text-slate-400 uppercase">
          {title}
        </CardDescription>
        <CardAction>
          <span className={`grid size-9 place-items-center rounded-xl ring-1 ${tones[tone]}`}>
            <Icon className="size-4" />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="px-5">
        <div className="number-tabular text-[1.65rem] font-semibold text-white">{value}</div>
        <p className="mt-2 text-xs text-slate-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.16em] text-violet-300 uppercase">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p>
      </div>
      {action}
    </div>
  );
}

function AICommandBar() {
  const [command, setCommand] = React.useState("");
  const [result, setResult] = React.useState<string | null>(null);

  function prepareCommand() {
    const normalized = command.toLowerCase();
    const amount = command.match(/(\d+(?:[.,]\d{1,2})?)/)?.[1]?.replace(",", ".");
    let interpretation = "Necesito el cliente, la acción y la fecha para preparar el cambio.";

    if ((normalized.includes("pagó") || normalized.includes("pago")) && amount) {
      interpretation = `Registrar ingreso de ${euro.format(Number(amount))}, actualizar el cliente y revisar pagos pendientes.`;
    } else if (normalized.includes("asigna") || normalized.includes("asignar")) {
      interpretation = "Asignar el trabajo al editor indicado, actualizar su carga y preparar la notificación.";
    } else if (normalized.includes("gasto") && amount) {
      interpretation = `Registrar gasto de ${euro.format(Number(amount))} en Finanzas y recalcular el neto mensual.`;
    }

    setResult(interpretation);
    toast.success("Orden interpretada", {
      description: "La ejecución real se activará al conectar Supabase.",
    });
  }

  return (
    <Card className="soft-grid overflow-hidden border-violet-400/15 bg-[linear-gradient(130deg,rgba(124,92,255,.14),rgba(16,21,31,.92)_42%)] py-0 shadow-[0_24px_80px_rgba(0,0,0,.28)]">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-violet-400 text-white shadow-[0_0_30px_rgba(124,92,255,.35)]">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-white">Control por IA</h2>
              <Badge variant="outline" className="border-violet-400/25 bg-violet-400/10 text-violet-200">
                Preparado para Supabase
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Escribe como hablas: “Grace pagó 500 € hoy” o “asigna el trabajo de Carlos a David”.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-black/20 p-2">
          <Button variant="ghost" size="icon" className="shrink-0 rounded-xl text-slate-400 hover:text-white" aria-label="Dictar orden">
            <Mic className="size-4" />
          </Button>
          <Input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && command.trim()) prepareCommand();
            }}
            placeholder="¿Qué quieres que haga?"
            className="h-11 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          />
          <Button onClick={prepareCommand} disabled={!command.trim()} className="h-10 rounded-xl bg-violet-500 px-4 hover:bg-violet-400">
            Preparar
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>

        {result && (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] p-3 text-sm">
            <div className="flex gap-2 text-slate-300">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-300" />
              <span>{result}</span>
            </div>
            <button onClick={() => setResult(null)} className="text-slate-500 hover:text-white" aria-label="Cerrar resultado">
              <X className="size-4" />
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MonthlyFinanceChart({ compact = false }: { compact?: boolean }) {
  return (
    <Card className="panel-surface border-white/[0.06] shadow-none">
      <CardHeader>
        <CardTitle className="text-base text-white">Ingresos y gastos por mes</CardTitle>
        <CardDescription>Enero–agosto de 2026 · cifras exactas de NegoDigi</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={financeChartConfig} className={compact ? "h-[255px] w-full" : "h-[320px] w-full"}>
          <BarChart data={monthlyData} margin={{ top: 28, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,.06)" />
            <XAxis dataKey="month" tickLine={false} axisLine={false} interval={0} tickMargin={10} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={76}
              tickFormatter={(value) => `${Number(value).toLocaleString("es-ES")} €`}
            />
            <ChartTooltip
              cursor={{ fill: "rgba(255,255,255,.025)" }}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <div className="flex min-w-40 items-center justify-between gap-5">
                      <span className="text-slate-400">{name === "income" ? "Ingresos" : "Gastos"}</span>
                      <span className="font-mono font-semibold text-white">{euro.format(Number(value))}</span>
                    </div>
                  )}
                />
              }
            />
            <Bar dataKey="income" fill="var(--color-income)" radius={[5, 5, 0, 0]} maxBarSize={26} />
            <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[5, 5, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function OwnerDashboard() {
  const overdue = seed.pending.filter((job) => job.due && job.due < seed.generatedAt).length;
  const exhausted = seed.bonuses.filter((bonus) => bonus.remaining === 0 && bonus.excess > 0);

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Centro de mando"
        title="Todo NegoDigi, en una sola vista"
        description="Datos consolidados de Notion y Glide con corte al 26 de agosto de 2026. Sin movimientos personales ni otros proyectos."
        action={
          <Badge variant="outline" className="h-8 border-emerald-400/20 bg-emerald-400/[0.07] px-3 text-emerald-300">
            <span className="mr-2 size-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" />
            Datos conciliados
          </Badge>
        }
      />

      <AICommandBar />

      <div className="metric-grid">
        <MetricCard title="Ingresos" value={euro.format(seed.metrics.income)} detail="99 movimientos · NegoDigi" icon={ArrowUpRight} tone="green" />
        <MetricCard title="Gastos" value={euro.format(seed.metrics.expenses)} detail="42 movimientos unificados" icon={ArrowDownRight} tone="red" />
        <MetricCard title="Neto" value={euro.format(seed.metrics.net)} detail="Ingresos menos gastos" icon={TrendingUp} tone="violet" />
        <MetricCard title="Crédito disponible" value={euro.format(seed.metrics.bonusAvailable)} detail="24 bonos · nunca baja de 0" icon={WalletCards} tone="blue" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.75fr)]">
        <MonthlyFinanceChart compact />

        <Card className="panel-surface gap-4 border-white/[0.06] shadow-none">
          <CardHeader>
            <CardTitle className="text-base text-white">Requiere atención</CardTitle>
            <CardDescription>Alertas operativas calculadas</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <AlertRow
              icon={Clock3}
              title={`${overdue} entregas fuera de fecha`}
              detail="Revisar prioridad y editor asignado"
              tone="red"
            />
            <AlertRow
              icon={WalletCards}
              title={`${exhausted.length} bonos agotados con exceso`}
              detail={`${euro.format(exhausted.reduce((sum: number, bonus) => sum + bonus.excess, 0))} deben pasar a cobro`}
              tone="amber"
            />
            <AlertRow
              icon={ReceiptEuro}
              title={`${seed.receivables.length} pagos pendientes`}
              detail={`${euro.format(seed.metrics.receivables)} todavía por cobrar`}
              tone="blue"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="panel-surface gap-4 border-white/[0.06] shadow-none">
          <CardHeader>
            <CardTitle className="text-base text-white">Próximas entregas</CardTitle>
            <CardDescription>{seed.pending.length} trabajos abiertos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {seed.pending.slice(0, 5).map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-4 rounded-xl px-2 py-3 hover:bg-white/[0.025]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-200">{job.client}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{job.title} · {job.editor}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium text-slate-300">{formatDate(job.due)}</p>
                  <p className="mt-1 text-[11px] text-slate-600">{job.reels + job.youtube + job.thumbnails + job.other} piezas</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="panel-surface gap-4 border-white/[0.06] shadow-none">
          <CardHeader>
            <CardTitle className="text-base text-white">Neto mensual</CardTitle>
            <CardDescription>Importes completos, sin abreviaciones</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={netChartConfig} className="h-[220px] w-full">
              <LineChart data={monthlyData} margin={{ top: 22, right: 18, left: 18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,.06)" />
                <XAxis dataKey="month" tickLine={false} axisLine={false} interval={0} tickMargin={10} />
                <ChartTooltip content={<ChartTooltipContent formatter={(value) => euro.format(Number(value))} />} />
                <Line type="monotone" dataKey="net" stroke="var(--color-net)" strokeWidth={3} dot={{ fill: "#8f76ff", r: 4 }}>
                  <LabelList dataKey="net" position="top" offset={10} formatter={(value) => euro.format(Number(value))} className="fill-slate-300 text-[9px]" />
                </Line>
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AlertRow({
  icon: Icon,
  title,
  detail,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  tone: "red" | "amber" | "blue";
}) {
  const tones = {
    red: "bg-rose-400/10 text-rose-300",
    amber: "bg-amber-400/10 text-amber-300",
    blue: "bg-sky-400/10 text-sky-300",
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/[0.05] bg-white/[0.018] p-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

function OperationsView({ role, editorName, clientName }: { role: Role; editorName: string; clientName: string }) {
  const pending = role === "Editor"
    ? seed.pending.filter((job) => job.editor === editorName)
    : role === "Cliente"
      ? seed.pending.filter((job) => job.client === clientName)
      : seed.pending;
  const history = role === "Editor"
    ? seed.history.filter((job) => job.editor === editorName)
    : role === "Cliente"
      ? seed.history.filter((job) => job.client === clientName)
      : seed.history;

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Operaciones"
        title={role === "Dirección" ? "Pendientes e historial" : role === "Editor" ? "Mis trabajos" : "Mis proyectos"}
        description="Los trabajos abiertos viven en Pendientes; al entregarse pasan al Historial. No hay estados intermedios innecesarios."
        action={
          role === "Dirección" ? (
            <Button className="rounded-xl bg-violet-500 hover:bg-violet-400"><ListChecks className="mr-2 size-4" />Nuevo trabajo</Button>
          ) : undefined
        }
      />

      <Tabs defaultValue="pending" className="gap-4">
        <TabsList className="border border-white/[0.06] bg-white/[0.025]">
          <TabsTrigger value="pending">Pendientes <span className="ml-1 text-slate-500">{pending.length}</span></TabsTrigger>
          <TabsTrigger value="history">Historial <span className="ml-1 text-slate-500">{history.length}</span></TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          <JobsTable rows={pending} mode="pending" showMoney={role !== "Cliente"} />
        </TabsContent>
        <TabsContent value="history">
          <JobsTable rows={history} mode="history" showMoney={role !== "Cliente"} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function JobsTable({
  rows,
  mode,
  showMoney,
}: {
  rows: readonly ((typeof seed.pending)[number] | (typeof seed.history)[number])[];
  mode: "pending" | "history";
  showMoney: boolean;
}) {
  return (
    <Card className="panel-surface gap-0 overflow-hidden border-white/[0.06] py-0 shadow-none">
      <Table>
        <TableHeader>
          <TableRow className="border-white/[0.06] hover:bg-transparent">
            <TableHead className="h-12 pl-5 text-xs text-slate-500">Trabajo</TableHead>
            <TableHead className="text-xs text-slate-500">Editor</TableHead>
            <TableHead className="text-xs text-slate-500">Contenido</TableHead>
            <TableHead className="text-xs text-slate-500">{mode === "pending" ? "Fecha límite" : "Entrega"}</TableHead>
            {showMoney && <TableHead className="pr-5 text-right text-xs text-slate-500">Pago editor</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((job) => (
            <TableRow key={job.id} className="border-white/[0.045] hover:bg-white/[0.025]">
              <TableCell className="py-4 pl-5">
                <div className="font-medium text-slate-200">{job.client}</div>
                <div className="mt-1 max-w-[320px] truncate text-xs text-slate-500">{job.title}</div>
              </TableCell>
              <TableCell className="text-slate-300">{job.editor}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1.5">
                  {job.reels > 0 && <ServiceBadge>{job.reels} reels</ServiceBadge>}
                  {job.youtube > 0 && <ServiceBadge>{job.youtube} YouTube</ServiceBadge>}
                  {job.thumbnails > 0 && <ServiceBadge>{job.thumbnails} miniaturas</ServiceBadge>}
                  {job.other > 0 && <ServiceBadge>{job.other} otros</ServiceBadge>}
                </div>
              </TableCell>
              <TableCell className="text-slate-300">
                {formatDate(mode === "pending" ? ("due" in job ? job.due : null) : ("delivered" in job ? job.delivered : null))}
              </TableCell>
              {showMoney && <TableCell className="number-tabular pr-5 text-right font-medium text-slate-200">{euro.format(job.editorCost)}</TableCell>}
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={showMoney ? 5 : 4} className="h-40 text-center text-slate-500">No hay registros en esta vista.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

function ServiceBadge({ children }: { children: React.ReactNode }) {
  return <Badge variant="outline" className="border-white/[0.07] bg-white/[0.025] font-normal text-slate-400">{children}</Badge>;
}

function ClientsView() {
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<Client | null>(null);
  const filtered = seed.clients.filter((client) => client.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Relaciones"
        title="Clientes"
        description="Ficha única por cliente con fecha de inicio, documentación, precios, trabajos, pagos y rentabilidad."
        action={<Button className="rounded-xl bg-violet-500 hover:bg-violet-400"><Users className="mr-2 size-4" />Nuevo cliente</Button>}
      />

      <div className="relative max-w-md">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente…" className="h-11 rounded-xl border-white/[0.07] bg-white/[0.025] pl-10" />
      </div>

      <Card className="panel-surface gap-0 overflow-hidden border-white/[0.06] py-0 shadow-none">
        <Table>
          <TableHeader>
            <TableRow className="border-white/[0.06] hover:bg-transparent">
              <TableHead className="h-12 pl-5 text-xs text-slate-500">Cliente</TableHead>
              <TableHead className="text-xs text-slate-500">Tipo</TableHead>
              <TableHead className="text-xs text-slate-500">Estado</TableHead>
              <TableHead className="text-xs text-slate-500">Fecha de inicio</TableHead>
              <TableHead className="pr-5 text-right text-xs text-slate-500">Actividad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((client) => {
              const jobs = seed.pending.filter((job) => job.client === client.name).length;
              return (
                <TableRow key={client.id} onClick={() => setSelected(client)} className="cursor-pointer border-white/[0.045] hover:bg-white/[0.03]">
                  <TableCell className="py-4 pl-5">
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-400/25 to-sky-400/10 text-xs font-semibold text-violet-200">
                        {client.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <p className="font-medium text-slate-200">{client.name}</p>
                        <p className="mt-0.5 text-xs text-slate-600">{client.email || "Sin email registrado"}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-400">{client.type || "—"}</TableCell>
                  <TableCell>{statusBadge(client.status)}</TableCell>
                  <TableCell className="text-slate-400">{formatDate(client.joined)}</TableCell>
                  <TableCell className="pr-5 text-right">
                    <span className="text-sm text-slate-300">{jobs} pendientes</span>
                    <ChevronRight className="ml-2 inline size-4 text-slate-600" />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <ClientSheet client={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}

function ClientSheet({ client, onOpenChange }: { client: Client | null; onOpenChange: (open: boolean) => void }) {
  const bonuses = client ? seed.bonuses.filter((bonus) => bonus.client === client.name) : [];
  const rates = client ? seed.pricing.filter((rate) => rate.client === client.name) : [];
  const pending = client ? seed.pending.filter((job) => job.client === client.name) : [];
  const delivered = client ? seed.history.filter((job) => job.client === client.name) : [];

  return (
    <Sheet open={Boolean(client)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full border-white/[0.08] bg-[#0d121b] sm:max-w-xl">
        {client && (
          <>
            <SheetHeader className="border-b border-white/[0.06] p-6">
              <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-violet-400/15 font-semibold text-violet-200">
                {client.name.slice(0, 2).toUpperCase()}
              </div>
              <SheetTitle className="text-xl text-white">{client.name}</SheetTitle>
              <SheetDescription>{client.email || "Sin email"} · Alta {formatDate(client.joined)}</SheetDescription>
            </SheetHeader>
            <div className="scrollbar-thin flex-1 space-y-6 overflow-y-auto p-6">
              <div className="grid grid-cols-3 gap-3">
                <MiniStat label="Pendientes" value={String(pending.length)} />
                <MiniStat label="Entregados" value={String(delivered.length)} />
                <MiniStat label="Tarifas" value={String(rates.length)} />
              </div>

              <section>
                <h3 className="text-sm font-semibold text-white">Bonos</h3>
                <div className="mt-3 space-y-3">
                  {bonuses.map((bonus) => (
                    <div key={bonus.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                      <div className="flex justify-between gap-4">
                        <span className="text-sm text-slate-300">{bonus.name}</span>
                        <span className="font-semibold text-white">{euro.format(bonus.remaining)}</span>
                      </div>
                      <Progress className="mt-3 h-1.5" value={bonus.initial ? (bonus.remaining / bonus.initial) * 100 : 0} />
                      <div className="mt-2 flex justify-between text-xs text-slate-500">
                        <span>Usado {euro.format(bonus.used + bonus.reserved)}</span>
                        <span>Inicial {euro.format(bonus.initial)}</span>
                      </div>
                    </div>
                  ))}
                  {bonuses.length === 0 && <p className="text-sm text-slate-500">Sin bonos registrados.</p>}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-white">Precios acordados</h3>
                <div className="mt-3 divide-y divide-white/[0.05] rounded-xl border border-white/[0.06]">
                  {rates.map((rate) => (
                    <div key={rate.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                      <span className="text-slate-400">{rate.service}</span>
                      <span className="font-medium text-slate-200">{euro.format(rate.clientPrice)} / u.</span>
                    </div>
                  ))}
                  {rates.length === 0 && <p className="p-4 text-sm text-slate-500">Sin tarifas registradas.</p>}
                </div>
              </section>

              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" className="border-white/[0.08] bg-white/[0.02]"><FileText className="mr-2 size-4" />Documentación</Button>
                <Button variant="outline" className="border-white/[0.08] bg-white/[0.02]"><FolderOpen className="mr-2 size-4" />Drive</Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function BonusesView({ role, clientName }: { role: Role; clientName: string }) {
  const rows: ReadonlyArray<(typeof seed.bonuses)[number]> = role === "Cliente" ? seed.bonuses.filter((bonus) => bonus.client === clientName) : seed.bonuses;
  const available = rows.reduce((sum: number, bonus) => sum + bonus.remaining, 0);
  const excess = rows.reduce((sum: number, bonus) => sum + bonus.excess, 0);

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Crédito prepago"
        title={role === "Cliente" ? "Mi bono" : "Bonos de clientes"}
        description="Saldo disponible = máximo 0 entre saldo inicial − reservado − servicios entregados. El exceso nunca resta del total y pasa a cobro pendiente."
        action={role === "Dirección" ? <Button className="rounded-xl bg-violet-500 hover:bg-violet-400"><CreditCard className="mr-2 size-4" />Registrar bono</Button> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard title="Crédito disponible" value={euro.format(available)} detail={`${rows.length} bonos visibles`} icon={WalletCards} tone="violet" />
        <MetricCard title="Saldo inicial" value={euro.format(rows.reduce((sum: number, bonus) => sum + bonus.initial, 0))} detail="Importe histórico adquirido" icon={CircleDollarSign} tone="blue" />
        <MetricCard title="Exceso por cobrar" value={euro.format(excess)} detail="No se descuenta dos veces" icon={ReceiptEuro} tone="red" />
      </div>

      <Card className="panel-surface gap-0 overflow-hidden border-white/[0.06] py-0 shadow-none">
        <Table>
          <TableHeader>
            <TableRow className="border-white/[0.06] hover:bg-transparent">
              <TableHead className="h-12 pl-5 text-xs text-slate-500">Cliente</TableHead>
              <TableHead className="text-right text-xs text-slate-500">Inicial</TableHead>
              <TableHead className="text-right text-xs text-slate-500">Reservado</TableHead>
              <TableHead className="text-right text-xs text-slate-500">Entregado</TableHead>
              <TableHead className="text-right text-xs text-slate-500">Disponible</TableHead>
              <TableHead className="text-right text-xs text-slate-500">Exceso</TableHead>
              <TableHead className="pr-5 text-right text-xs text-slate-500">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((bonus) => (
              <TableRow key={bonus.id} className="border-white/[0.045] hover:bg-white/[0.025]">
                <TableCell className="py-4 pl-5">
                  <p className="font-medium text-slate-200">{bonus.client}</p>
                  <p className="mt-1 text-xs text-slate-600">Pago {formatDate(bonus.paidAt)}</p>
                </TableCell>
                <TableCell className="number-tabular text-right text-slate-400">{euro.format(bonus.initial)}</TableCell>
                <TableCell className="number-tabular text-right text-slate-400">{euro.format(bonus.reserved)}</TableCell>
                <TableCell className="number-tabular text-right text-slate-400">{euro.format(bonus.used)}</TableCell>
                <TableCell className="number-tabular text-right font-semibold text-white">{euro.format(bonus.remaining)}</TableCell>
                <TableCell className={`number-tabular text-right ${bonus.excess > 0 ? "font-semibold text-rose-300" : "text-slate-600"}`}>{euro.format(bonus.excess)}</TableCell>
                <TableCell className="pr-5 text-right">{statusBadge(bonus.remaining === 0 ? "Agotado" : bonus.status)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function FinanceView() {
  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState("Todos");
  const rows = seed.finance
    .filter((row) => type === "Todos" || row.type === type)
    .filter((row) => row.concept.toLowerCase().includes(query.toLowerCase()))
    .slice()
    .reverse();

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Control económico"
        title="Finanzas"
        description="Solo NegoDigi. Ingreso y Gasto como únicos tipos; gasto e inversión ya están unificados."
        action={<Button className="rounded-xl bg-violet-500 hover:bg-violet-400"><ReceiptEuro className="mr-2 size-4" />Nuevo movimiento</Button>}
      />

      <div className="metric-grid">
        <MetricCard title="Ingresos" value={euro.format(seed.metrics.income)} detail="99 movimientos" icon={ArrowUpRight} tone="green" />
        <MetricCard title="Gastos" value={euro.format(seed.metrics.expenses)} detail="42 movimientos" icon={ArrowDownRight} tone="red" />
        <MetricCard title="Neto total" value={euro.format(seed.metrics.net)} detail="Conciliado al céntimo" icon={TrendingUp} tone="violet" />
        <MetricCard title="Por cobrar" value={euro.format(seed.metrics.receivables)} detail="8 clientes" icon={Clock3} tone="blue" />
      </div>

      <Tabs defaultValue="summary" className="gap-4">
        <TabsList className="border border-white/[0.06] bg-white/[0.025]">
          <TabsTrigger value="summary">Resumen mensual</TabsTrigger>
          <TabsTrigger value="transactions">Movimientos</TabsTrigger>
          <TabsTrigger value="receivables">Pagos pendientes</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-5">
          <MonthlyFinanceChart />
          <Card className="panel-surface gap-0 overflow-hidden border-white/[0.06] py-0 shadow-none">
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent">
                  <TableHead className="h-12 pl-5 text-xs text-slate-500">Mes</TableHead>
                  <TableHead className="text-right text-xs text-slate-500">Ingresos</TableHead>
                  <TableHead className="text-right text-xs text-slate-500">Gastos</TableHead>
                  <TableHead className="pr-5 text-right text-xs text-slate-500">Neto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlyData.map((month) => (
                  <TableRow key={month.month} className="border-white/[0.045]">
                    <TableCell className="py-3 pl-5 font-medium text-slate-200">{month.month}</TableCell>
                    <TableCell className="number-tabular text-right text-emerald-300">{euro.format(month.income)}</TableCell>
                    <TableCell className="number-tabular text-right text-rose-300">{euro.format(month.expenses)}</TableCell>
                    <TableCell className="number-tabular pr-5 text-right font-semibold text-white">{euro.format(month.net)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar concepto…" className="h-11 rounded-xl border-white/[0.07] bg-white/[0.025] pl-10" />
            </div>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-11 w-full rounded-xl border-white/[0.07] bg-white/[0.025] sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="Todos">Todos</SelectItem><SelectItem value="Ingreso">Ingresos</SelectItem><SelectItem value="Gasto">Gastos</SelectItem></SelectContent>
            </Select>
          </div>
          <Card className="panel-surface gap-0 overflow-hidden border-white/[0.06] py-0 shadow-none">
            <div className="scrollbar-thin max-h-[640px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-[#111722]">
                  <TableRow className="border-white/[0.06] hover:bg-transparent">
                    <TableHead className="h-12 pl-5 text-xs text-slate-500">Concepto</TableHead>
                    <TableHead className="text-xs text-slate-500">Tipo</TableHead>
                    <TableHead className="text-xs text-slate-500">Cuenta</TableHead>
                    <TableHead className="text-xs text-slate-500">Fecha</TableHead>
                    <TableHead className="pr-5 text-right text-xs text-slate-500">Importe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} className="border-white/[0.045] hover:bg-white/[0.025]">
                      <TableCell className="py-3 pl-5 font-medium text-slate-200">{row.concept}</TableCell>
                      <TableCell><Badge variant="outline" className={row.type === "Ingreso" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-rose-400/20 bg-rose-400/10 text-rose-300"}>{row.type}</Badge></TableCell>
                      <TableCell className="text-slate-400">{row.account || "—"}</TableCell>
                      <TableCell className="text-slate-400">{formatDate(row.date)}</TableCell>
                      <TableCell className={`number-tabular pr-5 text-right font-semibold ${row.type === "Ingreso" ? "text-emerald-300" : "text-rose-300"}`}>{row.type === "Ingreso" ? "+" : "−"}{euro.format(row.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="receivables">
          <Card className="panel-surface gap-0 overflow-hidden border-white/[0.06] py-0 shadow-none">
            <Table>
              <TableHeader><TableRow className="border-white/[0.06] hover:bg-transparent"><TableHead className="h-12 pl-5 text-xs text-slate-500">Cliente</TableHead><TableHead className="text-xs text-slate-500">Detalle</TableHead><TableHead className="text-xs text-slate-500">Fecha de inicio</TableHead><TableHead className="pr-5 text-right text-xs text-slate-500">Pendiente</TableHead></TableRow></TableHeader>
              <TableBody>
                {seed.receivables.map((row) => (
                  <TableRow key={row.id} className="border-white/[0.045] hover:bg-white/[0.025]">
                    <TableCell className="py-4 pl-5 font-medium text-slate-200">{row.client}</TableCell>
                    <TableCell className="text-slate-500">{row.reels > 0 ? `${row.reels} reels` : row.youtube > 0 ? `${row.youtube} YouTube` : "Servicios"}</TableCell>
                    <TableCell className="text-slate-400">{formatDate(row.start)}</TableCell>
                    <TableCell className="number-tabular pr-5 text-right font-semibold text-amber-300">{euro.format(row.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t border-white/[0.08] bg-white/[0.02]">
                  <TableCell colSpan={3} className="pl-5 font-medium text-slate-300">Total pendiente</TableCell>
                  <TableCell className="number-tabular pr-5 text-right text-lg font-semibold text-white">{euro.format(seed.metrics.receivables)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TeamView() {
  return (
    <div className="space-y-6">
      <PageHeading eyebrow="Personas" title="Equipo" description="Editores, disponibilidad, producción y pagos en una ficha única." action={<Button className="rounded-xl bg-violet-500 hover:bg-violet-400"><UserRound className="mr-2 size-4" />Añadir editor</Button>} />
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {seed.editors.map((editor) => {
          const assigned = seed.pending.filter((job) => job.editor === editor.name);
          return (
            <Card key={editor.id} className="panel-surface border-white/[0.06] shadow-none">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-400/25 to-sky-400/10 font-semibold text-violet-200">{editor.name.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0"><CardTitle className="truncate text-base text-white">{editor.name}</CardTitle><CardDescription className="mt-1">{editor.role}</CardDescription></div>
                </div>
                <CardAction>{statusBadge(editor.status)}</CardAction>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2"><MiniStat label="Pendientes" value={String(assigned.length)} /><MiniStat label="Pagado" value={euro.format(editor.paid)} /><MiniStat label="Neto" value={euro.format(editor.net)} /></div>
                <div className="flex items-center justify-between text-xs"><span className="text-slate-500">Disponibilidad</span><span className="text-slate-300">{editor.availability}</span></div>
                <Progress value={Math.min(100, assigned.length * 20)} className="h-1.5" />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function EditorDashboard({ editorName, onEditorChange }: { editorName: string; onEditorChange: (name: string) => void }) {
  const editor = seed.editors.find((item) => item.name === editorName) || seed.editors[0];
  const jobs = seed.pending.filter((job) => job.editor === editor.name);
  const delivered = seed.history.filter((job) => job.editor === editor.name);

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Panel del editor"
        title={`Hola, ${editor.name.split(" ")[0]}`}
        description="Tus trabajos asignados, fechas, entregas y pagos. No se muestran precios de cliente ni información financiera interna."
        action={<Select value={editor.name} onValueChange={onEditorChange}><SelectTrigger className="h-10 w-56 rounded-xl border-white/[0.07] bg-white/[0.025]"><SelectValue /></SelectTrigger><SelectContent>{seed.editors.map((item) => <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select>}
      />
      <div className="grid gap-4 sm:grid-cols-3"><MetricCard title="Pendientes" value={String(jobs.length)} detail="Trabajos asignados" icon={ListChecks} tone="violet" /><MetricCard title="Entregados" value={String(delivered.length)} detail="Historial disponible" icon={Check} tone="green" /><MetricCard title="Pagado histórico" value={euro.format(editor.paid)} detail="Solo tu información" icon={CircleDollarSign} tone="blue" /></div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_.6fr]">
        <Card className="panel-surface gap-0 overflow-hidden border-white/[0.06] py-0 shadow-none"><JobsTable rows={jobs} mode="pending" showMoney /></Card>
        <Card className="soft-grid border-violet-400/15 bg-violet-400/[0.05] shadow-none"><CardHeader><CardTitle className="text-base text-white">Entregar trabajo</CardTitle><CardDescription>Sube el vídeo final y sus archivos.</CardDescription></CardHeader><CardContent><button className="flex h-44 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-violet-400/25 bg-violet-400/[0.035] text-center"><CloudUpload className="size-7 text-violet-300" /><span className="mt-3 text-sm font-medium text-slate-200">Seleccionar archivos</span><span className="mt-1 text-xs text-slate-500">MP4, MOV, ZIP o enlace Drive</span></button></CardContent></Card>
      </div>
    </div>
  );
}

function ClientDashboard({ clientName, onClientChange }: { clientName: string; onClientChange: (name: string) => void }) {
  const clientOptions = Array.from(new Set(seed.bonuses.map((bonus) => bonus.client))).sort();
  const bonus = seed.bonuses.find((item) => item.client === clientName);
  const jobs = seed.pending.filter((job) => job.client === clientName);
  const delivered = seed.history.filter((job) => job.client === clientName);

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Portal del cliente"
        title={clientName}
        description="Material, trabajos, entregas y saldo del bono en un único espacio. Los costes internos del equipo no son visibles."
        action={<Select value={clientName} onValueChange={onClientChange}><SelectTrigger className="h-10 w-56 rounded-xl border-white/[0.07] bg-white/[0.025]"><SelectValue /></SelectTrigger><SelectContent>{clientOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>}
      />
      <div className="grid gap-4 sm:grid-cols-3"><MetricCard title="Crédito disponible" value={euro.format(bonus?.remaining || 0)} detail={`Inicial ${euro.format(bonus?.initial || 0)}`} icon={WalletCards} tone="violet" /><MetricCard title="En producción" value={String(jobs.length)} detail="Trabajos abiertos" icon={Clock3} tone="blue" /><MetricCard title="Entregados" value={String(delivered.length)} detail="Historial completo" icon={Check} tone="green" /></div>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
        <Card className="panel-surface border-white/[0.06] shadow-none"><CardHeader><CardTitle className="text-base text-white">Progreso del bono</CardTitle><CardDescription>Actualizado con cada servicio entregado o reservado.</CardDescription></CardHeader><CardContent>{bonus ? <><div className="flex items-end justify-between"><div><p className="text-sm text-slate-500">Disponible</p><p className="number-tabular mt-1 text-3xl font-semibold text-white">{euro.format(bonus.remaining)}</p></div>{statusBadge(bonus.remaining === 0 ? "Agotado" : bonus.status)}</div><Progress value={bonus.initial ? (bonus.remaining / bonus.initial) * 100 : 0} className="mt-6 h-2" /><div className="mt-4 grid grid-cols-3 gap-3"><MiniStat label="Inicial" value={euro.format(bonus.initial)} /><MiniStat label="Reservado" value={euro.format(bonus.reserved)} /><MiniStat label="Entregado" value={euro.format(bonus.used)} /></div></> : <p className="text-sm text-slate-500">No hay bono asociado.</p>}</CardContent></Card>
        <Card className="soft-grid border-sky-400/15 bg-sky-400/[0.04] shadow-none"><CardHeader><CardTitle className="text-base text-white">Subir material</CardTitle><CardDescription>El editor asignado recibirá el aviso.</CardDescription></CardHeader><CardContent><button className="flex h-40 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-sky-400/25 bg-sky-400/[0.025]"><CloudUpload className="size-7 text-sky-300" /><span className="mt-3 text-sm font-medium text-slate-200">Subir vídeos</span><span className="mt-1 text-xs text-slate-500">Sin enviarlos por WhatsApp</span></button></CardContent></Card>
      </div>
    </div>
  );
}

function ModuleView({ view }: { view: ViewId }) {
  const content: Partial<Record<ViewId, { eyebrow: string; title: string; description: string; icon: React.ComponentType<{ className?: string }>; items: string[] }>> = {
    archivos: { eyebrow: "Almacenamiento", title: "Archivos", description: "Material bruto, entregas, documentos y recursos de marca separados por permisos.", icon: FolderOpen, items: ["Material de clientes", "Entregas finales", "Documentos y contratos", "Recursos de marca"] },
    crm: { eyebrow: "Ventas", title: "CRM", description: "Leads, conversaciones, propuestas y cierres sin mezclarlos con clientes activos.", icon: BriefcaseBusiness, items: ["Nuevos leads", "Contactados", "Negociación", "Cerrados"] },
    contenido: { eyebrow: "Marketing", title: "Contenido", description: "Ideas, guiones, publicaciones y calendario mensual de NegoDigi.", icon: CalendarDays, items: ["Ideas", "Guiones", "En producción", "Publicado"] },
    conocimiento: { eyebrow: "NegoDigi Handbook", title: "Base de conocimiento", description: "Políticas, estándares de calidad, precios, pagos y forma de trabajar.", icon: BookOpen, items: ["Bienvenida y valores", "Operaciones y entregas", "Edición y control de calidad", "Precios y pagos"] },
    ajustes: { eyebrow: "Sistema", title: "Ajustes", description: "Usuarios, roles, permisos, automatizaciones e integraciones.", icon: Settings, items: ["Usuarios y roles", "Supabase", "Notificaciones", "Auditoría de acciones"] },
  };
  const moduleInfo = content[view] || content.archivos!;
  const Icon = moduleInfo.icon;

  return (
    <div className="space-y-6">
      <PageHeading eyebrow={moduleInfo.eyebrow} title={moduleInfo.title} description={moduleInfo.description} />
      <div className="grid gap-4 md:grid-cols-2">
        {moduleInfo.items.map((item, index) => (
          <Card key={item} className="panel-surface border-white/[0.06] shadow-none">
            <CardHeader><span className="mb-3 grid size-10 place-items-center rounded-xl bg-violet-400/10 text-violet-300"><Icon className="size-4" /></span><CardTitle className="text-base text-white">{item}</CardTitle><CardDescription>{index === 0 ? "Estructura preparada para la migración." : "Sin datos inventados; pendiente de importar la fuente correspondiente."}</CardDescription></CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AppSidebar({ role, view, onViewChange }: { role: Role; view: ViewId; onViewChange: (view: ViewId) => void }) {
  const navigation = role === "Dirección" ? ownerNavigation : role === "Editor" ? editorNavigation : clientNavigation;
  return (
    <Sidebar collapsible="icon" className="border-r border-white/[0.04]">
      <SidebarHeader className="p-3">
        <div className="flex h-12 items-center gap-3 rounded-xl px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 text-sm font-bold text-white shadow-[0_10px_30px_rgba(124,92,255,.28)]">N</span>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-semibold text-white">NegoDigi</p><p className="truncate text-[10px] tracking-[0.16em] text-slate-600 uppercase">APP</p></div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegación</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton tooltip={item.label} isActive={view === item.id} onClick={() => onViewChange(item.id as ViewId)} className="h-9">
                    <item.icon className="size-4" /><span>{item.label}</span>
                  </SidebarMenuButton>
                  {"badge" in item && item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] p-3 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2 text-xs text-slate-400"><Activity className="size-3.5 text-emerald-300" />Sistema preparado</div>
          <p className="mt-1.5 text-[10px] leading-4 text-slate-600">Notion importado · Supabase pendiente de conexión</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

export function NegoDigiApp() {
  const [role, setRole] = React.useState<Role>("Dirección");
  const [view, setView] = React.useState<ViewId>("inicio");
  const [editorName, setEditorName] = React.useState<string>(seed.editors[0]?.name || "");
  const [clientName, setClientName] = React.useState<string>(seed.bonuses[0]?.client || "");

  function changeRole(next: Role) {
    setRole(next);
    setView("inicio");
  }

  let content: React.ReactNode;
  if (view === "inicio") {
    content = role === "Dirección" ? <OwnerDashboard /> : role === "Editor" ? <EditorDashboard editorName={editorName} onEditorChange={setEditorName} /> : <ClientDashboard clientName={clientName} onClientChange={setClientName} />;
  } else if (view === "operaciones") {
    content = <OperationsView role={role} editorName={editorName} clientName={clientName} />;
  } else if (view === "clientes") {
    content = <ClientsView />;
  } else if (view === "bonos") {
    content = <BonusesView role={role} clientName={clientName} />;
  } else if (view === "finanzas") {
    content = <FinanceView />;
  } else if (view === "equipo") {
    content = <TeamView />;
  } else {
    content = <ModuleView view={view} />;
  }

  return (
    <SidebarProvider defaultOpen>
      <AppSidebar role={role} view={view} onViewChange={setView} />
      <SidebarInset className="min-w-0 bg-transparent">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-white/[0.05] bg-[#080b11]/90 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="size-9 rounded-xl border border-white/[0.06] bg-white/[0.025]" />
            <Separator orientation="vertical" className="hidden h-5 bg-white/[0.07] sm:block" />
            <div className="hidden sm:block"><p className="text-xs font-medium text-slate-300">NegoDigi APP</p><p className="mt-0.5 text-[10px] text-slate-600">Corte 26 ago 2026</p></div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={role} onValueChange={(value) => changeRole(value as Role)}>
              <SelectTrigger className="h-9 w-[142px] rounded-xl border-white/[0.07] bg-white/[0.025] text-xs sm:w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="Dirección">Vista Dirección</SelectItem><SelectItem value="Editor">Vista Editor</SelectItem><SelectItem value="Cliente">Vista Cliente</SelectItem></SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="relative size-9 rounded-xl border border-white/[0.06] bg-white/[0.025] text-slate-400"><Bell className="size-4" /><span className="absolute top-2 right-2 size-1.5 rounded-full bg-rose-400" /></Button>
            <Button asChild variant="ghost" className="hidden h-9 rounded-xl border border-white/[0.06] bg-white/[0.025] text-xs sm:flex"><a href="/login"><LogIn className="mr-2 size-4" />Acceso</a></Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1560px] p-4 sm:p-6 lg:p-8">{content}</main>
      </SidebarInset>
      <Toaster richColors position="bottom-right" />
    </SidebarProvider>
  );
}
