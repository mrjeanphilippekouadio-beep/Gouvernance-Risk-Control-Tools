// QA conservation L2c : parcours navigateur (Chromium) de la carte « Restrictions d'accès à revoir » contre le VRAI backend (tsx, PostgreSQL 16 LOCAL, jamais Neon).
// Tete 009b6b3 (revue par ressource, route POST /visibility-reviews/:type/:id/confirm). Oracles ecrits AVANT l'execution.
//
// ORACLES
//  1. rm (Risk Manager, droit + groupe) : la carte affiche « N restriction(s) active(s) ... depuis plus de 12 mois », une ligne par ressource avec un bouton
//     « Confirmer » ; apres un clic : message « Revue confirmée. », la ligne disparait, base : UNE ligne d'audit sur la ressource, sans texte ni reference.
//  2. Deux ressources dues : un clic ne retire QUE la ressource confirmee (revue par ressource).
//  3. com, aud (groupes qui voient tout) : carte et liste visibles, AUCUN bouton. adm (droit, hors groupes) et out (lecteur ordinaire) : le nombre SANS les NOMINATIF, pas de liste, pas de bouton.
//  4. Rejeu perime (deja confirme ailleurs) : un message explique l'echec et la ligne perimee disparait ; panne serveur (500) : un message d'erreur est affiche, la ligne reste, rien n'est ecrit.
//     Un echec silencieux (aucun message) est un defaut.
//  5. L'ecran ne recalcule rien : canConfirm=false en vol -> plus de bouton ; canConfirm=true force pour com -> bouton affiche mais le serveur refuse (403) : le bouton n'est pas une autorisation.
//  6. Le Journal d'audit (aud) s'ouvre apres une revue ; aucun texte de motif dans le DOM ; zero erreur JS, aucune erreur console imprevue.
//
// Prerequis : qa-visibility-v2-setup.sh up grc_qa_l2cp ; QA_PORT=8125 QA_DB=grc_qa_l2cp QA_CORS=http://127.0.0.1:5224 qa-visibility-v2-server.sh start ;
// vite 127.0.0.1:5224 (VITE_AUTH_PROVIDER=local, VITE_API_BASE_URL=http://127.0.0.1:8125). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB.
import { checkNoErrors, finish, localApi, openSession, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8125";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5224";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/l2c";
mkdirSync(SHOTS, { recursive: true });
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", process.env.QA_DB ?? "grc_qa_l2cp", "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG, "-c", q], { encoding: "utf8" }).trim();
const I = (x) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const T = I("001");
const NAMES = ["rm", "adm", "com", "aud", "out"];
const EMAIL = Object.fromEntries(NAMES.map((n) => [n, `${n}@vv1.test`]));
const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const CANARY = "CANARY-L2C-PW-SECRET";
const MENU = "Santé de la gouvernance";
const CARD = "Restrictions d'accès à revoir";

