import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = await readFile(`${root}/app/operating-system.tsx`, "utf8");
const monthlyMigration = await readFile(
  `${root}/supabase/migrations/20260831010000_production_monthly_system.sql`,
  "utf8",
);
const reviewDatesMigration = await readFile(
  `${root}/supabase/migrations/20260831016000_review_delivery_dates_madrid.sql`,
  "utf8",
);
const snapshotPeriodMigration = await readFile(
  `${root}/supabase/migrations/20260831017000_production_snapshot_approval_period.sql`,
  "utf8",
);
const finalProductionMigration = await readFile(
  `${root}/supabase/migrations/20260831180000_finalize_production_video_registry.sql`,
  "utf8",
);

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `No se encontró ${start}`);
  assert.notEqual(to, -1, `No se encontró ${end}`);
  return source.slice(from, to);
}

test("keeps the editor home concise and uses the required labels", () => {
  const dashboard = between("function EditorDashboard(", "function ProductionSummary(");
  assert.match(dashboard, /label="Pendiente de entregar"/);
  assert.match(dashboard, /label="Ingresos de este mes"/);
  assert.doesNotMatch(dashboard, /<JobsTable/);
});

test("keeps correction validation exclusively with the administrator", () => {
  const workspace = between("function CorrectionWorkspace(", "function VideoCorrectionsPanel(");
  const correctionPanel = between("function VideoCorrectionsPanel(", "function EditorHistoryRecords(");
  assert.match(workspace, />Aprobar vídeo</);
  assert.doesNotMatch(workspace, />Pedir correcciones</);
  assert.doesNotMatch(correctionPanel, /Marcar como realizada|Realizada por el editor/);
  assert.match(correctionPanel, />Responder</);
  assert.match(correctionPanel, />Enviar nueva versión</);
  assert.match(correctionPanel, /Indicación general/);
  assert.match(correctionPanel, /marcó este vídeo para corrección sin añadir indicaciones concretas/);
  assert.match(correctionPanel, /respondToGeneralInstruction/);
});

test("keeps the editor correction list focused and resets stale details between tabs", () => {
  const operations = between("function Operations(", "function JobsTable(");
  const correctionTable = between("function CorrectionRecordsTable(", "function Operations(");
  assert.match(operations, /key=\{tab\}/);
  assert.match(operations, /showEditorValue=\{editorMode\}/);
  assert.match(operations, /showEditor=\{showEditor\}/);
  assert.match(correctionTable, /Abrir correcciones/);
  assert.match(correctionTable, /No tienes vídeos pendientes de corregir/);
  assert.doesNotMatch(correctionTable, /Pago por vídeo|Fecha de asignación|Fecha límite|>Entregar</);
});

