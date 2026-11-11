// OUTILLAGE DE TEST UNIQUEMENT (QA I-RT3-01). Charge le préchargement F7-S1 (PG local sans TLS, Drive factice), puis remplace
// fetch vers api.telegram.org : aucun appel réseau. QA_TG_MODE = "delay:<ms>" (défaut delay:0) ou "hang" (ne se termine jamais).
// Chaque envoi terminé ajoute une ligne à QA_TG_FILE.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") throw new Error("qa-irt3-preload refuse la production");
await import(fileURLToPath(new URL("./qa-f7s1-test-preload.mjs", import.meta.url)));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("api.telegram.org")) return realFetch(url, init);
  const mode = process.env.QA_TG_MODE ?? "delay:0";
  console.log(`[QA-TG] envoi demarre (${mode})`);
  if (mode === "hang") return new Promise(() => undefined);
  await new Promise((r) => setTimeout(r, Number(mode.split(":")[1])));
  if (process.env.QA_TG_FILE) appendFileSync(process.env.QA_TG_FILE, `done ${Date.now()}\n`);
  console.log("[QA-TG] envoi termine");
  return new Response("{}", { status: 200 });
};
