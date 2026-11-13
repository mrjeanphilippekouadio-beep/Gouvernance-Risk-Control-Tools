// QA q266 (DECISION-128) : ligne de compteurs des confirmations du seul Risk Manager, onglet « Exceptions à revoir ».
// VRAI backend (tsx, PostgreSQL 16 LOCAL, jamais Neon). Jeu : qa-visibility-v2-setup.sh (comptes <nom>@vv1.test).
// ORACLES (ecrits avant l'execution)
//  1. Aucune confirmation SOLE_RM : aucune ligne « Confirmations du seul Risk Manager ».
//  2. Trois confirmations (40 j, 5 j, 1 j « sans revue des précédentes »), delai du client non fixe : la ligne dit
//     « 3 non revue(s) sur 3, dont 1 en retard (délai 30 jours) · 1 sans revue des précédentes » = le JSON ; la ligne de 40 j porte « En retard ».
//  3. Delai du client fixe a 3 : « dont 2 en retard (délai 3 jours) ».
//  4. Aucun calcul cote ecran : JSON modifie en vol (unreviewed 99, overdue 7, delai 12) affiche tel quel.
//  5. Une revue (REVIEWED, par rm, tiers) de la confirmation de 40 j : la ligne passe a « 2 non revue(s) sur 3, dont 0 en retard ».
//  6. Zero erreur JS.
// Variables : QA_API, QA_APP, QA_SHOTS, QA_DB.
import { checkNoErrors, finish, localApi, norm, openSession, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8101";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5201";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/q266";
mkdirSync(SHOTS, { recursive: true });
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", process.env.QA_DB ?? "grc_qa_q266p", "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG], { input: q, encoding: "utf8" }).trim();
const I = (x) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const T = I("001");
const EMAIL = { rm: "rm@vv1.test", dept: "dept@vv1.test" };
const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const MENU = "Santé de la gouvernance";
const LINE = /Confirmations du seul Risk Manager : [^]*?\./;

