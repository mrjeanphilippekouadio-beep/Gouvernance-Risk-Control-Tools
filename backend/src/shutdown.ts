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

  /** Waits for the sends in flight, at most `timeoutMs`. `abandoned` = still pending at the deadline. */
  async drain(timeoutMs: number): Promise<{ awaited: number; abandoned: number }> {
    const awaited = this.pending.size;
    if (awaited === 0) return { awaited, abandoned: 0 };
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([Promise.allSettled([...this.pending]), deadline]);
    clearTimeout(timer);
    return { awaited, abandoned: this.pending.size };
  }
}

/** Wraps a Notifier so every `notify` is registered; behaviour (resolve/reject) is unchanged. */
export function trackedNotifier(inner: Notifier, registry: InFlightRegistry): Notifier {
  return { notify: (message) => registry.track(inner.notify(message)) };
}