const risk = (age, visibility = "NOMINATIF") => sql(`insert into risks (tenant_id, process, description, visibility, owner_department_id, created_at) values ('${T}', 'QA-L2C-PW', 'QA-L2C-PW risk', '${visibility}', '${I("201")}', now() - interval '${age}') returning id`).split("\n")[0];
const reset = () => sql(`update risks set deleted_at = now() where process = 'QA-L2C-PW' and deleted_at is null`);
const reviewRows = (id) => sql(`select count(*) from audit_log where entity_id = '${id}' and new_value->>'event' = 'VISIBILITY_REVIEW' and reason is null and reason_ref is null and old_value::text not like '%${CANARY}%' and new_value::text not like '%${CANARY}%'`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const sessions = [];
const btn = (s, id) => s.page.getByRole("button", { name: `Confirmer la revue ${id}` });
const anyBtn = (s) => s.page.getByRole("button", { name: /^Confirmer la revue / });
const alerts = (s) => s.page.locator("main [role=alert]").allInnerTexts();

try {
  sql(`update users set roles = roles || array['governancehealth.read','audit.read']::text[] where email in ('rm@vv1.test','com@vv1.test','aud@vv1.test','adm@vv1.test','out@vv1.test')`);
  // un motif au texte « secret » existe en base : il ne doit jamais apparaitre a l'ecran
  sql(`insert into visibility_reasons (tenant_id, source, text) values ('${T}', 'VISIBILITY_CHANGE', '${CANARY}')`);
  for (const w of NAMES) await login(w);
  const a = risk("13 months"); const b = risk("14 months"); const c = risk("15 months", "PERIMETRE");

  const R = await openSession(browser, { app: APP, email: EMAIL.rm, shots: SHOTS, who: "rm" });
  sessions.push(R);
  const open = async (s) => { await s.go("Registre"); await s.go(MENU); };
  await open(R);
  await R.shot("rm-card");
  let text = await R.text();
  check("1.1 rm : la carte « Restrictions d'accès à revoir » est affichee", text.includes(CARD), text.slice(0, 120));
  check("1.2 rm : le compteur dit 3 restrictions et 12 mois", /3 restriction\(s\) active\(s\) non revue\(s\) depuis plus de 12 mois/.test(text), (text.match(/\d+ restriction\(s\)[^.]*/) ?? [""])[0]);
  check("1.3 rm : un bouton « Confirmer » par ligne (3)", (await anyBtn(R).count()) === 3, String(await anyBtn(R).count()));
  check("1.4 aucun texte de motif dans le DOM", !(await R.page.content()).includes(CANARY));
  check("1.5 la ressource est donnee par son type et son identifiant (RISK <uuid>), la plus ancienne d'abord", text.includes(`RISK ${a}`) && text.indexOf(`RISK ${c}`) < text.indexOf(`RISK ${b}`) && text.indexOf(`RISK ${b}`) < text.indexOf(`RISK ${a}`), "");

  // 5a. l'ecran ne recalcule pas : canConfirm=false en vol
  await R.page.route(/\/api\/v1\/governance-health$/, async (route) => {
    const resp = await route.fetch();
    const body = await resp.json();
    body.data.visibilityReview.canConfirm = false;
    await route.fulfill({ response: resp, json: body });
  });
  await open(R);
  check("5.1 canConfirm=false force en vol : plus aucun bouton, les lignes restent", (await anyBtn(R).count()) === 0 && (await R.text()).includes(`RISK ${a}`));
  await R.page.unroute(/\/api\/v1\/governance-health$/);

  // 4a. panne serveur
  await R.page.route(/\/api\/v1\/visibility-reviews\/.+\/confirm$/, (route) => route.fulfill({ status: 500, json: { error: "Erreur interne.", requestId: "REQ-QA" } }));
  await open(R);
  const a0 = (await alerts(R)).length;
  await btn(R, a).click();
  await sleep(1200);
  text = await R.text();
  const a1 = await alerts(R);
  await R.shot("rm-500");
  check("4.1 500 : un message d'erreur (role=alert) est affiche et la ligne reste", a1.length > a0 && text.includes(`RISK ${a}`), `alertes ${a0} -> ${a1.length}`);
  check("4.2 500 : rien n'est ecrit", (await reviewRows(a)) === "0");
  await R.page.unroute(/\/api\/v1\/visibility-reviews\/.+\/confirm$/);

  // 4b. rejeu perime : la ressource est confirmee ailleurs avant le clic
  const stale = risk("16 months");
  await open(R);
  const staleBtn = btn(R, stale);
  check("4.3 la ligne perimee est a l'ecran", (await staleBtn.count()) === 1);
  const elsewhere = await api("rm", "POST", `/visibility-reviews/RISK/${stale}/confirm`);
  check("4.4 confirmation ailleurs : 200", elsewhere.status === 200, String(elsewhere.status));
  const b0 = (await alerts(R)).length;
  await staleBtn.click();
  await sleep(1200);
  text = await R.text();
  const b1 = await alerts(R);
  check("4.5 clic perime (404) : un message est affiche (role=alert)", b1.length > b0, `alertes ${b0} -> ${b1.length}`);
  check("4.6 clic perime (404) : la page tient, la ligne perimee est retiree de l'ecran", text.includes(CARD) && !text.includes(`RISK ${stale}`), `ligne encore la: ${text.includes(`RISK ${stale}`)}`);
  check("4.7 une seule ligne d'audit de revue pour cette ressource", (await reviewRows(stale)) === "1");
  await R.shot("rm-stale");

  // 1. confirmation nominale + 2. revue par ressource
  await open(R);
  const before = await anyBtn(R).count();
  await btn(R, a).click();
  await sleep(1500);
  text = await R.text();
  const after = await anyBtn(R).count();
  check("1.6 rm : apres clic, « Revue confirmée. » est affiche", text.includes("Revue confirmée."), text.slice(0, 120));
  check("1.7 rm : la ligne confirmee a disparu", !text.includes(`RISK ${a}`));
  check(`2.1 revue par ressource : les autres lignes restent (boutons ${before} -> ${after})`, text.includes(`RISK ${b}`) && text.includes(`RISK ${c}`) && after === before - 1);
  check("1.8 base : une ligne d'audit de revue sur la ressource, sans texte ni reference", (await reviewRows(a)) === "1");
  await R.shot("rm-after");

  // 3. les autres profils (restent dues : b NOMINATIF, c PERIMETRE)
  for (const w of ["adm", "com", "aud", "out"]) {
    const S = await openSession(browser, { app: APP, email: EMAIL[w], shots: SHOTS, who: w });
    sessions.push(S);
    await open(S);
    const t = await S.text();
    await S.shot(`${w}-card`);
    const nButtons = await anyBtn(S).count();
    if (w === "out" || w === "adm") {
      check(`3.${w} ${w} : « Moins de 5 » (les NOMINATIF ne comptent pas), aucune liste, aucun bouton`, /Moins de 5 restriction\(s\) active\(s\)/.test(t) && !t.includes(`RISK ${b}`) && !t.includes(`RISK ${c}`) && nButtons === 0, (t.match(/(\d+|Moins de 5) restriction\(s\)[^.]*/) ?? ["pas de carte"])[0]);
    } else {
      check(`3.${w} ${w} : carte et lignes visibles (2), AUCUN bouton`, t.includes(CARD) && t.includes(`RISK ${b}`) && t.includes(`RISK ${c}`) && nButtons === 0, `btn=${nButtons}`);
    }
    check(`6.${w} ${w} : aucun texte de motif dans le DOM`, !(await S.page.content()).includes(CANARY));
  }

  // 5b. le bouton n'est pas une autorisation : com voit un bouton force en vol, le serveur refuse
  const C = sessions[2];
  await C.page.route(/\/api\/v1\/governance-health$/, async (route) => {
    const resp = await route.fetch();
    const body = await resp.json();
    body.data.visibilityReview.canConfirm = true;
    await route.fulfill({ response: resp, json: body });
  });
  await open(C);
  const forced = btn(C, b);
  check("5.2 com, canConfirm=true force en vol : le bouton apparait", (await forced.count()) === 1);
  await forced.click();
  await sleep(1200);
  check("5.3 le serveur refuse (403) : rien n'est ecrit", (await reviewRows(b)) === "0");
  const dlg = await C.page.locator("dialog[open], [role=dialog], [role=alertdialog]").allInnerTexts();
  check("5.4 le refus 403 est explique a l'ecran (boite globale « droit »)", dlg.some((x) => /droit/i.test(x)), dlg.join("|").slice(0, 160));
  await C.page.unroute(/\/api\/v1\/governance-health$/);

  // 6. le Journal d'audit s'ouvre et le journal API sert la ligne de revue
  const A = sessions[3];
  await A.go("Registre");
  await A.go("Journal d'audit");
  await sleep(800);
  const journal = await A.text();
  await A.shot("aud-journal");
  check("6.1 aud : le Journal d'audit s'ouvre et ne montre aucun texte de motif", journal.length > 100 && !journal.includes(CANARY), journal.slice(0, 100));
  const apiLog = await api("aud", "GET", `/audit-log?entityType=Risk&entityId=${a}`);
  check("6.2 l'API du journal sert la ligne de revue de la ressource (UPDATE, sans texte)", apiLog.status === 200 && JSON.stringify(apiLog.json).includes("VISIBILITY_REVIEW") && !JSON.stringify(apiLog.json).includes(CANARY), String(apiLog.status));

  reset();
  checkNoErrors(check, sessions, "7");
} catch (e) {
  check("parcours sans exception", false, String(e).slice(0, 400));
} finally {
  await finish(browser, failures);
}
