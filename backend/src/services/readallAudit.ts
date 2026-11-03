import type { ReadScope } from "../domain/visibility.js";
import type { RestrictableResource } from "../domain/repositories/ResourceAccessRepository.js";
import type { ResourceVisibilityManager } from "./resourceVisibility.js";

/**
 * q220 (DECISION-111) / SEC V4-03 / CMP-V4-10: wraps the repository of a restrictable root so that EVERY reader-scoped
 * read (a method whose last argument is a reader scope, `{ all: false, userId }`) records what only resource.readall let
 * the reader see — whoever calls it: root services, children (executions, efficiency, evaluations, decisions, KRIs, KPI
 * measures, evidences), dashboards, the 360 / device views, the map. One place, so no read path can skip the trace.
 * A single row -> one READ row per resource; an array -> one READ row for the list (ids + count); `hiddenIds` -> the
 * requested ids it did NOT hide. Server-internal reads (SYSTEM_SCOPE, `all: true`) are never recorded. Awaited before the
 * result is returned: a failed write fails the read (fail closed).
 */
export function withReadallAudit<R extends object>(repo: R, type: RestrictableResource | "RISK", recorder: Pick<ResourceVisibilityManager, "recordReadallFor">): R {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        const scope = args[args.length - 1] as ReadScope | undefined;
        // Not a reader-scoped read (a write, an internal SYSTEM_SCOPE read): untouched, same return value.
        if (!scope || typeof scope !== "object" || !("all" in scope) || scope.all !== false || !scope.userId) return out;
        const tenantId = args[0] as string;
        const userId = scope.userId;
        return Promise.resolve(out).then(async (result) => {
          if (prop === "hiddenIds") {
            const hidden = new Set(result as string[]);
            await recorder.recordReadallFor(tenantId, userId, type, (args[1] as string[]).filter((id) => !hidden.has(id)), "LIST");
          } else if (Array.isArray(result)) {
            await recorder.recordReadallFor(tenantId, userId, type, result.map((r) => (r as { id?: string }).id).filter((id): id is string => !!id), "LIST");
          } else if (result && typeof result === "object" && typeof (result as { id?: unknown }).id === "string") {
            await recorder.recordReadallFor(tenantId, userId, type, [(result as { id: string }).id], "ONE");
          }
          return result;
        });
      };
    },
  });
}
