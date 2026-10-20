import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  defaultRankingSettings,
  scoreEditorPerformance,
} from "../lib/editor-performance.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = await readFile(`${root}/app/operating-system.tsx`, "utf8");
const migration = await readFile(
  `${root}/supabase/migrations/20260831220000_editor_performance_workspace.sql`,
  "utf8",
);
const realtimeMigration = await readFile(
  `${root}/supabase/migrations/20260831224500_editor_workspace_realtime.sql`,
  "utf8",
);
const checklistCleanupMigration = await readFile(
  `${root}/supabase/migrations/20260903171500_checklist_completion_cleanup.sql`,
  "utf8",
);
const editorFinancialGoalsMigration = await readFile(
  `${root}/supabase/migrations/20260903205000_editor_financial_goals.sql`,
  "utf8",
);
const editorHomeRecognitionsMigration = await readFile(
  `${root}/supabase/migrations/20260903214344_editor_home_recognitions.sql`,
  "utf8",
);
const editorHomeRecognitionsRealtimeMigration = await readFile(
  `${root}/supabase/migrations/20260903215311_editor_home_recognitions_realtime.sql`,
  "utf8",
);
const previewDailyPointFixMigration = await readFile(
  `${root}/supabase/migrations/20260903221500_fix_preview_daily_ranking_point.sql`,
  "utf8",
);

function metric(overrides) {
  return {
    organization_id: "org",
    editor_id: "editor",
    editor_name: "Editor",
    period_key: "2026-08",
    submitted_videos: 10,
    approved_videos: 10,
    late_videos: 0,
    on_time_videos: 10,
    correction_count: 0,
    client_amount: 0,
    editor_amount: 100,
    net_profit: 0,
    avg_delivery_hours: 24,
    avg_resolution_hours: 2,
    assigned_videos: 10,
    completed_videos: 10,
    approved_without_correction_videos: 10,
    corrected_approved_videos: 0,
    correction_videos: 0,
    first_pass_approval_rate: 100,
    ...overrides,
  };
}

test("uses three positive ranking criteria and keeps quality meaningful", () => {
  const ranking = scoreEditorPerformance([
    metric({
      editor_id: "high-volume",
      editor_name: "Mucho volumen",
      submitted_videos: 30,
      approved_videos: 20,
      assigned_videos: 30,
      completed_videos: 20,
      late_videos: 15,
      on_time_videos: 5,
      correction_count: 18,
      approved_without_correction_videos: 2,
      corrected_approved_videos: 18,
      correction_videos: 18,
      first_pass_approval_rate: 10,
    }),
    metric({ editor_id: "quality", editor_name: "Alta calidad" }),
  ], defaultRankingSettings);

  assert.equal(ranking[0].row.editor_id, "quality");
  assert.deepEqual(
    ranking[0].parts.map((part) => part.weight),
    [40, 30, 30, 2, 1],
  );
  assert.ok(ranking[0].score <= 100);
});

test("keeps an editor below the minimum visible as a provisional sample", () => {
  const ranking = scoreEditorPerformance([
    metric({ editor_id: "new", approved_videos: 1, submitted_videos: 1 }),
  ], defaultRankingSettings);
  assert.equal(ranking[0].eligible, true);
  assert.equal(ranking[0].rank, 1);
  assert.equal(ranking[0].provisional, true);
  assert.match(ranking[0].ineligibleReason, /Muestra inicial/);
});

test("uses configurable lateness and correction deductions without activity time", () => {
  assert.equal(defaultRankingSettings.value_weight, 40);
  assert.equal(defaultRankingSettings.quality_weight, 30);
  assert.equal(defaultRankingSettings.punctuality_weight, 30);
  assert.equal(defaultRankingSettings.late_penalty_points, 2);
  assert.equal(defaultRankingSettings.correction_penalty_points, 1);
  const clean = scoreEditorPerformance([metric({ correction_videos: 0, correction_count: 0 })])[0];
  const penalized = scoreEditorPerformance([metric({ late_videos: 2, on_time_videos: 8, correction_videos: 1, correction_count: 3 })])[0];
  assert.deepEqual(clean.parts.map((part) => part.key), ["value", "quality", "punctuality", "late_penalty", "correction_penalty"]);
  assert.equal(penalized.parts.find((part) => part.key === "late_penalty")?.points, -4);
  assert.equal(penalized.parts.find((part) => part.key === "correction_penalty")?.points, -3);
  assert.ok(penalized.score < clean.score);
});

