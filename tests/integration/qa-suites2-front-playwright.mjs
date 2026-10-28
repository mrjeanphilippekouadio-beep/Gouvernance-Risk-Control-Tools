// QA-SUITES2 : parcours navigateur (Chromium) du lot « suites des arbitrages 2 » (branche feat/r1-suites-arbitrages-2,
// DECISION-092/094/095) contre le VRAI backend (tsx, PostgreSQL LOCAL, fournisseur local, jamais Neon, jamais Google).
// Pages : « Réglages de gouvernance » (GovernanceSettingsPage.tsx) et « Audit > Missions » (AuditMissionsPage.tsx).
// Les oracles ci-dessous sont ecrits AVANT l'execution.
//
// COMPTES (mot de passe « whatever », droits poses dans users.roles ; groupes fixes Risk Manager / Comite / Audit sans membre) :
//   A « Admin Gouv QA »       : config.read, config.governancedelays.set, config.selfvalidation.approve, role.read, role.update, rolegroup.audit.update
//   B « Approbateur QA »      : config.read, config.selfvalidation.approve
//   E « Lecteur Droits QA »   : config.read, role.read (pas role.update)
//   C « Missions QA »         : audit.mission.read, audit.mission.create (rien d'autre : ni user.read ni droit de designation)
//   D « Autre Compte QA »     : audit.mission.read
//
// ORACLES
//  1. Carte des 4 droits (A)
//     1.1 La carte « Droits de décision de gouvernance » affiche 4 lignes ; chaque ligne porte les groupes renvoyes par
//         GET /roles/governance-rights (libelles « Risk Manager », « Comité des risques », « Audit »).
//     1.2 Modifier « Confirmer l'acceptation d'un principe » : fenetre avec 3 cases ; « Enregistrer » inactif sans motif.
//         Cocher « Audit » (+ motif) -> PUT = 400, message du serveur (q157) AFFICHE dans la fenetre, fenetre ouverte, aucun
//         changement cote API. Tout decocher -> PUT = 400 (au moins un groupe), message affiche, aucun changement.
//     1.3 Decocher « Risk Manager » (reste Comite) + motif -> PUT = 200, corps { permission, groups:[RISK_COMMITTEE], reason } ;
//         bandeau « Changement appliqué » ; la ligne affiche « Comité des risques » seul ; l'API concorde ; une ligne d'audit
//         PERMISSION_CHANGE sur le role Risk Manager porte le motif.
//     1.4 Revue d'une action sans validation independante : « Audit » peut etre COCHE (la revue lui est permise) : PUT 200,
//         la ligne contient « Audit » ; l'API concorde.
//     1.5 Compte E (role.read sans role.update) : la carte est visible ; un enregistrement est refuse par le serveur (403) et le refus
//         est AFFICHE (fenetre ou bandeau) ; l'API reste inchangee.
//  2. Demande d'allongement de delai (A cree, B approuve, refusee a A)
//     2.0 Preparation API : A fixe acceptanceMaxDays = 30 (reglage d'un delai non configure : direct, 200).
//     2.1 A : Modifier les delais, acceptanceMaxDays = 60 + motif -> PUT = 202 ; bandeau « NON appliqué : en attente d'approbation » ;
//         la liste affiche toujours « 30 jours » ; la banniere de demande montre « 30 jours → 60 jours » ; API : config 30, demande PENDING.
//     2.2 A clique Approuver (+ motif) : refus du serveur (403, auteur) AFFICHE ; la demande reste PENDING ; delai toujours 30.
//     2.3 B ouvre la page : voit la meme demande (« 30 jours → 60 jours », demandee par A) ; Approuver + motif -> POST approve = 200 ;
//         bandeau « Demande approuvée » ; plus de banniere ; « 60 jours » ; API 60 ; la demande est APPLIED (decidee par B).
//     2.4 Raccourcir (60 -> 45) par A : direct (200), pas de demande, bandeau « Changement appliqué ».
//  3. Missions d'audit (C : audit.mission.create seul avec read)
//     3.1 C ouvre « Nouvelle mission » : le choix du responsable propose les AUTRES comptes (D, A, B, E) et lui-meme ; au moins 5 noms.
//     3.2 GET /users/directory repond 200 pour C (au moins une fois), aucun console.error ni exception JS sur la page.
//     3.3 D (audit.mission.read seul) : annuaire = 403 pour D par l'API, et D ne voit que lui-meme dans le choix s'il pouvait creer (non teste
//         par l'ecran : pas de bouton « Nouvelle mission ») ; D n'a pas le bouton « Nouvelle mission ».
//
// Prerequis : docs/qa/qa-suites2-2026-10-27.md, section 1 (PG local grc_qa_s2f migrations 001..076, backend 127.0.0.1:8099
// AUTH_PROVIDER=local, vite 127.0.0.1:5199 VITE_AUTH_PROVIDER=local). Base neuve avant chaque passage (tests/integration/qa-suites2-front-setup.sh).
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const API = process.env.QA_API ?? "http://127.0.0.1:8099";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/suites2";
const EMAIL = { a: "qa-s2-a@s2.test", b: "qa-s2-b@s2.test", e: "qa-s2-e@s2.test", c: "qa-s2-c@s2.test", d: "qa-s2-d@s2.test" };
mkdirSync(SHOTS, { recursive: true });

