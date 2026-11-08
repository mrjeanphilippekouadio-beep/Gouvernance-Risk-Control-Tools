import http from "node:http";
import { describe, it, expect } from "vitest";
import { InFlightRegistry, gracefulShutdown, trackedNotifier } from "../src/shutdown.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("InFlightRegistry (I-RT3-01)", () => {
  it("attend les promesses en vol", async () => {
    const reg = new InFlightRegistry();
    let done = false;
    reg.track(sleep(30).then(() => { done = true; }));
    expect(reg.size).toBe(1);
    const res = await reg.drain(Date.now() + 1000);
    expect(done).toBe(true);
    expect(res).toEqual({ awaited: 1, abandoned: 0 });
    expect(reg.size).toBe(0);
  });

  it("respecte l'échéance et compte les abandons", async () => {
    const reg = new InFlightRegistry();
    reg.track(new Promise<void>(() => undefined));
    const t0 = Date.now();
    const res = await reg.drain(Date.now() + 50);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(res).toEqual({ awaited: 1, abandoned: 1 });
  });

  it("un envoi en échec ne bloque pas l'arrêt", async () => {
    const reg = new InFlightRegistry();
    reg.track(Promise.reject(new Error("telegram 500"))).catch(() => undefined);
    reg.track(sleep(10));
    const res = await reg.drain(Date.now() + 1000);
    expect(res.abandoned).toBe(0);
  });

  it("SEC-IRT3-02 : un envoi enregistré pendant l'attente est attendu et compté", async () => {
    const reg = new InFlightRegistry();
    let late = false;
    reg.track(sleep(30));
    setTimeout(() => reg.track(sleep(60).then(() => { late = true; })), 10);
    const res = await reg.drain(Date.now() + 1000);
    expect(late).toBe(true);
    expect(res).toEqual({ awaited: 2, abandoned: 0 });
  });

  it("SEC-IRT3-02 : un envoi tardif non terminé à l'échéance est compté abandonné", async () => {
    const reg = new InFlightRegistry();
    reg.track(sleep(40));
    setTimeout(() => reg.track(new Promise<void>(() => undefined)), 10);
    const res = await reg.drain(Date.now() + 100);
    expect(res).toEqual({ awaited: 2, abandoned: 1 });
  });

  it("trackedNotifier enregistre l'envoi sans changer son résultat", async () => {
    const reg = new InFlightRegistry();
    const n = trackedNotifier({ notify: () => sleep(10) }, reg);
    const p = n.notify("x");
    expect(reg.size).toBe(1);
    await p;
    await reg.drain(Date.now() + 100);
    const bad = trackedNotifier({ notify: () => Promise.reject(new Error("boom")) }, reg);
    await expect(bad.notify("x")).rejects.toThrow("boom");
  });
});

describe("gracefulShutdown (SEC-IRT3-01/03)", () => {
  async function startServer(reqMs: number, registry: InFlightRegistry, sendMs: number) {
    const server = http.createServer(async (_req, res) => {
      await sleep(reqMs);
      res.end("ok");
      registry.track(sleep(sendMs));
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    return { server, port };
  }

  it("échéance unique : une connexion keep-alive inactive et un envoi lent tiennent dans le budget", async () => {
    const registry = new InFlightRegistry();
    const { server, port } = await startServer(0, registry, 150);
    const agent = new http.Agent({ keepAlive: true });
    await new Promise<void>((resolve) => http.get({ port, agent }, (r) => { r.resume(); r.on("end", resolve); }));
    const logs: string[] = [];
    const t0 = Date.now();
    const code = await gracefulShutdown({ server, registry, closePool: async () => undefined, budgetMs: 1000, log: (l) => logs.push(l) });
    agent.destroy();
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(900); // far below keepAliveTimeout (5 s) and below the budget
    expect(logs.join("\n")).toContain("1 in-flight send(s) awaited, 0 abandoned");
  });

  it("requête qui dépasse l'échéance : connexions coupées, sortie 1, durée totale bornée", async () => {
    const registry = new InFlightRegistry();
    const { server, port } = await startServer(2000, registry, 10);
    http.get({ port }, (r) => r.resume()).on("error", () => undefined);
    await sleep(50);
    const t0 = Date.now();
    const code = await gracefulShutdown({ server, registry, closePool: async () => undefined, budgetMs: 300, log: () => undefined });
    expect(code).toBe(1);
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it("pool.end qui échoue : journalisé (nom seul) et code 1", async () => {
    const registry = new InFlightRegistry();
    const { server } = await startServer(0, registry, 0);
    const logs: string[] = [];
    const code = await gracefulShutdown({
      server,
      registry,
      closePool: () => Promise.reject(new Error("connect ECONNREFUSED db.example.internal")),
      budgetMs: 500,
      log: (l) => logs.push(l),
    });
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("pool close failed (Error)");
    expect(logs.join("\n")).not.toContain("db.example.internal");
  });

  it("pool.end qui ne rend jamais la main : borné par l'échéance, code 1", async () => {
    const registry = new InFlightRegistry();
    const { server } = await startServer(0, registry, 0);
    const t0 = Date.now();
    const code = await gracefulShutdown({ server, registry, closePool: () => new Promise<void>(() => undefined), budgetMs: 200, log: () => undefined });
    expect(code).toBe(1);
    expect(Date.now() - t0).toBeLessThan(700);
  });
});