test("uses temporary global toasts and removes persistent page banners", () => {
  assert.match(source, /<Toaster/);
  assert.match(source, /toast\.success/);
  assert.match(source, /toast\.error/);
  assert.doesNotMatch(source, /\{notice &&/);
  assert.doesNotMatch(source, /\{error &&/);
});

test("keeps monthly rankings immutable and rewards separate from finance", () => {
  assert.match(migration, /editor_monthly_rankings/);
  assert.match(migration, /on conflict \(period_id, editor_id\) do nothing/i);
  assert.match(migration, /freeze_ranking_after_period_close/);
  assert.match(migration, /editor_monthly_awards/);
  const awards = migration.slice(migration.indexOf("create table if not exists public.editor_monthly_awards"));
  assert.doesNotMatch(awards, /insert into public\.finance_transactions|insert into public\.editor_payments/);
});

test("closes the previous activity session atomically", () => {
  const activityFunction = migration.slice(
    migration.indexOf("create or replace function public.set_editor_activity_state"),
    migration.indexOf("create table if not exists public.editor_planning_blocks"),
  );
  assert.match(activityFunction, /pg_advisory_xact_lock/);
  assert.match(activityFunction, /where editor_id = target_editor_id\s+and ended_at is null/);
  assert.match(activityFunction, /insert into public\.editor_activity_events/);
  assert.doesNotMatch(activityFunction, /editor_payments|finance_transactions/);
});

test("publishes editor workspace changes for realtime invalidation", () => {
  assert.match(realtimeMigration, /editor_activity_events/);
  assert.match(realtimeMigration, /editor_planning_blocks/);
  assert.match(realtimeMigration, /editor_ranking_settings/);
  assert.match(realtimeMigration, /editor_monthly_awards/);
  assert.match(realtimeMigration, /supabase_realtime/);
});

test("keeps the planning interval valid when an editor selects a task date", () => {
  const savePlanning = source.slice(
    source.indexOf("async function savePlanningBlock"),
    source.indexOf("async function deletePlanningBlock"),
  );
  assert.match(migration, /check \(ends_at > starts_at\)/i);
  assert.match(savePlanning, /suppliedEnd\.getTime\(\) > startsAt\.getTime\(\)/);
  assert.match(savePlanning, /startsAt\.getTime\(\) \+ 60 \* 60 \* 1000/);
});

test("keeps the editor checklist immediate, date-free, and safely cleaned after completion", () => {
  const center = source.slice(
    source.indexOf("function EditorProductionCenterV2"),
    source.indexOf("return <div className=\"space-y-6\">", source.indexOf("function EditorProductionCenterV2")),
  );
  assert.doesNotMatch(center, /type="datetime-local"/);
  assert.match(center, /optimisticTasks/);
  assert.match(center, /completed_at/);
  assert.match(checklistCleanupMigration, /status = 'completed'/);
  assert.match(checklistCleanupMigration, /completed_at <= now\(\) - interval '7 days'/);
  assert.doesNotMatch(checklistCleanupMigration, /production_video_history|delivery_corrections|delivery_submission_items/);
});

test("keeps editor work tables embedded in Production", () => {
  const productionRoute = source.slice(
    source.indexOf('if (displayedRole === "Editor" && view === "editor_production")'),
    source.indexOf('if (displayedRole === "Editor" && view === "editor_performance")'),
  );
  const center = source.slice(
    source.indexOf("function EditorProductionCenterV2"),
    source.indexOf("function PersonalPlanning"),
  );
  assert.match(productionRoute, /renderJobs=\{\(\) => <Operations[\s\S]*embedded/);
  assert.match(center, /setProductionView\("jobs"\)/);
  assert.match(center, /renderJobs\(\)/);
  assert.match(center, /Flujo de producción/);
});

test("calculates editor finance from approved history without storing duplicate income", () => {
  const finance = source.slice(
    source.indexOf("function EditorFinancePanel"),
    source.indexOf("function TeamAnnouncements"),
  );
  assert.match(finance, /seenDeliveries/);
  assert.match(finance, /row\.editor_total/);
  assert.match(finance, /LineChart/);
  assert.match(finance, /Resumen/);
  assert.match(finance, /Historial/);
  assert.match(finance, /Calendario de ingresos/);
  assert.match(finance, /financialHistoryDateKey\(row\)\?\.slice\(0, 7\) === selectedPeriod/);
  assert.match(finance, /<table className="w-full min-w-\[780px\] text-sm">/);
  assert.match(finance, /Historial mensual: \{formatPeriodLabel\(selectedPeriod\)\}/);
  assert.doesNotMatch(finance, /Agrupado por cliente y mes/);
  assert.doesNotMatch(finance, /Total de \{formatPeriodLabel\(selectedPeriod\)\}/);
  assert.match(finance, /Objetivo personal/);
  assert.match(finance, /hasIncome/);
  assert.match(source, /financialGoals=\{editorFinancialGoals\.filter\(\(row\) => row\.editor_id === selectedEditor\?\.id\)\}/);
  assert.doesNotMatch(finance, /from\("editor_payments"\)\.insert/);
  assert.match(editorFinancialGoalsMigration, /unique \(organization_id, editor_id, period_key\)/);
  assert.match(editorFinancialGoalsMigration, /enable row level security/);
  assert.match(editorFinancialGoalsMigration, /editor_financial_goals_(select|insert|update)/);
  assert.doesNotMatch(editorFinancialGoalsMigration, /production_video_history\s*\(/);
});

test("keeps editor recognition inside Inicio with a persistent daily point", () => {
  const home = source.slice(
    source.indexOf("function EditorHomeWorkspace"),
    source.indexOf("function EditorNewsWorkspace"),
  );
  const news = source.slice(
    source.indexOf("function EditorNewsWorkspace"),
    source.indexOf("function EditorWorkspace"),
  );
  assert.match(source, /\["inicio", "Inicio", LayoutDashboard\]/);
  assert.doesNotMatch(source.slice(source.indexOf("const editorNavigation"), source.indexOf("const clientNavigation")), /editor_news/);
  assert.match(news, /Editor del mes/);
  assert.match(news, /Editor de la semana/);
  assert.match(news, /Punto extra diario/);
  assert.doesNotMatch(news, /Reconocimientos y novedades/);
  assert.match(home, /Próximas fechas límite/);
  assert.match(home, /editorServiceSummaries\(job, editor\?\.id \|\| null\)/);
  assert.match(home, /EditorNewsWorkspace/);
  assert.match(home, /React\.useState<"principal" \| "news">\("principal"\)/);
  assert.match(home, /homeTab === "principal"/);
  assert.match(home, /homeTab === "news"/);
  assert.match(home, /role="tablist" aria-label="Secciones de Inicio"/);
  assert.doesNotMatch(home, /Cinco prioridades/);
  assert.doesNotMatch(home, /Configurar en Finanzas/);
  assert.match(home, /Objetivo actual/);
  assert.match(news, /<h2 className="font-semibold text-white">Novedades<\/h2>/);
  assert.match(news, /Megaphone/);
  assert.match(news, /setInterval\(\(\) => setReferenceNow\(Date\.now\(\)\), 1_000\)/);
  assert.match(editorHomeRecognitionsMigration, /editor_daily_ranking_points/);
  assert.match(editorHomeRecognitionsMigration, /pg_advisory_xact_lock/);
  assert.match(editorHomeRecognitionsMigration, /interval '24 hours'/);
  assert.match(editorHomeRecognitionsMigration, /editor_weekly_recognitions/);
  assert.match(editorHomeRecognitionsMigration, /unique \(organization_id, week_start\)/);
  assert.match(editorHomeRecognitionsMigration, /claim_daily_ranking_point_as_editor/);
  assert.match(editorHomeRecognitionsRealtimeMigration, /editor_daily_ranking_points/);
  assert.match(editorHomeRecognitionsRealtimeMigration, /editor_weekly_recognitions/);
  assert.match(previewDailyPointFixMigration, /target_editor\.user_id is not null/);
  assert.match(previewDailyPointFixMigration, /actor.role in \('owner'::public\.app_role, 'admin'::public\.app_role\)/);
  assert.match(previewDailyPointFixMigration, /claim_daily_ranking_point_as_editor/);
});

test("keeps administrator Equipo inside current team and hiring sections", () => {
  const team = source.slice(
    source.indexOf("function TeamCurrentWorkspace"),
    source.indexOf("function TeamPerformanceOverview"),
  );
  const teamView = source.slice(
    source.indexOf("function TeamView"),
    source.indexOf("function TeamCurrentWorkspace"),
  );
  assert.match(teamView, /return <TeamCurrentWorkspace/);
  assert.match(team, />Equipo actual</);
  assert.match(team, />Contratación</);
  assert.match(team, /Personas actuales/);
  assert.match(team, /Comparativa histórica/);
  assert.match(team, /Abrir equipo/);
  assert.match(team, /Abrir contratación/);
  assert.match(team, /TeamHiringWorkspace/);
  assert.match(team, /isEditorialEditor\(editor, directoryUsers\)/);
  assert.match(team, /NegoBot/);
  assert.match(team, /hasRealWork/);
  assert.match(team, /TeamMonthRankingSection/);
  assert.doesNotMatch(team, /clients\.forEach/);
  assert.doesNotMatch(team, /Editores evaluables/);
  assert.match(team, /Ingresos acumulados/);
  assert.doesNotMatch(team, />Acceso</);
  assert.doesNotMatch(team, />Alta</);
});
