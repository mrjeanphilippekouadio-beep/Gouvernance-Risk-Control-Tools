// QA conservation L2a : parcours navigateur court (Chromium) contre le VRAI backend (tsx, PostgreSQL 16 LOCAL, jamais Neon). Oracles ecrits AVANT l'execution.
//
// ORACLES
//  1. Un changement de visibilite avec un motif contenant des caracteres speciaux (balises, guillemets, esperluette) : « Ressources restreintes » (rm) affiche le
//     motif tel quel (texte, jamais interprete en HTML) ; « Journal d'audit » (aud) l'affiche dans la colonne Motif et dans le detail.
//  2. Le motif est efface en base (propriétaire, la garde l'autorise) : les deux ecrans affichent « motif effacé le 10/11/2026 (conservation) » et plus jamais le texte.
//  3. L'ecran ne recalcule rien : une reponse d'API modifiee en vol (reason -> « VALEUR SERVEUR ») est affichee telle quelle par les deux ecrans.
//  4. Zero erreur JS, aucune erreur console imprevue (hors 4xx attendus).
//
// Prerequis : qa-visibility-v2-setup.sh up grc_qa_l2ap ; QA_PORT=8115 QA_DB=grc_qa_l2ap qa-visibility-v2-server.sh start ;
// vite 127.0.0.1:5199 (VITE_AUTH_PROVIDER=local, VITE_API_BASE_URL=http://127.0.0.1:8115). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB.
import { checkNoErrors, finish, localApi, openSession, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8115";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/l2a";
mkdirSync(SHOTS, { recursive: true });
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", process.env.QA_DB ?? "grc_qa_l2ap", "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG, "-c", q], { encoding: "utf8" }).trim();
const I = (x) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const NAMES = ["rm", "aud"];
const EMAIL = Object.fromEntries(NAMES.map((n) => [n, `${n}@vv1.test`]));
const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);

const REASON = `CANARY-L2A-PW <b>gras</b> & "guillemets" l'apostrophe`;
const GONE = "motif effacé le 10/11/2026 (conservation)";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const sessions = [];

try {
  for (const w of NAMES) await login(w);
  const set = await api("rm", "PUT", `/risks/${I("502")}/visibility`, { visibility: "NOMINATIF", addUserIds: [I("106")], revokeUserIds: [], reason: REASON });
  check("0 le changement de visibilite est accepte", set.status === 200, String(set.status));
  check("0b le motif est stocke a part, pas dans le journal", sql(`select count(*) from audit_log where reason like '%CANARY-L2A-PW%'`) === "0"
    && sql(`select count(*) from visibility_reasons where text like '%CANARY-L2A-PW%'`) === "1");

  const R = await openSession(browser, { app: APP, email: EMAIL.rm, shots: SHOTS, who: "rm" });
  const A = await openSession(browser, { app: APP, email: EMAIL.aud, shots: SHOTS, who: "aud" });
  sessions.push(R, A);

  const screens = async (tag) => {
    // le menu ne recharge pas l'ecran deja ouvert : quitter puis revenir
    await R.go("Journal d'audit");
    await A.go("Ressources restreintes");
    await R.go("Ressources restreintes");
    await R.shot(`restricted-${tag}`);
    const restricted = await R.text();
    await A.go("Journal d'audit");
    await sleep(500);
    await A.shot(`auditlog-${tag}`);
    const journal = await A.text();
    return { restricted, journal };
  };

  // ---- 1. texte special affiche tel quel
  const s1 = await screens("text");
  check("1.1 Ressources restreintes : le motif s'affiche tel quel (balises en texte)", s1.restricted.includes(`<b>gras</b> & "guillemets" l'apostrophe`), s1.restricted.slice(0, 200));
  check("1.2 Journal d'audit : le motif s'affiche dans la colonne Motif", s1.journal.includes("CANARY-L2A-PW"), s1.journal.slice(0, 200));
  check("1.3 aucun element HTML injecte par le motif (pas de <b> dans le DOM de l'ecran)", (await R.page.locator("main b").filter({ hasText: "gras" }).count()) === 0 && (await A.page.locator("main b").filter({ hasText: "gras" }).count()) === 0);
  const row = A.page.locator("main tr", { hasText: "CANARY-L2A-PW" }).first();
  check("1.4 Journal d'audit : une ligne du tableau porte le motif", (await row.count()) === 1, String(await row.count()));
  await row.getByRole("button", { name: "Consulter" }).click();
  await sleep(600);
  const dialog = await A.page.locator("dialog[open], [role=dialog]").first().innerText().catch(() => "");
  check("1.5 Journal d'audit : le detail de la ligne affiche « Motif : » avec le texte", /Motif :\s*CANARY-L2A-PW/.test(dialog), dialog.slice(0, 200));
  await A.page.getByRole("button", { name: "Fermer" }).first().click().catch(() => {});

  // ---- 3. aucune regle recalculee (avant l'effacement, pour que le texte serveur soit la seule cause)
  for (const [sess, label, path] of [[R, "Ressources restreintes", "/restricted-resources"], [A, "Journal d'audit", "/audit-log"]]) {
    await sess.page.route(new RegExp(`/api/v1${path}(\\?.*)?$`), async (route) => {
      const resp = await route.fetch();
      const body = await resp.json();
      const patch = (o) => { if (Array.isArray(o)) o.forEach(patch); else if (o && typeof o === "object") { if ("reason" in o && o.reason) o.reason = "VALEUR SERVEUR"; Object.values(o).forEach(patch); } };
      patch(body);
      await route.fulfill({ response: resp, json: body });
    });
    await sess.go(label === "Journal d'audit" ? "Ressources restreintes" : "Journal d'audit");
    await sess.go(label);
    check(`3 ${label} : la valeur renvoyee par le serveur est affichee telle quelle`, (await sess.text()).includes("VALEUR SERVEUR"), (await sess.text()).slice(0, 160));
    await sess.page.unroute(new RegExp(`/api/v1${path}(\\?.*)?$`));
  }

  // ---- 2. motif efface
  sql(`update visibility_reasons set text = null, erased_at = '2026-11-10T08:00:00Z' where text like '%CANARY-L2A-PW%'`);
  const s2 = await screens("erased");
  check("2.1 Ressources restreintes : « motif effacé le 10/11/2026 (conservation) » et plus le texte", s2.restricted.includes(GONE) && !s2.restricted.includes("CANARY-L2A-PW"), s2.restricted.slice(0, 200));
  check("2.2 Journal d'audit : meme mention, plus le texte", s2.journal.includes(GONE) && !s2.journal.includes("CANARY-L2A-PW"), s2.journal.slice(0, 200));
  const apiList = await api("aud", "GET", `/audit-log?entityType=Risk&entityId=${I("502")}`);
  check("2.3 l'API sert la meme mention (formatee cote serveur)", JSON.stringify(apiList.json).includes(GONE), String(apiList.status));

  checkNoErrors(check, sessions, "4");
} catch (e) {
  check("parcours sans exception", false, String(e).slice(0, 300));
} finally {
  await finish(browser, failures);
}
