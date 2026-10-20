/** Keep a dropped connection from leaving a form pending indefinitely. */
export async function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const originalSignal = init?.signal || request?.signal;
  const controller = new AbortController();
  const abort = () => controller.abort(originalSignal?.reason);
  if (originalSignal?.aborted) abort();
  else originalSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("La conexión ha tardado demasiado", "TimeoutError")), 30_000);
  const startedAt = Date.now();
  // No headers, query strings, payloads or auth tokens enter diagnostics.
  const path = new URL(request?.url || String(input)).pathname;
  try {
    const result = await fetch(input, { ...init, signal: controller.signal });
    if (!result.ok) console.warn("[supabase.request]", { path, status: result.status, elapsedMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    console.warn("[supabase.connection]", { path, elapsedMs: Date.now() - startedAt, aborted: controller.signal.aborted });
    throw error;
  } finally {
    clearTimeout(timer);
    originalSignal?.removeEventListener("abort", abort);
  }
}