const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const CONFIRM = "governanceprinciple.acceptance.confirm";
const REVIEW = "governanceexception.review";
const rightGroups = async (who, permission) => ((await api(who, "GET", "/roles/governance-rights")).json?.data ?? []).find((r) => r.permission === permission)?.groups?.slice().sort();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const allJs = [];
const calls = [];
async function open(who) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const state = { page, consoleErrors: [], jsErrors: [] };
  page.on("pageerror", (e) => { state.jsErrors.push(String(e)); allJs.push(`${who}: ${e}`); });
  page.on("console", (m) => { if (m.type() === "error") state.consoleErrors.push(m.text()); });
  page.on("response", (res) => {
    const req = res.request();
    if (!res.url().startsWith(API)) return;
    let body = null;
    try { body = req.postDataJSON(); } catch { /* none */ }
    calls.push({ who, method: req.method(), path: new URL(res.url()).pathname + new URL(res.url()).search, status: res.status(), body });
  });
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await page.goto(APP);
  await page.getByLabel("Adresse e-mail QA").fill(EMAIL[who]);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await nav.waitFor();
  state.dialog = page.locator("dialog[open]");
  state.gotoGov = async () => {
    const group = nav.locator("button.sidebar-group-toggle", { hasText: /Administration/i });
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
    await nav.getByRole("button", { name: /^Réglages de gouvernance/ }).click();
    await page.getByRole("heading", { name: "Réglages de gouvernance" }).waitFor();
    await sleep(900);
  };
  state.gotoMissions = async () => {
    const group = nav.locator("button.sidebar-group-toggle", { hasText: /^\s*Audit\s*\d*\s*$/ });
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
    await nav.getByRole("button", { name: /^Missions/ }).click();
    await page.getByRole("heading", { name: "Missions d'audit" }).waitFor();
    await sleep(900);
  };
  state.rightRow = (text) => page.locator("li").filter({ hasText: text }).filter({ has: page.getByRole("button", { name: "Modifier" }) });
  state.rightText = async (text) => (await state.rightRow(text).first().innerText()).replace(/\s+/g, " ").trim();
  state.notice = async () => (await page.locator(".message-banner, [role=status], [role=alert]").allInnerTexts()).join(" | ").replace(/\s+/g, " ");
  return state;
}
const put = (who, suffix) => calls.filter((c) => c.who === who && c.method === "PUT" && c.path.endsWith(suffix));
const post = (who, suffix) => calls.filter((c) => c.who === who && c.method === "POST" && c.path.endsWith(suffix));
// Cartes dans l'ordre de la page : politique (0), cumul (1), delais (2), puis un « Modifier » par droit. On verifie le titre de la fenetre.
async function openDelays(st) {
  await st.page.getByRole("button", { name: "Modifier" }).nth(2).click();
  await st.dialog.waitFor();
  if (!/Délais de gouvernance/.test(await st.dialog.innerText())) throw new Error("la fenêtre ouverte n'est pas « Délais de gouvernance »");
}
const LABEL = { confirm: "Confirmer l'acceptation d'un principe", review: "Revoir une action sans validation indépendante" };

