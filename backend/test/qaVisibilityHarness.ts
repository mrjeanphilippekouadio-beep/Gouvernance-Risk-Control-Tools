import { expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Pool } from "pg";

/**
 * Shared live harness of the QA visibility suites (V2bis, V3): the V2 data set on the LOCAL cluster of
 * tests/integration/qa-visibility-v1-setup.sh (127.0.0.1:55442, never a remote host), the real server, and the HTTP / SQL helpers.
 */
export const BAD_REASONS: unknown[] = ["", "   ", "\t\n ", "x".repeat(501), null, 5];
export const ROOT = join(__dirname, "..", "..");
const PGPORT = 55442;

export type Res = { status: number; text: string; json: any };
export type AuditRow = { action: string; reason: string | null; old_value: any; new_value: any; user_id: string; entity_type: string };

export function qaVisibilityHarness<W extends string>(opts: { db: string; port: number; who: readonly W[]; uid: Record<W, string> }) {
  const API = `http://127.0.0.1:${opts.port}/api/v1`;
  const script = (name: string) => join(ROOT, "tests", "integration", name);
  const TOK = {} as Record<W, string>;
  let pg: Pool | undefined;
  const sh = (cmd: string, args: string[], env: Record<string, string> = {}) =>
    execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
  const sql = async <T = Record<string, unknown>>(q: string, p: unknown[] = []) => (await pg!.query(q, p)).rows as T[];

  async function call(who: W | null, method: string, path: string, body?: unknown): Promise<Res> {
    const headers = { "content-type": "application/json", ...(who ? { authorization: `Bearer ${TOK[who]}` } : {}) };
    const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, text, json };
  }
  const get = (w: W, p: string) => call(w, "GET", p);
  const audits = (id: string) => sql<AuditRow>(
    "SELECT action, reason, old_value, new_value, user_id, entity_type FROM audit_log WHERE entity_id::text = $1 ORDER BY timestamp, id", [id]);

  return {
    API, TOK, sql, call, get, audits,
    put: (w: W, p: string, b: unknown) => call(w, "PUT", p, b),
    post: (w: W, p: string, b: unknown) => call(w, "POST", p, b),
    permChanges: async (id: string) => (await audits(id)).filter((a) => a.action === "PERMISSION_CHANGE"),
    notifs: (who: W, resourceId: string) => sql<{ event_type: string; message: string }>(
      "SELECT event_type, message FROM notifications WHERE recipient_user_id = $1 AND resource_id = $2 ORDER BY sent_at, id", [opts.uid[who], resourceId]),
    sees: async (w: W, path: string) => (await get(w, path)).status === 200,
    /** Rebuilds the base, starts the server, runs `prepare` (role adjustments by SQL), then logs every profile in. */
    async start(prepare: () => Promise<void>) {
      sh("bash", [script("qa-visibility-v2-setup.sh"), "up", opts.db]);
      sh("bash", [script("qa-visibility-v2-server.sh"), "start"], { QA_PORT: String(opts.port), QA_DB: opts.db });
      pg = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: opts.db, max: 4 });
      await prepare();
      for (const w of opts.who) {
        const r = await fetch(`${API}/auth/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${w}@vv1.test`, password: "whatever" }) });
        TOK[w] = ((await r.json()) as { accessToken: string }).accessToken;
        expect(TOK[w], w).toBeTruthy();
      }
    },
    async stop() {
      await pg?.end();
      sh("bash", [script("qa-visibility-v2-server.sh"), "stop"], { QA_PORT: String(opts.port) });
    },
  };
}
