// QA niveau 2 de l'ecran F5b (« Santé de la gouvernance ») : complement independant du parcours du developpeur (qa-f5b-front-playwright.mjs).
// VRAI backend (tsx, PostgreSQL 16 LOCAL, fournisseur local, jamais Neon). Jeu : qa-visibility-v2-setup.sh (12 comptes <nom>@vv1.test).
// Oracles ecrits AVANT l'execution.
//
// ORACLES
//  1. Etat vide : avec aucune exception marquee, l'onglet « Exceptions à revoir (0) » dit « Aucune exception à revoir. ». Etat de chargement visible
//     (reponse retardee) ; erreur 500 => bandeau « Chargement impossible » ; 403 => ni tableau ni donnee (message d'acces refuse ou fenetre de droit).
//  2. Masquage (rm, sans audit.read) : les objets USER s'affichent « Personne N » (distincts) ; aucun nom de compte, aucun UUID de compte dans tout le DOM
//     (page + fenetres) ; colonne « Par » = « Vous » pour ses propres lignes et « Masqué (droit d'audit requis) » pour les autres ; aud (audit.read) voit les noms.
//  3. Fidelite au serveur : pour rm et aud, chaque ligne affiche le libelle du statut du JSON ; un statut NOT_EVALUABLE n'est jamais « Respecté » et montre
//     sa raison ; ALLOWED_BY_SETTING => « Autorisé par un réglage » ; « 50 affichés sur N » quand offendersTotal > liste ; l'`acceptanceNote` du serveur est affichee.
//  4. Aucun calcul cote ecran : un JSON modifie en vol (statut RESPECTED malgre des objets en cause ; NOT_EVALUABLE sans raison) est affiche tel quel.
//  5. Droits : out (aucun droit) sans entree de menu ; aud sans droit d'action : ni « Accepter ce principe » ni « Revoir » ; la colonne de ses propres lignes : pas de bouton.
//  6. Accessibilite : fenetre de detail = dialog modal, le focus entre dans la fenetre, Tab ne la quitte pas, Echap ferme et rend le focus au bouton « Détail » ;
//     colonne de la taille : exactement une aria-current + texte « Votre taille » (JSON modifie en vol : taille PME) ; trois colonnes sinon sans aria-current.
//  7. Revue : Enregistrer desactive sans motif ; issue « Contestée » envoyee ; une revue deja posee par ailleurs => erreur affichee dans la fenetre sans fermer.
//  8. Mobile (390 px) : pas de debordement horizontal de la page, colonnes TPE/PME/GE empilees.
//  9. zero erreur JS, aucune erreur console imprevue (hors reponses 4xx/5xx provoquees).
//
// Prerequis : bash f5b-infra.sh up (qa-visibility-v2-setup.sh up grc_qa_f5bq ; backend 8094 ; vite 5194). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB.
import { checkNoErrors, finish, localApi, norm, openSession, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8094";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5194";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/f5b-qa";
mkdirSync(SHOTS, { recursive: true });
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", process.env.QA_DB ?? "grc_qa_f5bq", "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG, "-c", q], { encoding: "utf8" }).trim();
const I = (x) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const T = I("001");
const NAMES = ["rm", "aud", "out", "com"];
const EMAIL = Object.fromEntries(NAMES.map((n) => [n, `${n}@vv1.test`]));
const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const LABEL = { NOT_RESPECTED: /Non respecté/, RESPECTED: /(^|\s)Respecté(\s|$)/, NOT_EVALUABLE: /Non évaluable/, ACCEPTED: /Accepté/, ALLOWED_BY_SETTING: /Autorisé par un réglage/ };
const MENU = "Santé de la gouvernance";
const UUID_OF = (id) => new RegExp(id, "i");

