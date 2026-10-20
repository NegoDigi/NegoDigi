type ServiceInput = { id: string; service: string; quantity: number };
type AssignmentInput = {
  id: string;
  editorId: string;
  dueOn?: string;
  quantities: Record<string, number>;
};
type ProgressInput = { id: string; delivered: number };
type DateChanges = {
  assigned_on?: string | null;
  planned_on?: string | null;
  due_on?: string | null;
};
export type AtomicJobPayload = DateChanges & {
  id: string;
  mode: "planned" | "pending" | "history" | "update";
  client_id: string;
  delivered_on?: string | null;
  items: (ServiceInput & { is_new: boolean })[];
  assignments: {
    id: string;
    is_new: boolean;
    editor_id: string;
    due_on: string | null;
    quantities: Record<string, number>;
  }[];
  progress: ProgressInput[];
};

const normalizeService = (service: string) =>
  service === "Miniatura" || service === "Miniaturas" ? "Miniaturas" : service;

function assignmentsFor(
  drafts: AssignmentInput[],
  items: ServiceInput[],
  resolvedIds: Map<string, string>,
  existingIds: Set<string>,
  makeId: () => string,
): AtomicJobPayload["assignments"] {
  return drafts
    .filter((assignment) => assignment.editorId && items.some((item) => Number(assignment.quantities[item.id]) > 0))
    .map((assignment) => ({
      id: existingIds.has(assignment.id) ? assignment.id : makeId(),
      is_new: !existingIds.has(assignment.id),
      editor_id: assignment.editorId,
      due_on: assignment.dueOn || null,
      quantities: Object.fromEntries(items.map((item) => [
        resolvedIds.get(item.id)!,
        Number(assignment.quantities[item.id] || 0),
      ])),
    }));
}

export function buildCreateJobPayload(
  draft: {
    status: "planned" | "pending" | "history";
    clientId: string;
    assignedOn: string;
    dueOn: string;
    deliveredOn: string;
    services: ServiceInput[];
    assignments: AssignmentInput[];
  },
  makeId = () => crypto.randomUUID(),
): AtomicJobPayload {
  const services = draft.services.filter((item) => item.service && item.quantity > 0);
  // Map the draft row ID, never the service name: two rows with the same
  // category must retain their own allocation instead of overwriting a Map key.
  const resolvedIds = new Map(services.map((item) => [item.id, makeId()]));
  return {
    id: makeId(),
    mode: draft.status,
    client_id: draft.clientId,
    assigned_on: draft.assignedOn || null,
    due_on: draft.dueOn || null,
    delivered_on: draft.deliveredOn || null,
    items: services.map((item) => ({
      ...item, id: resolvedIds.get(item.id)!, service: normalizeService(item.service), is_new: true,
    })),
    assignments: draft.status === "planned" ? [] : assignmentsFor(draft.assignments, services, resolvedIds, new Set(), makeId),
    progress: [],
  };
}

export function buildUpdateJobPayload(
  job: { id: string; client_id: string; job_assignments?: { id: string }[] | null },
  changes: DateChanges & { client_id?: string },
  items: ServiceInput[],
  progress: ProgressInput[],
  assignments: AssignmentInput[],
  makeId = () => crypto.randomUUID(),
): AtomicJobPayload {
  const resolvedIds = new Map(items.map((item) => [item.id, item.id.startsWith("new-") ? makeId() : item.id]));
  return {
    ...changes,
    id: job.id,
    mode: "update",
    client_id: changes.client_id || job.client_id,
    items: items.map((item) => ({
      ...item,
      id: resolvedIds.get(item.id)!,
      service: normalizeService(item.service),
      is_new: item.id.startsWith("new-"),
    })),
    assignments: assignmentsFor(assignments, items, resolvedIds, new Set((job.job_assignments || []).map((row) => row.id)), makeId),
    progress: progress.map((item) => ({ ...item, id: resolvedIds.get(item.id) || item.id })),
  };
}
