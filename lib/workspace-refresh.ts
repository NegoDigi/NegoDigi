export type RefreshScopes = ReadonlySet<string> | null;

type Waiter = { resolve: () => void; reject: (error: unknown) => void };
type RefreshBatch = { scopes: Set<string> | null; waiters: Waiter[] };

/** Serialize refreshes and merge requests received while a refresh is running. */
export function createRefreshCoordinator(
  run: (scopes: RefreshScopes) => Promise<void>,
) {
  let running = false;
  let pending: RefreshBatch | null = null;
  let disposed = false;

  async function drain() {
    running = true;
    while (pending && !disposed) {
      const batch: RefreshBatch = pending;
      pending = null;
      try {
        await run(batch.scopes);
        batch.waiters.forEach(({ resolve }) => resolve());
      } catch (error) {
        batch.waiters.forEach(({ reject }) => reject(error));
      }
    }
    running = false;
  }

  return {
    refresh(scope?: string | readonly string[]): Promise<void> {
      if (disposed) return Promise.reject(new Error("Refresh coordinator disposed"));
      const scopes = scope === undefined ? null : new Set(typeof scope === "string" ? [scope] : scope);
      return new Promise<void>((resolve, reject) => {
        if (!pending) {
          pending = { scopes, waiters: [] };
        } else if (scopes === null) {
          pending.scopes = null;
        } else if (pending.scopes !== null) {
          scopes.forEach((value) => pending!.scopes!.add(value));
        }
        pending.waiters.push({ resolve, reject });
        if (!running) void drain();
      });
    },
    // An already running request cannot be cancelled here. Its caller must guard
    // state commits against a changed authentication/session generation.
    dispose() {
      disposed = true;
      const error = new Error("Refresh coordinator disposed");
      pending?.waiters.forEach(({ reject }) => reject(error));
      pending = null;
    },
  };
}

function hasQueryError(value: unknown): boolean {
  return value !== null && typeof value === "object" && "error" in value && Boolean(value.error);
}

/** Successful query results may be reused until their group changes or TTL expires. */
export function createWorkspaceQueryCache(now: () => number = Date.now) {
  const entries = new Map<string, { value: unknown; savedAt: number }>();
  const inFlight = new Map<string, Promise<unknown>>();
  let generation = 0;

  return {
    async load<T>(
      key: string,
      factory: () => T,
      scopes: RefreshScopes,
      groups: Iterable<string>,
      maxAgeMs = 30_000,
    ): Promise<Awaited<T>> {
      const cached = entries.get(key);
      const invalidated = scopes === null || Array.from(groups).some((group) => scopes.has(group));
      if (!invalidated && cached && now() - cached.savedAt < maxAgeMs) {
        return cached.value as Awaited<T>;
      }
      const existing = inFlight.get(key);
      if (existing) return existing as Promise<Awaited<T>>;

      const requestGeneration = generation;
      // Deferring factory invocation also lets synchronous exceptions follow the
      // same cleanup path as rejected network requests.
      const request = Promise.resolve().then(factory).then((value) => {
        if (generation === requestGeneration) {
          if (hasQueryError(value)) entries.delete(key);
          else entries.set(key, { value, savedAt: now() });
        }
        return value;
      }, (error: unknown) => {
        if (generation === requestGeneration) entries.delete(key);
        throw error;
      }).finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
      inFlight.set(key, request);
      return await request;
    },
    // Clearing on account/workspace changes prevents old in-flight results from
    // repopulating the next account's cache.
    clear() {
      generation += 1;
      entries.clear();
      inFlight.clear();
    },
  };
}