sql(`insert into user_roles (tenant_id, role_id, user_id, granted_by) select '${T}', id, '${I("109")}', '${I("10c")}' from roles where system_group = 'RISK_MANAGER' and tenant_id = '${T}' on conflict do nothing;
     insert into user_roles (tenant_id, role_id, user_id, granted_by) select '${T}', id, '${I("10a")}', '${I("10c")}' from roles where system_group = 'RISK_COMMITTEE' and tenant_id = '${T}' on conflict do nothing;
     insert into configs (tenant_id) values ('${T}') on conflict (tenant_id) do nothing;
     update users set last_seen_at = now();
     update tenants set governance_tracking_started_at = now() - interval '100 days' where id = '${T}'`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const R = await openSession(browser, { app: APP, email: EMAIL.rm, shots: SHOTS, who: "rm" });
const reopen = async () => { await R.go("Registre"); await R.go(MENU); await R.page.getByRole("button", { name: /Exceptions à revoir/ }).click(); await sleep(500); };
const line = async () => (norm(await R.page.locator("main").innerText()).match(LINE) ?? [""])[0];
const mark = (days, rule) => sql(`insert into audit_log (tenant_id, user_id, entity_type, entity_id, action, reason, request_id, governance_exception, "timestamp")
  values ('${T}', '${I("105")}', 'RiskFrameworkChangeRequest', gen_random_uuid(), 'APPROVE', 'Confirmation QA ${days}j', 'qa-q266', '${rule}', now() - interval '${days} days')`);

try {
  await login("rm");
  await reopen();
  check("1 aucune confirmation : pas de ligne des confirmations du seul Risk Manager", (await line()) === "", await line());

  mark(40, "riskFramework.soleRiskManager");
  mark(5, "riskFramework.soleRiskManager");
  mark(1, "riskFramework.soleRiskManager.withoutPriorReview");
  await reopen();
  const json = (await api("rm", "GET", "/governance-health")).json.data;
  const exp = (s) => `Confirmations du seul Risk Manager : ${s.unreviewed} non revue(s) sur ${s.total}, dont ${s.overdue} en retard (délai ${s.reviewDelayDays} jours) · ${s.withoutPriorReview} sans revue des précédentes.`;
  check("2.0 JSON : 3 / 3 / 1 / 1, délai 30", JSON.stringify(json.soleRm) === JSON.stringify({ total: 3, unreviewed: 3, overdue: 1, withoutPriorReview: 1, reviewDelayDays: 30 }), JSON.stringify(json.soleRm));
  check("2.1 la ligne affiche le JSON", (await line()) === exp(json.soleRm), await line());
  const row40 = R.page.locator("table tbody tr").filter({ hasText: "Confirmation QA 40j" });
  check("2.2 la ligne de 40 j porte « En retard », pas celle de 5 j", /En retard/.test(await row40.innerText()) && !/En retard/.test(await R.page.locator("table tbody tr").filter({ hasText: "Confirmation QA 5j" }).innerText()));
  await R.shot("01-line");

  sql(`update configs set exception_review_delay_days = 3 where tenant_id = '${T}'`);
  await reopen();
  check("3 délai du client 3 : « dont 2 en retard (délai 3 jours) »", /dont 2 en retard \(délai 3 jours\)/.test(await line()), await line());

  await R.page.route("**/api/v1/governance-health", async (route) => {
    const resp = await route.fetch();
    const body = await resp.json();
    body.data.soleRm = { total: 120, unreviewed: 99, overdue: 7, withoutPriorReview: 0, reviewDelayDays: 12 };
    await route.fulfill({ response: resp, json: body });
  });
  await reopen();
  check("4 JSON modifié en vol : affiché tel quel, rien de recalculé", (await line()) === exp({ total: 120, unreviewed: 99, overdue: 7, withoutPriorReview: 0, reviewDelayDays: 12 }), await line());
  await R.page.unroute("**/api/v1/governance-health");

  sql(`update configs set exception_review_delay_days = null where tenant_id = '${T}'`);
  await reopen();
  const review = async (S, row) => {
    await row.getByRole("button", { name: /Revoir/ }).click();
    const dlg = S.page.getByRole("dialog");
    await dlg.getByLabel(/Motif/).fill("Revue QA q266");
    await dlg.getByRole("button", { name: "Enregistrer" }).click();
    await sleep(1500);
    return dlg;
  };
  // SEC-Q266-02 : un Risk Manager tiers est refusé (erreur dans la fenêtre, rien d'écrit)
  const refused = await review(R, row40);
  const refusedText = norm(await refused.innerText().catch(() => ""));
  check("5.0 un Risk Manager tiers est refusé : fenêtre ouverte avec une erreur", (await refused.count()) === 1 && /Audit|Comité|refus|droit|Forbidden|erreur/i.test(refusedText), refusedText.slice(0, 200));
  await R.page.keyboard.press("Escape");
  await reopen();
  check("5.1 après le refus : toujours « 3 non revue(s) sur 3 »", /3 non revue\(s\) sur 3/.test(await line()), await line());
  // un membre du Comité peut revoir
  const C = await openSession(browser, { app: APP, email: "com@vv1.test", shots: SHOTS, who: "com" });
  await C.go(MENU);
  await C.page.getByRole("button", { name: /Exceptions à revoir/ }).click();
  await sleep(500);
  await review(C, C.page.locator("table tbody tr").filter({ hasText: "Confirmation QA 40j" }));
  await reopen();
  check("5 après revue par le Comité de la confirmation de 40 j : « 2 non revue(s) sur 3, dont 0 en retard »", /2 non revue\(s\) sur 3, dont 0 en retard/.test(await line()), await line());
  await R.shot("02-after-review");

  checkNoErrors(check, [R], "6");
} catch (e) {
  check("EXCEPTION du parcours", false, String(e).slice(0, 400));
} finally {
  await finish(browser, failures);
}