test("opens Correcciones directly and preserves administrator actions", () => {
  const correctionTable = between("function CorrectionRecordsTable(", "function ProductionHistoryDetail(");
  const correctionPanel = between("function VideoCorrectionsPanel(", "function EditorHistoryRecords(");
  const addForm = between("{canReview && adding &&", "{attachmentMessage &&");
  assert.match(correctionTable, /onClick=\{\(\) => setSelectedId\(entry\.item\.id\)\}/);
  assert.match(correctionPanel, />Responder</);
  assert.match(correctionPanel, />Editar</);
  assert.match(correctionPanel, />Eliminar</);
  assert.match(correctionPanel, /Adjuntar archivo/);
  assert.doesNotMatch(addForm, /Adjuntar archivo/);
  assert.doesNotMatch(correctionPanel, /newFiles|setNewFiles/);
  assert.match(correctionPanel, /onDeleteCorrectionAttachment/);
  assert.match(correctionPanel, /const \[visibleFiles/);
  assert.match(correctionPanel, /removeAttachment/);
  assert.match(correctionPanel, /setHiddenFileIds/);
  assert.match(correctionPanel, /const input = event\.currentTarget/);
  assert.match(correctionPanel, /Abrir/);
  assert.match(correctionPanel, /Descargar/);
  assert.match(source, /return insertedFile as JobFile/);
  assert.match(source, /const uploadId = typeof crypto/);
});

test("updates the open correction state before its background refresh resolves", () => {
  const createCorrection = between("async function createCorrection(", "async function updateCorrection(");
  const updateCorrection = between("async function updateCorrection(", "async function deleteCorrection(");
  const addComment = between("async function addReviewComment(", "async function uploadCorrectionAttachment(");
  const uploadAttachment = between("async function uploadCorrectionAttachment(", "async function getAttachmentUrl(");
  const deleteAttachment = between("async function deleteCorrectionAttachment(", "async function createClient(");
  assert.match(source, /const patchLoadedDeliveryItem/);
  assert.match(source, /const patchLoadedCorrection/);
  assert.match(createCorrection, /patchLoadedDeliveryItem\(itemId/);
  assert.match(createCorrection, /delivery_corrections:/);
  assert.match(createCorrection, /void refresh\(\)/);
  assert.match(updateCorrection, /patchLoadedCorrection\(correctionId/);
  assert.match(addComment, /select\("id,author_id,correction_id,timestamp_seconds,body,created_at"\)/);
  assert.match(addComment, /patchLoadedDeliveryItem\(itemId/);
  assert.match(uploadAttachment, /appendLoadedCorrectionFile/);
  assert.match(deleteAttachment, /removeLoadedCorrectionFile\(fileId\)/);
  assert.match(deleteAttachment, /void refresh\(\)/);
});

test("opens administrator and editor history details from every history surface", () => {
  const historyTable = between("function ProductionHistoryTable(", "function CorrectionRecordsTable(");
  const operations = between("function Operations(", "function JobsTable(");
  assert.match(historyTable, /onOpenJob\?\.\(row\.job_id\)/);
  assert.match(historyTable, /productionContentLabel\(row\.quantity, row\.service\)/);
  assert.doesNotMatch(historyTable, /Vídeo \$\{number\(row\.video_number\)\}/);
  assert.match(operations, /openHistoryDetail/);
  assert.match(operations, /<MonthlyProductionArchive[^>]+onOpenJob=\{openHistoryDetail\}/);
  assert.match(source, /function ProductionHistoryDetail\(/);
});

test("clears stale notification targets when navigating", () => {
  const navigation = between("const navigateTo = (nextView: ViewId) => {", "const page = () => {");
  assert.match(source, /const \[navigationRevision, setNavigationRevision\]/);
  assert.match(source, /key=\{`operations-\$\{displayedRole\}-\$\{navigationRevision\}`\}/);
  assert.match(source, /onNotificationTargetHandled\?\.\(\)/);
  assert.match(navigation, /setShowNotifications\(false\)/);
  assert.match(navigation, /setNotificationTarget\(null\)/);
  assert.match(navigation, /setNavigationRevision\(\(value\) => value \+ 1\)/);
  assert.match(source, /<button type="button" onClick=\{\(\) => void openNotification\(notification\)\}/);
  assert.doesNotMatch(source, /<div\s+key=\{notification\.id\}\s+onClick=\{\(\) => void openNotification/);
});

test("uses permanent, Madrid-aware and idempotent monthly periods", () => {
  assert.match(monthlyMigration, /production_periods_one_active_idx/);
  assert.match(monthlyMigration, /Europe\/Madrid/);
  assert.match(monthlyMigration, /pg_advisory_xact_lock/);
  assert.match(monthlyMigration, /unique \(organization_id, period_start\)/i);
  assert.match(monthlyMigration, /on conflict \(period_id\)/i);
  assert.match(monthlyMigration, /cleanup_read_notifications/);
  assert.match(monthlyMigration, /interval '7 days'/);
});

test("registers direct history deliveries without creating automatic charges", () => {
  const createJob = between("async function createJob(", "async function deliver(");
  assert.match(createJob, /draft\.status === "history"/);
  assert.match(createJob, /\.from\("job_deliveries"\)/);
  assert.match(createJob, /delivered_on: draft\.deliveredOn/);
  assert.match(createJob, /billable: false/);
});

test("history calendars are sourced from permanent approved records", () => {
  assert.match(source, /historyRecords=\{tab === "history" \? filteredHistoryRecords/);
  assert.match(source, /row\.approved_at \|\| row\.delivered_at/);
});

test("does not duplicate an individual video as parent delivery and current status", () => {
  const calendars = between("function productionEvents(", "function ProductionCalendar(");
  assert.match(calendars, /!videos\.length && submission\.created_at && include\("delivery"\)/);
  assert.match(calendars, /const videoLabel = number\(item\.video_number\) > 0/);
  assert.match(calendars, /`\$\{item\.id\}:approved`/);
});

test("uses the Madrid day for individual delivery approvals", () => {
  assert.match(reviewDatesMigration, /org_timezone text := 'Europe\/Madrid'/);
  assert.match(reviewDatesMigration, /parent\.created_at at time zone org_timezone/);
  assert.match(reviewDatesMigration, /approval_time at time zone org_timezone/);
  assert.match(reviewDatesMigration, /on conflict \(submission_item_id\)/i);
});

test("keeps monthly snapshots aligned with permanent history", () => {
  assert.match(snapshotPeriodMigration, /i\.reviewed_at at time zone org\.timezone/);
  assert.match(snapshotPeriodMigration, /d\.delivered_on/);
  assert.match(snapshotPeriodMigration, /on conflict \(period_id\)/i);
});

test("keeps operational insights in administrator Production principal", () => {
  const operations = between("function Operations(", "function JobsTable(");
  assert.match(operations, />Principal</);
  assert.match(operations, />Gestión</);
  assert.match(operations, />Historial mensual</);
  assert.doesNotMatch(operations, />Análisis operativo</);
  assert.match(operations, /<MonthlyProductionArchive/);
  assert.doesNotMatch(operations, /<ProductionMetrics/);
  assert.match(source, /function ProductionOverviewFinal/);
  assert.match(source, /label="Riesgo operativo"/);
  assert.match(source, /label="Carga resuelta"/);
});

test("uses only an open team status declaration in the Production strip", () => {
  const statusStrip = between("function ProductionTeamStatusStrip(", "type ProductionBottleneck");
  assert.match(statusStrip, /filter\(\(event\) => !event\.ended_at\)/);
  assert.match(statusStrip, /effectiveActivityStatus\(event\)/);
  assert.match(statusStrip, /Sin estado informado/);
});

test("keeps performance points bounded with three criteria and two deductions", () => {
  const scoring = between("function scoredPerformance(", "function formatPeriodLabel(");
  assert.match(scoring, /scoreEditorPerformance/);
  assert.match(source, /value_weight/);
  assert.match(source, /quality_weight/);
  assert.match(source, /punctuality_weight/);
  assert.match(source, /late_penalty_points/);
  assert.match(source, /correction_penalty_points/);
  assert.match(scoring, /part\.key === "value"/);
  assert.match(scoring, /part\.key === "correction_penalty"/);
});

test("submits partial deliveries atomically and reserves review and correction units", () => {
  const submit = between("async function submitDelivery(", "async function createCorrection(");
  assert.match(submit, /rpc\("submit_delivery_items"/);
  assert.doesNotMatch(submit, /from\("delivery_submissions"\)\.insert/);
  assert.match(finalProductionMigration, /status in \('pending_review', 'changes_requested'\)/);
  assert.match(finalProductionMigration, /La entrega supera las unidades pendientes/);
  assert.match(finalProductionMigration, /jsonb_array_elements\(delivery_items\) with ordinality/);
});

test("keeps a stable video identity for each order", () => {
  assert.match(finalProductionMigration, /add column if not exists job_id uuid references public\.jobs/);
  assert.match(finalProductionMigration, /add column if not exists video_number integer/);
  assert.match(finalProductionMigration, /delivery_submission_items_job_video_unique/);
  assert.match(finalProductionMigration, /for update;/);
  assert.match(source, /productionIdentityLabel\(entry\.item\.video_number\)/);
});

test("freezes approved Production finances without rewriting shared delivery values", () => {
  assert.match(finalProductionMigration, /production_delivery_financial_snapshots/);
  assert.match(finalProductionMigration, /on conflict \(delivery_id\) do nothing/);
  assert.match(finalProductionMigration, /coalesce\(fs\.editor_unit_cost, 0\)/);
  assert.doesNotMatch(finalProductionMigration, /alter table public\.job_deliveries/);
});

test("uses individual records for History and Corrections", () => {
  const historyTable = between("function ProductionHistoryTable(", "function CorrectionRecordsTable(");
  const correctionEntries = between("function correctionVideoEntries(", "function ProductionHistoryTable(");
  assert.match(historyTable, /row\.delivery_id/);
  assert.match(historyTable, /row\.video_number/);
  assert.doesNotMatch(historyTable, />Entregar</);
  assert.match(correctionEntries, /item\.status === "changes_requested"/);
  assert.match(source, /correctionRecords=\{tab === "corrections" \? filteredCorrectionRecords/);
});

test("routes notification deep-links to their exact Production destination", () => {
  const notifications = between("const destination: NotificationTarget", "return {");
  assert.match(notifications, /event\.includes\("approved"\)/);
  assert.match(notifications, /\? "history"/);
  assert.match(notifications, /event\.includes\("changes_requested"\)/);
  assert.match(notifications, /\? "corrections"/);
  assert.match(source, /onNotificationTargetHandled\?\.\(\)/);
});

test("closes monthly periods once without deleting or rewriting their snapshot", () => {
  assert.match(finalProductionMigration, /Europe\/Madrid/);
  assert.match(finalProductionMigration, /pg_advisory_xact_lock/);
  assert.match(finalProductionMigration, /on conflict \(organization_id, period_start\)/);
  assert.match(finalProductionMigration, /on conflict \(period_id\) do nothing/);
  assert.doesNotMatch(finalProductionMigration, /delete from public\.production_period/);
});

test("keeps availability informational and separate from payments", () => {
  const saveActivity = between("async function saveEditorActivity(", "if (loading)");
  assert.match(saveActivity, /rpc\("set_editor_presence_state"/);
  assert.doesNotMatch(saveActivity, /editor_payments|finance_transactions|bonus_movements/);
});
