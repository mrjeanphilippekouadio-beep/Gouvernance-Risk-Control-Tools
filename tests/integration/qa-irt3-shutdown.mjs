// QA I-RT3-01 : arrêt propre d'un VRAI process backend contre PostgreSQL LOCAL (grc_qa_irt3, 127.0.0.1:55442). Jamais Neon.
// Prérequis : bash tests/integration/qa-visibility-v1-setup.sh up grc_qa_irt3. Usage : node tests/integration/qa-irt3-shutdown.mjs
// Oracles (écrits avant exécution) :
//  S1  SIGTERM pendant une requête (corps lent) qui déclenche un envoi Telegram de 1500 ms : la requête répond 201, l'envoi se termine
//      (marqueur), journal "2 in-flight send(s) awaited, 0 abandoned" (corrige apres 1re execution : le notify Telegram ET le processRequest D5 lance a res.end sont tous deux suivis ; l oracle initial "1" oubliait D5), exit 0, sortie avant le délai de 10 s.
//  S2  envoi bloqué, SHUTDOWN_DRAIN_MS=2000, requête terminée avant le signal : exit 0 vers 2 s (1,6 à 3 s), journal "1 abandoned".
//  S3  envoi bloqué, requête terminée à 0,8 x délai après le signal : sortie mesurée (si additif : ~1,8 x délai ; sinon ~délai).
//  S4  second signal pendant un drain bloqué : exit 1 en moins de 1 s après le second signal.
//  S5  SHUTDOWN_DRAIN_MS = -1 / 120001 / abc / 1.5 : le process refuse de démarrer (exit != 0, aucune écoute) ; 0 et 120000 démarrent.
//  S6  SIGINT : même chemin que SIGTERM (exit 0).
//  S7  sans rien en vol : sortie quasi immédiate, exit 0.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BACKEND = join(ROOT, "backend");
const DB = "grc_qa_irt3";
const PSQL = ["-X", "-q", "-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", DB];
const TMP = mkdtempSync(join(tmpdir(), "qa-irt3-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
function check(name, ok, detail = "") { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`); }

const SALT = "aabbccddeeff0011";
const HASH = `scrypt$${SALT}$${execFileSync("node", ["-e", `process.stdout.write(require("crypto").scryptSync("whatever","${SALT}",64).toString("hex"))`]).toString()}`;
const USERS = JSON.stringify(["own", "adm"].map((n) => ({ email: `${n}@vv1.test`, passwordHash: HASH })));
execFileSync("psql", [...PSQL, "-c", "update users set roles = roles || '{feedback.create}' where email='own@vv1.test' and not ('feedback.create' = any(roles))"]);

let nextPort = 8191;
function start(extra = {}) {
  const port = nextPort++;
  const tgFile = join(TMP, `tg-${port}.txt`);
  writeFileSync(tgFile, "");
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "development", APP_ENV: "development", PORT: String(port),
    DATABASE_URL: `postgresql://postgres@127.0.0.1:55442/${DB}`, AUTH_PROVIDER: "local", LOCAL_AUTH_USERS_JSON: USERS,
    LOCAL_AUTH_TOKEN_SECRET: "q".repeat(48), CORS_ALLOWED_ORIGINS: "http://127.0.0.1:5199",
    TELEGRAM_BOT_TOKEN: "qa-fake-token", TELEGRAM_CHAT_ID: "1", QA_TG_FILE: tgFile, ...extra,
  };
  const child = spawn("node", ["--import", "tsx", "--import", join(ROOT, "tests/integration/qa-irt3-preload.mjs"), "src/server.ts"], { cwd: BACKEND, env });
  const p = { port, child, tgFile, log: "", exit: null, exitAt: 0 };
  child.stdout.on("data", (d) => (p.log += d)); child.stderr.on("data", (d) => (p.log += d));
  p.done = new Promise((res) => child.on("exit", (code, sig) => { p.exit = { code, sig }; p.exitAt = Date.now(); res(p.exit); }));
  return p;
}
async function ready(p) {
  for (let i = 0; i < 80; i++) {
    if (p.exit) return false;
    if (await new Promise((r) => { const s = net.connect(p.port, "127.0.0.1", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); })) return true;
    await sleep(500);
  }
  return false;
}
async function token(p) {
  const r = await fetch(`http://127.0.0.1:${p.port}/api/v1/auth/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "own@vv1.test", password: "whatever" }) });
  return (await r.json()).accessToken;
}
const BODY = JSON.stringify({ category: "BUG", message: "qa irt3" });
/** POST feedback ; si splitAfterMs, envoie les en-têtes + début du corps, attend, puis le reste. */
function postFeedback(p, tok, splitAfterMs = 0) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: p.port, path: "/api/v1/feedback", method: "POST", agent: false,
      headers: { "content-type": "application/json", authorization: `Bearer ${tok}`, "content-length": Buffer.byteLength(BODY) } }, (res) => {
      res.resume(); res.on("end", () => resolve({ status: res.statusCode, endAt: Date.now(), conn: res.headers.connection }));
    });
    req.on("error", (e) => resolve({ status: 0, error: e.code, endAt: Date.now() }));
    if (!splitAfterMs) { req.end(BODY); return; }
    req.write(BODY.slice(0, 5));
    setTimeout(() => req.end(BODY.slice(5)), splitAfterMs);
  });
}
const stopAndWait = async (p) => { if (!p.exit) { p.child.kill("SIGKILL"); await p.done; } };
const tgDone = (p) => readFileSync(p.tgFile, "utf8").split("\n").filter(Boolean).length;
const shutdownLine = (p) => p.log.split("\n").find((l) => /Shutdown:/.test(l)) ?? "(aucune ligne Shutdown)";

const alive = [];
try {
  { // S1
    const p = start({ QA_TG_MODE: "delay:1500" }); alive.push(p);
    if (!(await ready(p))) throw new Error("S1 non demarre\n" + p.log);
    const tok = await token(p);
    const req = postFeedback(p, tok, 600);
    await sleep(200); const t0 = Date.now(); p.child.kill("SIGTERM");
    const r = await req; const ex = await p.done; const dt = p.exitAt - t0;
    check("S1 requete en cours terminee 201", r.status === 201, JSON.stringify(r));
    check("S1 envoi attendu (marqueur)", tgDone(p) === 1);
    check("S1 journal 2 awaited (notify Telegram + D5 processRequest) / 0 abandoned", /2 in-flight send\(s\) awaited, 0 abandoned/.test(p.log), shutdownLine(p));
    check("S1 exit 0", ex.code === 0, JSON.stringify(ex));
    check("S1 delai < 10 s", dt < 10000, `${dt} ms (requete finie a ${r.endAt - t0} ms ; envoi 1500 ms)`);
    console.log(`INFO S1 SIGTERM->exit = ${dt} ms ; en-tete Connection de la reponse: ${r.conn}`);
  }
  { // S2
    const p = start({ QA_TG_MODE: "hang", SHUTDOWN_DRAIN_MS: "2000" }); alive.push(p);
    if (!(await ready(p))) throw new Error("S2 non demarre\n" + p.log);
    const tok = await token(p);
    const r = await postFeedback(p, tok); await sleep(300);
    const t0 = Date.now(); p.child.kill("SIGTERM");
    const ex = await p.done; const dt = p.exitAt - t0;
    check("S2 requete 201 avant signal", r.status === 201);
    check("S2 exit 0", ex.code === 0, JSON.stringify(ex));
    check("S2 sortie ~ SHUTDOWN_DRAIN_MS", dt >= 1600 && dt <= 3000, `${dt} ms`);
    check("S2 journal 1 abandoned", /1 in-flight send\(s\) awaited, 1 abandoned at the 2000 ms/.test(p.log), shutdownLine(p));
    console.log(`INFO S2 SIGTERM->exit = ${dt} ms`);
  }
  { // S4
    const p = start({ QA_TG_MODE: "hang", SHUTDOWN_DRAIN_MS: "8000" }); alive.push(p);
    if (!(await ready(p))) throw new Error("S4 non demarre\n" + p.log);
    const tok = await token(p);
    await postFeedback(p, tok); await sleep(300);
    p.child.kill("SIGTERM"); await sleep(1000);
    const t1 = Date.now(); p.child.kill("SIGTERM"); const ex = await p.done; const dt = p.exitAt - t1;
    check("S4 second signal -> exit 1", ex.code === 1, JSON.stringify(ex));
    check("S4 sortie immediate", dt < 1000, `${dt} ms`);
    check("S4 journal forced exit", /received again: forced exit/.test(p.log));
  }
  { // S3 : requete terminee a 0,8 x delai apres le signal, envoi bloque
    const D = 4000;
    const p = start({ QA_TG_MODE: "hang", SHUTDOWN_DRAIN_MS: String(D) }); alive.push(p);
    if (!(await ready(p))) throw new Error("S3 non demarre\n" + p.log);
    const tok = await token(p);
    const req = postFeedback(p, tok, 3200);
    await sleep(200); const t0 = Date.now(); p.child.kill("SIGTERM");
    const r = await req; const ex = await p.done; const dt = p.exitAt - t0;
    check("S3 requete 201", r.status === 201, JSON.stringify(r));
    check("S3 exit 0", ex.code === 0);
    console.log(`MESURE S3 SHUTDOWN_DRAIN_MS=${D} ; requete finie a ${r.endAt - t0} ms ; SIGTERM->exit = ${dt} ms ; ratio ${(dt / D).toFixed(2)} ; ${shutdownLine(p)}`);
    check("S3 les deux attentes s'additionnent (exit > 1,5 x delai) ?", dt > 1.5 * D, `${dt} ms pour un delai de ${D} ms`);
  }
  { // S6 SIGINT
    const p = start({ QA_TG_MODE: "delay:800" }); alive.push(p);
    if (!(await ready(p))) throw new Error("S6 non demarre\n" + p.log);
    const tok = await token(p); await postFeedback(p, tok);
    p.child.kill("SIGINT"); const ex = await p.done;
    check("S6 SIGINT exit 0 et envoi attendu", ex.code === 0 && tgDone(p) === 1 && /SIGINT received/.test(p.log), JSON.stringify(ex));
  }
  { // S7 rien en vol
    const p = start({}); alive.push(p);
    if (!(await ready(p))) throw new Error("S7 non demarre\n" + p.log);
    await sleep(500); const t0 = Date.now(); p.child.kill("SIGTERM"); const ex = await p.done; const dt = p.exitAt - t0;
    check("S7 rien en vol : exit 0 rapide", ex.code === 0 && dt < 2000, `${dt} ms`);
  }
  for (const bad of ["-1", "120001", "abc", "1.5"]) { // S5
    const p = start({ SHUTDOWN_DRAIN_MS: bad }); alive.push(p);
    const t0 = Date.now(); const ex = await Promise.race([p.done, sleep(30000).then(() => null)]);
    check(`S5 SHUTDOWN_DRAIN_MS=${bad} refuse de demarrer`, ex !== null && ex.code !== 0 && !/listening on port/.test(p.log), `${JSON.stringify(ex)} en ${Date.now() - t0} ms ; ${p.log.split("\n").find((l) => /SHUTDOWN/.test(l)) ?? ""}`);
    await stopAndWait(p);
  }
  for (const ok of ["0", "120000"]) {
    const p = start({ SHUTDOWN_DRAIN_MS: ok }); alive.push(p);
    const up = await ready(p); await sleep(500);
    if (up) p.child.kill("SIGTERM");
    const ex = await Promise.race([p.done, sleep(8000).then(() => null)]);
    check(`S5 SHUTDOWN_DRAIN_MS=${ok} demarre et s'arrete`, up && ex?.code === 0, JSON.stringify(ex));
    await stopAndWait(p);
  }
} catch (e) { fails++; console.log("ERREUR", e.message); }
finally {
  for (const p of alive) await stopAndWait(p); // arrêt par pid de ce que le script a lancé
}
console.log(`\n${fails === 0 ? "TOUT PASS" : fails + " ECHEC(S)"}`);
process.exit(fails ? 1 : 0);
