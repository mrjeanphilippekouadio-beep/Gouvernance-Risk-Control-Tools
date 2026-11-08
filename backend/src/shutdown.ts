import type { Notifier } from "./infrastructure/notifications/Notifier.js";

/**
 * I-RT3-01: some mandatory notifications leave AFTER the HTTP response (fire-and-forget). On SIGTERM they must be
 * awaited, otherwise the instance stop loses them. The registry only remembers the promises in flight; it never
 * changes their outcome (a rejection is swallowed on the tracking branch only, the caller keeps its own handling).
 */
export class InFlightRegistry {
  private readonly pending = new Set<Promise<unknown>>();

  track<T>(promise: Promise<T>): Promise<T> {
    const entry: Promise<unknown> = promise.then(
      () => undefined,
      () => undefined,
    );
    this.pending.add(entry);
    void entry.then(() => this.pending.delete(entry));
    return promise;
  }

  get size(): number {
    return this.pending.size;
  }

  /**
   * Waits for the sends in flight until `deadline` (epoch ms). Loops so that sends registered AFTER it started
   * (slow request ending during the stop) are awaited too (SEC-IRT3-02). `abandoned` = still pending at the end.
   */
  async drain(deadline: number): Promise<{ awaited: number; abandoned: number }> {
    const seen = new Set<Promise<unknown>>();
    while (this.pending.size > 0 && Date.now() < deadline) {
      const snapshot = [...this.pending];
      snapshot.forEach((p) => seen.add(p));
      await raceDeadline(Promise.allSettled(snapshot), deadline);
    }
    this.pending.forEach((p) => seen.add(p));
    return { awaited: seen.size, abandoned: this.pending.size };
  }
}

/** Resolves with `true` if `p` resolved before `deadline`, `false` at the deadline. */
async function raceDeadline(p: Promise<unknown>, deadline: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([p.then(() => true as const), timeout]); // a rejection of `p` propagates
  } finally {
    clearTimeout(timer);
  }
}

/** Wraps a Notifier so every `notify` is registered; behaviour (resolve/reject) is unchanged. */
export function trackedNotifier(inner: Notifier, registry: InFlightRegistry): Notifier {
  return { notify: (message) => registry.track(inner.notify(message)) };
}

interface StoppableServer {
  close(cb?: () => void): unknown;
  closeIdleConnections(): void;
  closeAllConnections(): void;
}

/**
 * SEC-IRT3-01/02/03: ONE deadline, computed at the first signal, for the three steps: running requests, in-flight
 * sends, pool close. Idle keep-alive sockets are closed repeatedly (they would otherwise hold `server.close` until
 * keepAliveTimeout); at the deadline every remaining socket is cut. Returns the process exit code (1 if the deadline
 * was hit before the server was closed, or if the pool could not be closed in time).
 */
export async function gracefulShutdown(opts: {
  server: StoppableServer;
  registry: InFlightRegistry;
  closePool: () => Promise<void>;
  budgetMs: number;
  log: (line: string) => void;
}): Promise<number> {
  const deadline = Date.now() + opts.budgetMs;
  let code = 0;

  const closed = new Promise<void>((resolve) => opts.server.close(() => resolve()));
  opts.server.closeIdleConnections();
  const idleSweep = setInterval(() => opts.server.closeIdleConnections(), 100);
  const serverClosed = await raceDeadline(closed, deadline);
  clearInterval(idleSweep);
  if (!serverClosed) {
    opts.server.closeAllConnections();
    opts.log("Shutdown: deadline reached with requests still running, connections cut.");
    code = 1;
  }

  const { awaited, abandoned } = await opts.registry.drain(deadline);
  opts.log(`Shutdown: ${awaited} in-flight send(s) awaited, ${abandoned} abandoned (budget ${opts.budgetMs} ms).`);

  let poolClosed = false;
  try {
    poolClosed = await raceDeadline(opts.closePool().then(() => undefined), deadline);
    if (!poolClosed) opts.log("Shutdown: pool close exceeded the deadline.");
  } catch (err) {
    // Name only: the raw message may carry the database host.
    opts.log(`Shutdown: pool close failed (${err instanceof Error ? err.name : "Error"}).`);
  }
  if (!poolClosed) code = 1;
  return code;
}
