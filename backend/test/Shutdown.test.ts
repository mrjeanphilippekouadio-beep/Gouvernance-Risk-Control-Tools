import { describe, it, expect } from "vitest";
import { InFlightRegistry, trackedNotifier } from "../src/shutdown.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("InFlightRegistry (I-RT3-01)", () => {
  it("attend les promesses en vol", async () => {
    const reg = new InFlightRegistry();
    let done = false;
    reg.track(sleep(30).then(() => { done = true; }));
    expect(reg.size).toBe(1);
    const res = await reg.drain(1000);
    expect(done).toBe(true);
    expect(res).toEqual({ awaited: 1, abandoned: 0 });
    expect(reg.size).toBe(0);
  });

  it("respecte le délai maximum et compte les abandons", async () => {
    const reg = new InFlightRegistry();
    reg.track(new Promise<void>(() => undefined));
    const t0 = Date.now();
    const res = await reg.drain(50);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(res).toEqual({ awaited: 1, abandoned: 1 });
  });

  it("un envoi en échec ne bloque pas l'arrêt", async () => {
    const reg = new InFlightRegistry();
    reg.track(Promise.reject(new Error("telegram 500"))).catch(() => undefined);
    reg.track(sleep(10));
    const res = await reg.drain(1000);
    expect(res.abandoned).toBe(0);
  });

  it("trackedNotifier enregistre l'envoi sans changer son résultat", async () => {
    const reg = new InFlightRegistry();
    const n = trackedNotifier({ notify: () => sleep(10) }, reg);
    const p = n.notify("x");
    expect(reg.size).toBe(1);
    await p;
    await reg.drain(100);
    const bad = trackedNotifier({ notify: () => Promise.reject(new Error("boom")) }, reg);
    await expect(bad.notify("x")).rejects.toThrow("boom");
  });
});