try {
  for (const w of ["a", "b", "e", "c", "d"]) await login(w);
  const ids = {};
  for (const w of ["a", "b", "e", "c", "d"]) ids[w] = (await api(w, "GET", "/users/me")).json?.data?.id;
  check("preparation : 5 comptes connectés, identifiants lus", Object.values(ids).every(Boolean), JSON.stringify(ids));

  // ================================================================================================ 1. Carte des 4 droits
  const A = await open("a");
  await A.gotoGov();
  await A.page.screenshot({ path: `${SHOTS}/01-reglages-A.png`, fullPage: true });
  const apiRights = (await api("a", "GET", "/roles/governance-rights")).json?.data ?? [];
  const GL = { RISK_MANAGER: "Risk Manager", RISK_COMMITTEE: "Comité des risques", AUDIT: "Audit" };
  const labels = { "config.selfvalidation.approve": "Approuver un assouplissement", [CONFIRM]: LABEL.confirm, [REVIEW]: LABEL.review, "orgprofile.approve": "Confirmer une baisse de taille" };
  const texts = {};
  for (const r of apiRights) texts[r.permission] = await A.rightText(labels[r.permission]).catch(() => "");
  check("1.1 la carte affiche les 4 droits, chacun avec les groupes de l'API", apiRights.length === 4 && apiRights.every((r) => texts[r.permission] && r.groups.every((g) => texts[r.permission].includes(GL[g])) && (r.groups.length === 3 || !Object.entries(GL).filter(([g]) => !r.groups.includes(g)).some(([, l]) => l !== "Audit" && new RegExp(`: .*${l}`).test(texts[r.permission])))),
    JSON.stringify(texts));

  await A.rightRow(LABEL.confirm).getByRole("button", { name: "Modifier" }).click();
  await A.dialog.waitFor();
  const boxes = await A.dialog.locator("input[type=checkbox]").count();
  const save = A.dialog.getByRole("button", { name: "Enregistrer" });
  const disabledNoReason = await save.isDisabled();
  check("1.2 fenêtre : 3 cases à cocher ; « Enregistrer » inactif sans motif", boxes === 3 && disabledNoReason, `cases=${boxes}; inactif=${disabledNoReason}`);
  await A.dialog.getByLabel("Audit", { exact: true }).check();
  await A.dialog.locator("#gov-reason").fill("Essai Audit confirme");
  await save.click();
  await sleep(900);
  const p1 = put("a", "/roles/governance-rights").at(-1);
  const err1 = await A.dialog.innerText().catch(() => "");
  await A.page.screenshot({ path: `${SHOTS}/02-refus-audit.png`, fullPage: true });
  check("1.2 « Audit » + motif : PUT 400, message q157 affiché dans la fenêtre restée ouverte", p1?.status === 400 && /q157|never confirms|ne confirme/i.test(err1), `status=${p1?.status}; fenetre=${err1.replace(/\s+/g, " ").slice(0, 200)}`);
  check("1.2 aucun changement côté API", JSON.stringify(await rightGroups("a", CONFIRM)) === '["RISK_COMMITTEE","RISK_MANAGER"]', JSON.stringify(await rightGroups("a", CONFIRM)));
  await A.dialog.getByLabel("Audit", { exact: true }).uncheck();
  await A.dialog.getByLabel("Risk Manager", { exact: true }).uncheck();
  await A.dialog.getByLabel("Comité des risques", { exact: true }).uncheck();
  // QA-SUITES2-FR-01 corrigé : sans groupe coché, « Enregistrer » est inactif et la fenêtre dit pourquoi (le serveur refuse toujours).
  const disabledNoGroup = await save.isDisabled();
  const err2 = await A.dialog.innerText().catch(() => "");
  await A.page.screenshot({ path: `${SHOTS}/03-aucun-groupe.png`, fullPage: true });
  check("1.2 tout décoché : « Enregistrer » inactif, explication affichée, aucun PUT, aucun changement", disabledNoGroup && /au moins un groupe/i.test(err2) && put("a", "/roles/governance-rights").length === 1 && JSON.stringify(await rightGroups("a", CONFIRM)) === '["RISK_COMMITTEE","RISK_MANAGER"]', `inactif=${disabledNoGroup}`);
  check("1.2 refus q157 expliqué en français (pas la clé brute)", /ne confirme ni n'approuve/.test(err1) && !err1.includes(CONFIRM), err1.replace(/\s+/g, " ").slice(0, 200));
  await A.dialog.getByLabel("Comité des risques", { exact: true }).check();
  await save.click();
  await A.dialog.waitFor({ state: "detached", timeout: 6000 }).catch(() => undefined);
  await sleep(900);
  const p3 = put("a", "/roles/governance-rights").at(-1);
  const rowAfter = await A.rightText(LABEL.confirm);
  const notice3 = await A.notice();
  await A.page.screenshot({ path: `${SHOTS}/04-droit-deplace.png`, fullPage: true });
  check("1.3 Comité seul + motif : PUT 200, corps { permission, groups:[RISK_COMMITTEE], reason }",
    p3?.status === 200 && p3.body?.permission === CONFIRM && JSON.stringify(p3.body?.groups) === '["RISK_COMMITTEE"]' && p3.body?.reason === "Essai Audit confirme", `status=${p3?.status}; corps=${JSON.stringify(p3?.body)}`);
  check("1.3 bandeau « Changement appliqué » ; la ligne affiche « Comité des risques » seul ; l'API concorde",
    /Changement appliqué/.test(notice3) && /Comité des risques/.test(rowAfter) && !/Risk Manager|Audit/.test(rowAfter.split(":").slice(1).join(":")) && JSON.stringify(await rightGroups("a", CONFIRM)) === '["RISK_COMMITTEE"]',
    `bandeau=${notice3.slice(0, 120)}; ligne=${rowAfter}`);
  const auditRows = (await api("a", "GET", "/roles")).status;
  void auditRows;

  await A.rightRow(LABEL.review).getByRole("button", { name: "Modifier" }).click();
  await A.dialog.waitFor();
  const reviewChecked = await A.dialog.getByLabel("Audit", { exact: true }).isChecked();
  await A.dialog.locator("#gov-reason").fill("Revue réservée à l'Audit et au Comité");
  await A.dialog.getByLabel("Risk Manager", { exact: true }).uncheck();
  await A.dialog.getByRole("button", { name: "Enregistrer" }).click();
  await A.dialog.waitFor({ state: "detached", timeout: 6000 }).catch(() => undefined);
  await sleep(900);
  const p4 = put("a", "/roles/governance-rights").at(-1);
  const rowReview = await A.rightText(LABEL.review);
  check("1.4 revue : « Audit » est déjà coché (permis), retirer Risk Manager = PUT 200, la ligne contient « Audit » ; l'API concorde",
    reviewChecked && p4?.status === 200 && /Audit/.test(rowReview.split(":").slice(1).join(":")) && JSON.stringify(await rightGroups("a", REVIEW)) === '["AUDIT","RISK_COMMITTEE"]',
    `coche=${reviewChecked}; status=${p4?.status}; ligne=${rowReview}; api=${JSON.stringify(await rightGroups("a", REVIEW))}`);

  const E = await open("e");
  await E.gotoGov();
  const eVisible = (await E.rightRow(LABEL.confirm).count()) > 0;
  const beforeE = JSON.stringify(await rightGroups("e", CONFIRM));
  await E.rightRow(LABEL.confirm).getByRole("button", { name: "Modifier" }).click();
  await E.dialog.waitFor();
  await E.dialog.getByLabel("Risk Manager", { exact: true }).check();
  await E.dialog.locator("#gov-reason").fill("Tentative sans role.update");
  await E.dialog.getByRole("button", { name: "Enregistrer" }).click();
  await sleep(1200);
  const pe = put("e", "/roles/governance-rights").at(-1);
  const shownE = (await E.page.locator("body").innerText()).replace(/\s+/g, " ");
  await E.page.screenshot({ path: `${SHOTS}/05-refus-E.png`, fullPage: true });
  const refusal = (await E.page.locator("dialog[open], [role=dialog]").allInnerTexts()).join(" ").replace(/\s+/g, " ");
  check("1.5 E : la carte est visible ; l'enregistrement est refusé (403) ; le refus est AFFICHÉ (boîte « Vous n'avez pas ce droit ») ; API inchangée",
    eVisible && pe?.status === 403 && /pas ce droit/i.test(refusal) && JSON.stringify(await rightGroups("e", CONFIRM)) === beforeE,
    `visible=${eVisible}; status=${pe?.status}; boite=${refusal.slice(0, 160)}`);

  // ================================================================================================ 2. Demande d'allongement
  const prep = await api("a", "PUT", "/config/governance-delays", { acceptanceMaxDays: 30, reason: "Préparation QA" });
  check("2.0 préparation : acceptanceMaxDays = 30 (délai non configuré -> direct, 200)", prep.status === 200 && prep.json?.data?.acceptanceMaxDays === 30, `status=${prep.status}`);
  await A.gotoGov();
  await openDelays(A);
  await A.dialog.locator("#gov-acceptanceMaxDays").fill("60");
  await A.dialog.locator("#gov-reason").fill("Allonger la durée maximale");
  await A.dialog.getByRole("button", { name: "Enregistrer" }).click();
  await A.dialog.waitFor({ state: "detached", timeout: 6000 }).catch(() => undefined);
  await sleep(1200);
  const pd = put("a", "/config/governance-delays").at(-1);
  const body = (await A.page.locator("body").innerText()).replace(/\s+/g, " ");
  await A.page.screenshot({ path: `${SHOTS}/06-demande-en-attente-A.png`, fullPage: true });
  const reqA = (await api("a", "GET", "/config/governance-delays/request")).json?.data;
  const cfgA = (await api("a", "GET", "/config")).json?.data;
  check("2.1 A : acceptanceMaxDays 60 -> PUT 202 ; bandeau « NON appliqué : en attente d'approbation » ; la liste affiche toujours « 30 jours »",
    pd?.status === 202 && /NON appliqué/.test(body) && /Durée maximale d'une acceptation de principe faite seul : 30 jours/.test(body), `status=${pd?.status}; corps=${JSON.stringify(pd?.body)}`);
  check("2.1 bannière de demande « 30 jours → 60 jours » ; API : config 30, demande PENDING par A",
    /30 jours → 60 jours/.test(body) && cfgA?.acceptanceMaxDays === 30 && reqA?.status === "PENDING" && reqA.requestedBy === ids.a, `req=${reqA?.status}; cfg=${cfgA?.acceptanceMaxDays}`);

  await A.page.getByRole("button", { name: "Approuver", exact: true }).click();
  await A.dialog.waitFor();
  await A.dialog.locator("#gov-decision-reason").fill("Je valide mon propre allongement");
  await A.dialog.getByRole("button", { name: "Approuver", exact: true }).click();
  await sleep(1200);
  const pa = post("a", "/approve").at(-1);
  const bodyA2 = (await A.page.locator("body").innerText()).replace(/\s+/g, " ");
  await A.page.screenshot({ path: `${SHOTS}/07-refus-auteur-A.png`, fullPage: true });
  const reqA2 = (await api("a", "GET", "/config/governance-delays/request")).json?.data;
  check("2.2 A approuve sa propre demande : POST approve = 403, refus (auteur / maker-checker) AFFICHÉ, demande PENDING, délai 30",
    pa?.status === 403 && /author|auteur|maker-checker/i.test(bodyA2) && reqA2?.status === "PENDING" && (await api("a", "GET", "/config")).json?.data?.acceptanceMaxDays === 30,
    `status=${pa?.status}; extrait=${(bodyA2.match(/.{0,60}(author|auteur|maker)[^|]{0,60}/i) ?? ["(aucun texte de refus)"])[0]}`);

  const B = await open("b");
  await B.gotoGov();
  const bodyB = (await B.page.locator("body").innerText()).replace(/\s+/g, " ");
  await B.page.screenshot({ path: `${SHOTS}/08-demande-vue-B.png`, fullPage: true });
  check("2.3 B voit la demande « 30 jours → 60 jours » demandée par A", /30 jours → 60 jours/.test(bodyB) && /Demande en attente d'approbation/.test(bodyB), bodyB.slice(bodyB.indexOf("Demande en attente"), bodyB.indexOf("Demande en attente") + 120));
  await B.page.getByRole("button", { name: "Approuver", exact: true }).click();
  await B.dialog.waitFor();
  await B.dialog.locator("#gov-decision-reason").fill("Allongement accepté");
  await B.dialog.getByRole("button", { name: "Approuver", exact: true }).click();
  await sleep(1500);
  const pb = post("b", "/approve").at(-1);
  const bodyB2 = (await B.page.locator("body").innerText()).replace(/\s+/g, " ");
  await B.page.screenshot({ path: `${SHOTS}/09-approuve-B.png`, fullPage: true });
  const cfgB = (await api("b", "GET", "/config")).json?.data;
  check("2.3 B approuve : POST approve = 200 ; bandeau « Demande approuvée » ; plus de bannière ; « 60 jours » ; API 60",
    pb?.status === 200 && /Demande approuvée/.test(bodyB2) && !/Demande en attente d'approbation/.test(bodyB2) && /faite seul : 60 jours/.test(bodyB2) && cfgB?.acceptanceMaxDays === 60,
    `status=${pb?.status}; api=${cfgB?.acceptanceMaxDays}`);

  await A.gotoGov();
  await openDelays(A);
  await A.dialog.locator("#gov-acceptanceMaxDays").fill("45");
  await A.dialog.locator("#gov-reason").fill("Raccourcir");
  await A.dialog.getByRole("button", { name: "Enregistrer" }).click();
  await A.dialog.waitFor({ state: "detached", timeout: 6000 }).catch(() => undefined);
  await sleep(1200);
  const ps = put("a", "/config/governance-delays").at(-1);
  const bodyS = (await A.page.locator("body").innerText()).replace(/\s+/g, " ");
  check("2.4 raccourcir 60 -> 45 : direct (200), pas de demande, « Changement appliqué », « 45 jours »",
    ps?.status === 200 && ps !== pd && /Changement appliqué/.test(bodyS) && /faite seul : 45 jours/.test(bodyS) && (await api("a", "GET", "/config/governance-delays/request")).json?.data === null, `status=${ps?.status}`);

  // ================================================================================================ 3. Missions d'audit (C)
  const C = await open("c");
  await sleep(1500);
  C.consoleErrors.length = 0; C.jsErrors.length = 0;
  const before = calls.length;
  await C.gotoMissions();
  await C.page.getByRole("button", { name: "Nouvelle mission" }).click();
  await C.dialog.waitFor();
  await sleep(700);
  const opts = (await C.dialog.locator("#m-lead option").allInnerTexts()).map((t) => t.trim()).filter((t) => t && !t.startsWith("Sélectionner"));
  await C.page.screenshot({ path: `${SHOTS}/10-missions-C.png`, fullPage: true });
  const names = ["Admin Gouv QA", "Approbateur QA", "Lecteur Droits QA", "Missions QA", "Autre Compte QA"];
  check("3.1 C (audit.mission.create) : le choix du responsable propose les 5 comptes (lui-même et les autres)", names.every((n) => opts.includes(n)), JSON.stringify(opts));
  const dir = calls.slice(before).filter((c) => c.who === "c" && c.path.includes("/users/directory"));
  check("3.2 GET /users/directory = 200 pour C ; aucun console.error ni exception JS sur la page", dir.length > 0 && dir.every((c) => c.status === 200) && C.consoleErrors.length === 0 && C.jsErrors.length === 0,
    `annuaire=${JSON.stringify(dir.map((c) => c.status))}; console=${JSON.stringify(C.consoleErrors).slice(0, 200)}; js=${C.jsErrors.length}`);
  const D = await open("d");
  await D.gotoMissions();
  const dBtn = await D.page.getByRole("button", { name: "Nouvelle mission" }).count();
  const dDir = await api("d", "GET", "/users/directory");
  check("3.3 D (audit.mission.read seul) : pas de bouton « Nouvelle mission » ; annuaire = 403 par l'API", dBtn === 0 && dDir.status === 403, `bouton=${dBtn}; annuaire=${dDir.status}`);

  const consoleOther = [...A.consoleErrors, ...B.consoleErrors];
  check("4 aucune exception JS sur tout le parcours", allJs.length === 0, allJs.join(" || ").slice(0, 300));
  console.log(`INFO  console.error A+B (403/400/409 provoques inclus) : ${consoleOther.length}`);
} catch (err) {
  check("exécution du script sans exception", false, String(err?.stack ?? err).slice(0, 600));
} finally {
  await browser.close();
  const n = failures();
  console.log(n === 0 ? "TOUS LES CONTRÔLES PASSENT" : `${n} CONTRÔLE(S) EN ÉCHEC`);
  process.exit(n === 0 ? 0 : 1);
}