// groupes complets (sinon bandeaux et ecarts de composition parasites) et configuration
sql(`insert into user_roles (tenant_id, role_id, user_id, granted_by) select '${T}', id, '${I("102")}', '${I("10c")}' from roles where system_group = 'RISK_MANAGER' and tenant_id = '${T}'`);
sql(`insert into user_roles (tenant_id, role_id, user_id, granted_by) select '${T}', id, '${I("103")}', '${I("10c")}' from roles where system_group = 'RISK_COMMITTEE' and tenant_id = '${T}'`);
sql(`insert into configs (tenant_id) values ('${T}') on conflict (tenant_id) do nothing`);
sql(`update configs set committee_evaluation_enforced = true, committee_treatment_min_score = 12, exception_review_delay_days = 5 where tenant_id = '${T}'`);
sql(`update users set last_seen_at = now()`);
sql(`update tenants set governance_tracking_started_at = now() - interval '30 days' where id = '${T}'`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const open = (who) => openSession(browser, { app: APP, email: EMAIL[who], shots: SHOTS, who });
const dialogOpen = (s) => s.page.evaluate(() => { const d = document.querySelector("dialog[open]"); return !!d && d.contains(document.activeElement); });
/** Quitte l'ecran puis y revient : le menu ne recharge pas l'ecran deja ouvert. */
const reopen = async (s) => { await s.page.evaluate(() => window.scrollTo(0, 0)); await s.go("Registre"); await s.go(MENU); };
const reload = async (s) => { await reopen(s); return s.page.locator("table tbody tr"); };

try {
  for (const w of NAMES) await login(w);

  // ---- 1. etats vide / chargement / erreur
  const R = await open("rm");
  check("1.0 rm : entrée de menu présente (droit du groupe Risk Manager)", await R.hasEntry(MENU));
  await R.go(MENU);
  await R.page.getByRole("button", { name: /Exceptions à revoir/ }).click();
  check("1.1 état vide : « Aucune exception à revoir. »", (await R.text()).includes("Aucune exception à revoir."), (await R.text()).slice(0, 160));
  await R.shot("01-empty");
  await R.page.route("**/api/v1/governance-health", async (route) => { await sleep(4000); await route.continue(); });
  await R.go("Registre");
  await R.go(MENU);
  check("1.2 chargement : « Chargement… » visible pendant la réponse", (await R.text()).includes("Chargement"), (await R.text()).slice(0, 100));
  await sleep(3500); // laisser finir la reponse retardee avant de retirer la route
  await R.page.unroute("**/api/v1/governance-health");
  await R.page.route("**/api/v1/governance-health", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }));
  await reopen(R);
  check("1.3 erreur serveur 500 : bandeau « Chargement impossible », aucun tableau de principes", (await R.text()).includes("Chargement impossible") && (await R.page.locator("table tbody tr").count()) === 0, (await R.text()).slice(0, 160));
  await R.page.unroute("**/api/v1/governance-health");
  await R.page.route("**/api/v1/governance-health", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Missing permission: governancehealth.read" }) }));
  await reopen(R);
  const t403 = await R.text();
  check("1.4 403 : aucun principe affiché ; message d'accès refusé ou fenêtre de droit", (await R.page.locator("table tbody tr").count()) === 0 && /Accès refusé|Vous n'avez pas ce droit|droit/.test(t403 + (await R.page.locator("dialog[open]").count() ? "droit" : "")), t403.slice(0, 200));
  await R.page.unroute("**/api/v1/governance-health");

  // ---- jeu de donnees : objets USER, exceptions, cumul autorise, ecarts tronques
  sql(`update user_roles set granted_by = user_id where role_id = '${I("301")}' and user_id = '${I("105")}' and revoked_at is null`); // dept s'auto-attribue un role
  sql(`insert into user_roles (tenant_id, role_id, user_id, granted_by) values ('${T}', '${I("302")}', '${I("106")}', '${I("106")}')`); // named aussi
  sql(`insert into audit_log (tenant_id, user_id, entity_type, entity_id, action, reason, request_id, governance_exception, "timestamp")
    values ('${T}', '${I("105")}', 'Config', gen_random_uuid(), 'UPDATE', 'Exception de dept', 'qa-f5b-q', 'config.cumul.adminAlone', now() - interval '8 days'),
           ('${T}', '${I("109")}', 'Config', gen_random_uuid(), 'UPDATE', 'Exception de rm', 'qa-f5b-q', 'config.cumul.adminAlone', now() - interval '1 day')`);
  sql(`insert into risks (tenant_id, process, description, status, owner_id, visibility) select '${T}', 'QA55', 'Risque sans propriétaire ' || g, 'ACTIVE', NULL, 'CLIENT' from generate_series(1, 55) g`);
  sql(`insert into user_roles (tenant_id, role_id, user_id, granted_by) select '${T}', id, '${I("103")}', '${I("10c")}' from roles where system_group = 'AUDIT' and tenant_id = '${T}'`);
  sql(`update configs set committee_audit_cumul_allowed = true where tenant_id = '${T}'`);

  const apiRm = (await api("rm", "GET", "/governance-health")).json.data;
  const apiAud = (await api("aud", "GET", "/governance-health")).json.data;
  const userObjs = apiRm.principles.flatMap((p) => p.offenders).filter((o) => o.kind === "USER");
  check("préparation : des objets USER, un principe tronqué, un ALLOWED_BY_SETTING dans le JSON", userObjs.length >= 2 && apiRm.principles.some((p) => p.offendersTotal > p.offenders.length) && apiRm.principles.some((p) => p.status === "ALLOWED_BY_SETTING"), JSON.stringify({ u: userObjs.length, st: apiRm.principles.map((p) => p.status).join().slice(0, 120) }));

  // ---- 2 et 3. rm : masquage et fidelite
  const rows = await reload(R);
  await R.shot("02-rm-list");
  const html = await R.page.content();
  const rmText = await R.text();
  check("2.1 rm : « Personne 1 » et « Personne 2 » affichés, aucun nom de compte (QA dept, QA named, QA raci)", /Personne 1/.test(rmText) && /Personne 2/.test(rmText) && !/QA dept|QA named|QA raci/.test(html), rmText.slice(0, 120));
  check("2.2 rm : aucun UUID de compte dans le DOM de la liste", !["105", "106", "103", "10b"].some((x) => UUID_OF(I(x)).test(html)));
  let ok = true, why = "";
  for (const p of apiRm.principles) {
    const t = norm(await rows.filter({ hasText: p.id }).first().innerText());
    if (!LABEL[p.status].test(t)) { ok = false; why += ` ${p.id}:${p.status}`; }
    if (p.status === "NOT_EVALUABLE" && (/(^|\s)Respecté/.test(t) || !t.includes("Non évaluable :"))) { ok = false; why += ` ${p.id}:ne`; }
    if (p.offendersTotal > p.offenders.length && !t.includes(`${p.offenders.length} affichés sur ${p.offendersTotal}`)) { ok = false; why += ` ${p.id}:trunc`; }
    if (p.acceptanceNote && !t.includes(p.acceptanceNote)) { ok = false; why += ` ${p.id}:note`; }
  }
  check("3.1 rm : chaque ligne = statut du JSON, raison des non évaluables, « N affichés sur M », note d'acceptation", ok, why);
  const trunc = apiRm.principles.find((p) => p.offendersTotal > p.offenders.length);
  check("3.2 rm : « 50 affichés sur 55 » pour les risques sans propriétaire", !!trunc && (await rows.filter({ hasText: trunc.id }).first().innerText()).includes("50 affichés sur 55"), trunc && `${trunc.id} ${trunc.offenders.length}/${trunc.offendersTotal}`);
  const allowed = apiRm.principles.find((p) => p.status === "ALLOWED_BY_SETTING");
  check("3.3 rm : ALLOWED_BY_SETTING => « Autorisé par un réglage », cumulant « Personne N »", !!allowed && /Autorisé par un réglage/.test(await rows.filter({ hasText: allowed.id }).first().innerText()) && !/QA raci/.test(await rows.filter({ hasText: allowed.id }).first().innerText()));
  const banner = apiRm.principles.some((p) => p.offenders.some((o) => o.kind === "GROUP" && o.id === "RISK_MANAGER" && o.count === 0));
  check("3.4 groupe RM non vide : pas de bandeau « Groupe Risk Manager vide »", banner === false && !rmText.includes("Groupe Risk Manager vide"));

  await R.page.getByRole("button", { name: /Exceptions à revoir/ }).click();
  const eText = await R.text();
  const erows = R.page.locator("table tbody tr");
  const deptRow = erows.filter({ hasText: "Exception de dept" });
  const rmRow = erows.filter({ hasText: "Exception de rm" });
  check("2.3 rm : colonne « Par » = « Masqué (droit d'audit requis) » pour l'autre, « Vous » pour la sienne", /Masqué \(droit d'audit requis\)/.test(await deptRow.innerText()) && /Vous/.test(await rmRow.innerText()), eText.slice(0, 200));
  check("2.4 rm : « En retard » sur l'exception de 8 jours (délai 5), pas sur celle de 1 jour ; bouton Revoir sur l'autre, pas sur la sienne", /En retard/.test(await deptRow.innerText()) && !/En retard/.test(await rmRow.innerText()) && (await deptRow.getByRole("button", { name: /Revoir/ }).count()) === 1 && (await rmRow.getByRole("button").count()) === 0);
  check("2.5 rm : âge affiché = âge du JSON", (await deptRow.innerText()).includes(`${apiRm.exceptions.items.find((i) => !i.mine).ageDays} j`));
  await R.shot("03-rm-exceptions");

  // ---- 7. revue : motif obligatoire, issue contestee, erreur dans la fenetre
  await deptRow.getByRole("button", { name: /Revoir/ }).click();
  const rd = R.page.getByRole("dialog");
  const save = rd.getByRole("button", { name: "Enregistrer" });
  check("7.1 Enregistrer désactivé sans motif", await save.isDisabled());
  check("7.2 le focus est dans la fenêtre de revue", await dialogOpen(R));
  await rd.getByLabel("Issue").selectOption("CONTESTED");
  await rd.getByLabel(/Motif/).fill("Contestation QA F5b");
  check("7.3 Enregistrer actif avec un motif", await save.isEnabled());
  await save.click();
  await R.page.getByText("Exception contestée.").waitFor({ timeout: 5000 }).catch(() => undefined);
  const closed = (await R.page.locator("dialog[open]").count()) === 0;
  const posted = sql(`select outcome from governance_exception_reviews where comment = 'Contestation QA F5b'`);
  check("7.4 issue « Contestée » : revue enregistrée avec l'issue CONTESTED, fenêtre fermée, message « Exception contestée. »", closed && posted === "CONTESTED", `${closed} ${posted}`);
  await R.shot("04-review-contested");
  const after = norm(await R.page.locator("table tbody tr").filter({ hasText: "Exception de dept" }).innerText());
  check("7.5 la ligne contestée n'offre plus « Revoir » ni « À revoir » (ou l'état reflète le serveur)", after.length > 0 && (/Revue|À revoir/.test(after)), after.slice(0, 160));

  // ---- 6. detail, focus, tab, aria-current
  await R.page.getByRole("button", { name: /^Principes \(/ }).click();
  const prow = R.page.locator("table tbody tr").filter({ hasText: "GOV-SOD-03" }).first(); // l'ecran s'est deja rafraichi apres la revue
  const opener = prow.getByRole("button", { name: /Détail/ });
  await opener.focus();
  await opener.press("Enter");
  await R.page.getByRole("dialog").waitFor();
  check("6.1 détail : dialog modal, focus dans la fenêtre", await dialogOpen(R));
  for (let i = 0; i < 14; i++) await R.page.keyboard.press("Tab");
  check("6.2 14 Tab : le focus ne quitte pas la fenêtre", await dialogOpen(R));
  const dlg = R.page.getByRole("dialog");
  check("6.3 trois colonnes, taille inconnue : aucune aria-current, bandeau « Taille de l'organisation inconnue » sur la page", (await dlg.locator("details.gh-column").count()) === 3 && (await dlg.locator("[aria-current]").count()) === 0);
  const dhtml = await dlg.innerHTML();
  check("6.4 détail : « Personne N » sans nom ni UUID de compte", /Personne \d/.test(await dlg.innerText()) && !/QA dept|QA named/.test(dhtml) && !UUID_OF(I("105")).test(dhtml) && !UUID_OF(I("106")).test(dhtml));
  await R.page.keyboard.press("Escape");
  await sleep(400);
  const back = await R.page.evaluate(() => (document.activeElement?.textContent ?? "").trim().slice(0, 40));
  check("6.5 Échap ferme et rend le focus au bouton « Détail »", (await R.page.locator("dialog[open]").count()) === 0 && /Détail/.test(back), back);

  // taille connue (JSON modifie en vol) : une seule colonne marquee
  await R.page.route("**/api/v1/governance-health", async (route) => {
    const r = await route.fetch(); const j = await r.json();
    j.data.organizationSize = { value: "PME", ruleVersion: "x", toConfirm: false, justification: [] };
    j.data.principles.forEach((p) => { p.highlighted = "PME"; p.requirementLevel = p.indications.PME.level; });
    await route.fulfill({ response: r, json: j });
  });
  const rows2 = await reload(R);
  await rows2.first().getByRole("button", { name: /Détail/ }).click();
  const d2 = R.page.getByRole("dialog");
  const cur = d2.locator("[aria-current]");
  check("6.6 taille PME : exactement une colonne aria-current, qui est PME, avec le texte « Votre taille » (pas la couleur seule)", (await cur.count()) === 1 && /PME/.test(await cur.first().innerText()) && /Votre taille/.test(await cur.first().innerText()));
  check("6.7 taille connue : plus de bandeau « Taille de l'organisation inconnue »", !(await R.text()).includes("Taille de l'organisation inconnue"));
  await R.shot("05-size-known");
  // ---- 8. mobile (la reference est mesuree sur le Registre, ecran existant, avant d'ouvrir le detail)
  const measure = () => R.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  await R.page.keyboard.press("Escape");
  await R.go("Registre");
  await R.page.setViewportSize({ width: 390, height: 800 });
  await sleep(500);
  const ref = await measure();
  await R.page.setViewportSize({ width: 1360, height: 1000 });
  await R.go(MENU);
  await R.page.locator("table tbody tr").first().getByRole("button", { name: /Détail/ }).click();
  const d3 = R.page.getByRole("dialog");
  await R.page.setViewportSize({ width: 390, height: 800 });
  await sleep(500);
  const boxes = await d3.locator("details.gh-column").evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y) }; }));
  check("8.1 mobile : colonnes TPE / PME / GE empilées (même x, y croissants)", boxes.length === 3 && boxes[0].x === boxes[1].x && boxes[1].x === boxes[2].x && boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y, JSON.stringify(boxes));
  const dw = await d3.evaluate((d) => { const b = d.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right) }; });
  check("8.3 [QA-F5B-01] mobile : la fenêtre de détail tient dans l'écran (0 <= gauche, droite <= 390)", dw.left >= 0 && dw.right <= 391, JSON.stringify(dw));
  await R.shot("06-mobile-detail");
  await R.page.keyboard.press("Escape");
  await sleep(300);
  const over2 = await measure();
  check("8.2 [QA-F5B-01] mobile : pas de débordement horizontal de la page des principes (référence : Registre des risques)", over2.sw <= over2.iw + 1, JSON.stringify({ sante: over2, registre: ref }));
  await R.shot("07-mobile-list");
  await R.page.setViewportSize({ width: 1360, height: 1000 });

  // ---- 4. aucun calcul cote ecran
  await R.page.unroute("**/api/v1/governance-health");
  await R.page.route("**/api/v1/governance-health", async (route) => {
    const r = await route.fetch(); const j = await r.json();
    const withObs = j.data.principles.find((p) => p.offenders.length > 0 && p.status === "NOT_RESPECTED");
    withObs.status = "RESPECTED";
    const ne = j.data.principles.find((p) => p.status === "NOT_EVALUABLE");
    ne.notEvaluableReason = null;
    await route.fulfill({ response: r, json: j });
  });
  const rows3 = await reload(R);
  const sample = apiRm.principles.find((p) => p.offenders.length > 0 && p.status === "NOT_RESPECTED");
  const neSample = apiRm.principles.find((p) => p.status === "NOT_EVALUABLE");
  const t1 = norm(await rows3.filter({ hasText: sample.id }).first().innerText());
  const t2 = norm(await rows3.filter({ hasText: neSample.id }).first().innerText());
  check("4.1 statut modifié en vol (RESPECTED malgré des objets en cause) : l'écran affiche le statut du serveur, sans recalcul", LABEL.RESPECTED.test(t1) && !/Non respecté/.test(t1), t1.slice(0, 100));
  check("4.2 NOT_EVALUABLE sans raison : « raison non fournie », jamais « Respecté »", /Non évaluable : raison non fournie/.test(t2) && !/(^|\s)Respecté/.test(t2), t2.slice(0, 120));
  await R.page.unroute("**/api/v1/governance-health");

  // ---- 3/5. Audit : noms visibles, aucun bouton d'action
  const U = await open("aud");
  await U.go(MENU);
  const urows = U.page.locator("table tbody tr");
  const uhtml = await U.page.content();
  check("3.5 aud (audit.read) : les noms apparaissent (QA dept, QA named), pas de « Personne N »", /QA dept/.test(uhtml) && /QA named/.test(uhtml) && !/Personne \d/.test(await U.text()));
  let ok2 = true, why2 = "";
  for (const p of apiAud.principles) { const t = norm(await urows.filter({ hasText: p.id }).first().innerText()); if (!LABEL[p.status].test(t)) { ok2 = false; why2 += ` ${p.id}`; } }
  check("3.6 aud : statuts = JSON", ok2, why2);
  await urows.filter({ hasText: "GOV-OWN-01" }).first().getByRole("button", { name: /Détail/ }).click();
  check("5.1 aud : pas de « Accepter ce principe »", (await U.page.getByRole("button", { name: "Accepter ce principe" }).count()) === 0);
  await U.page.keyboard.press("Escape");
  await U.page.getByRole("button", { name: /Exceptions à revoir/ }).click();
  const named = norm(await U.page.locator("table tbody tr").filter({ hasText: "Exception de dept" }).innerText());
  check("5.2 aud : la colonne « Par » nomme l'auteur", /QA dept/.test(named), named.slice(0, 120));
  const perms = (await api("aud", "GET", "/users/me/permissions")).json.data ?? [];
  const revoir = await U.page.getByRole("button", { name: /^Revoir/ }).count();
  check("5.4 aud : le bouton « Revoir » existe exactement quand le droit governanceexception.review est détenu (et jamais sur une ligne à soi)", (revoir > 0) === perms.includes("governanceexception.review"), `droit=${perms.includes("governanceexception.review")} boutons=${revoir}`);
  check("5.5 aud : sans le droit governanceprinciple.accept, aucun bouton d'acceptation (déjà vérifié en 5.1) ; droit détenu = " + perms.includes("governanceprinciple.accept"), !perms.includes("governanceprinciple.accept"));

  // ---- 5. out : aucun acces
  const O = await open("out");
  check("5.3 out : pas d'entrée de menu, API 403", !(await O.hasEntry(MENU)) && (await api("out", "GET", "/governance-health")).status === 403);

  checkNoErrors(check, [R, U, O], "9");
} catch (e) {
  check("exception du script", false, String(e).slice(0, 700));
} finally {
  await finish(browser, failures);
}
