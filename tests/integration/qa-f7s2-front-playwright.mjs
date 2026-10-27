// QA-F7S2 : parcours navigateur (Chromium) du lot F7-S2 (branche feat/f7-s2-missions), page « Audit > Missions »
// (AuditMissionsPage.tsx, routes /api/v1/audit-missions) contre le VRAI backend (tsx, PostgreSQL LOCAL, fournisseur local,
// jamais Neon, jamais Google). Les oracles ci-dessous sont ecrits AVANT l'execution.
//
// COMPTES (mot de passe « whatever », droits poses dans users.roles) :
//   P « Pilote Audit QA »      : audit.mission.read/create/update/close + user.read (annuaire)
//   S « Second Auditeur QA »   : audit.mission.read (sert de « autre auditeur »)
//   R « Lecteur Audit QA »     : audit.mission.read seul
//   N « Sans Annuaire QA »     : audit.mission.read/create/update/close, SANS user.read ni autre droit d'annuaire
//
// ORACLES
//  1. Creation (P)
//     1.1 « Nouvelle mission » ouvre la fenetre ; « Creer » est inactif a vide, et le reste tant qu'UN champ obligatoire manque
//         (reference, titre, perimetre, responsable, debut, fin : on les remplit un a un ; actif seulement quand les 6 sont poses ;
//         re-inactif si on vide le titre).
//     1.2 Fin (05/10) avant debut (12/10) : POST = 400, le message du serveur (« plannedEndDate cannot be before ») est AFFICHE dans la
//         fenetre, qui reste ouverte, aucun bandeau de succes, aucune mission AUD-QA-001 dans l'API.
//     1.3 Dates corrigees (12/10 -> 20/10), responsable = P, autre auditeur = S : POST = 201 ; corps envoye : reference/titre/perimetre
//         rognes, auditorIds = [S], pas de champ d'attribution (createdBy...) ; fenetre fermee ; bandeau « Mission AUD-QA-001 creee. ».
//         Ligne : statut « Planifiee », « Prevue » = « 2026-10-12 -> 2026-10-20 », « Reelle » = « — », equipe = « Pilote Audit QA (responsable) »
//         + « Second Auditeur QA » (noms, pas d'UUID). API : status PLANIFIEE, leadAuditorId = P, auditorIds = [S].
//  2. Cycle de vie (P)
//     2.1 Demarrer : POST /start = 200 sans date dans le corps ; ligne « En cours » ; « Reelle » = « <aujourd'hui UTC> -> — » ;
//         l'API donne EN_COURS et actualStartDate = date du serveur (aujourd'hui, UTC) ; plus de « Demarrer » sur la ligne.
//     2.2 Cloturer : bouton de ligne ouvre la fenetre ; « Cloturer » de la fenetre inactif a vide, inactif avec espaces seuls, actif avec un
//         commentaire ; POST /close = 200 corps { comment } (rogne) ; ligne « Cloturee » avec le commentaire visible, « Reelle » = debut -> fin ;
//         plus de Demarrer/Cloturer ; bandeau « Mission AUD-QA-001 cloturee. ». API CLOTUREE + closureComment.
//     2.3 (bonus) re-demarrer / re-cloturer la mission cloturee par l'API : 400, statut inchange.
//  3. Filtre et lecture seule
//     3.1 Seed API : M2 AUD-QA-002 PLANIFIEE, M3 AUD-QA-003 EN_COURS (M1 CLOTUREE). Filtre « Planifiee » -> uniquement M2 ; « En cours » -> M3 ;
//         « Cloturee » -> M1 ; « Tous » -> 3 lignes. Chaque filtre = GET ?status= avec l'etat correspondant.
//     3.2 R : voit les 3 lignes ; ni « Nouvelle mission », ni « Demarrer », ni « Cloturer » ; appels directs de R : POST create, /start (M2),
//         /close (M3) = 403, M2 reste PLANIFIEE et M3 EN_COURS, GET liste = 200.
//  4. Sans annuaire (N)
//     4.1 Le choix du responsable propose au moins « Sans Annuaire QA » (N) ; pas d'autre nom (aucun droit d'annuaire).
//     4.2 N cree une mission avec lui-meme comme responsable : 201, equipe = son nom.
//     4.3 Aucune exception JS et aucun console.error sur la page (apres l'ecran d'arrivee, dont les 403 sont comptes a part) ;
//         l'appel GET /users/directory refuse (403) est une observation tracee, il compte comme console.error s'il en produit un.
//
// Prerequis : docs/qa/qa-f7s2-front-2026-10-27.md, section 1 (PG local grc_qa_f7s2 migrations 001..075, backend 127.0.0.1:8099
// AUTH_PROVIDER=local, vite 127.0.0.1:5199 VITE_AUTH_PROVIDER=local). Base neuve avant chaque passage.
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const API = process.env.QA_API ?? "http://127.0.0.1:8099";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/f7s2";
const EMAIL = { p: "qa-f7s2-p@f7s2.test", s: "qa-f7s2-s@f7s2.test", r: "qa-f7s2-r@f7s2.test", n: "qa-f7s2-n@f7s2.test" };
mkdirSync(SHOTS, { recursive: true });

const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const BASE = "/audit-missions";
const list = async (who, q = "") => (await api(who, "GET", `${BASE}${q}`)).json?.data ?? [];
const byRef = async (who, ref) => (await list(who)).find((m) => m.reference === ref);
const TODAY = new Date().toISOString().slice(0, 10);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const allJs = [];
const consoleAll = [];
const calls = [];
async function open(who) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const state = { page, consoleErrors: [], jsErrors: [] };
  page.on("pageerror", (e) => { state.jsErrors.push(String(e)); allJs.push(`${who}: ${e}`); });
  page.on("console", (m) => { if (m.type() === "error") { state.consoleErrors.push(m.text()); consoleAll.push(`${who}: ${m.text()}`); } });
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
  state.goto = async () => {
    const group = nav.locator("button.sidebar-group-toggle", { hasText: /^\s*Audit\s*\d*\s*$/ });
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
    await nav.getByRole("button", { name: /^Missions/ }).click();
    await page.getByRole("heading", { name: "Missions d'audit" }).waitFor();
    await page.locator("table tbody tr").first().waitFor({ timeout: 6000 }).catch(() => undefined);
    await sleep(300);
  };
  state.row = (ref) => page.locator("table tbody tr").filter({ hasText: ref });
  state.cell = async (ref, i) => (await state.row(ref).locator("td").nth(i).innerText()).replace(/\s+/g, " ").trim();
  state.dialog = page.locator("dialog[open]");
  state.refs = async () => (await page.locator("table tbody tr strong").allInnerTexts());
  state.pickDay = async (label, day) => {
    const dp = state.dialog.locator(".gs-datepicker").filter({ hasText: label });
    await dp.locator("input").click();
    await dp.locator(".gs-datepicker-day:not(.gs-datepicker-day-outside)").getByText(String(day), { exact: true }).click();
  };
  state.fillMain = async (ref, title, scope) => {
    await state.dialog.locator("#m-ref").fill(ref);
    await state.dialog.locator("#m-title").fill(title);
    await state.dialog.locator("#m-scope").fill(scope);
  };
  state.submit = () => state.dialog.getByRole("button", { name: "Créer" });
  return state;
}
const post = (who, suffix) => calls.filter((c) => c.who === who && c.method === "POST" && c.path.endsWith(suffix));

try {
  for (const w of ["p", "s", "r", "n"]) await login(w);
  const ids = {};
  for (const w of ["p", "s", "r", "n"]) ids[w] = (await api(w, "GET", "/users/me")).json?.data?.id;
  check("preparation : 4 comptes connectes, identifiants lus", Object.values(ids).every(Boolean), JSON.stringify(ids));

  // ================================================================================================ 1. Creation (P)
  const P = await open("p");
  await P.goto();
  await P.page.screenshot({ path: `${SHOTS}/01-liste-vide-P.png`, fullPage: true });
  await P.page.getByRole("button", { name: "Nouvelle mission" }).click();
  await P.dialog.waitFor();
  const steps = [];
  steps.push(await P.submit().isDisabled());
  await P.dialog.locator("#m-ref").fill("  AUD-QA-001  "); steps.push(await P.submit().isDisabled());
  await P.dialog.locator("#m-title").fill("  Revue des accès  "); steps.push(await P.submit().isDisabled());
  await P.dialog.locator("#m-scope").fill("  Périmètre QA  "); steps.push(await P.submit().isDisabled());
  await P.dialog.locator("#m-lead").selectOption({ label: "Pilote Audit QA" }); steps.push(await P.submit().isDisabled());
  await P.pickDay("Début prévu", 12); steps.push(await P.submit().isDisabled());
  await P.pickDay("Fin prévue", 5); steps.push(await P.submit().isDisabled());
  await P.page.screenshot({ path: `${SHOTS}/02-creation-fin-avant-debut.png`, fullPage: true });
  check("1.1 « Créer » inactif à vide et tant qu'un champ obligatoire manque (5 étapes inactives), actif quand les 6 sont posés",
    steps.slice(0, 6).every(Boolean) && steps[6] === false, JSON.stringify(steps));
  await P.dialog.locator("#m-title").fill("");
  const offAgain = await P.submit().isDisabled();
  await P.dialog.locator("#m-title").fill("  Revue des accès  ");
  check("1.1 re-inactif si on vide le titre", offAgain === true, `disabled=${offAgain}`);

  await P.submit().click();
  await sleep(800);
  const bad = post("p", BASE).at(-1);
  const dlgText = (await P.dialog.innerText().catch(() => "")).replace(/\s+/g, " ");
  const pageBannerDuring = await P.page.getByText("Action refusée par le serveur").count();
  check("1.2 fin avant début : POST = 400", bad?.status === 400, `status=${bad?.status}`);
  check("1.2 le message du serveur est AFFICHÉ dans la fenêtre, qui reste ouverte, sans bandeau de succès",
    /plannedEndDate cannot be before/i.test(dlgText) && (await P.dialog.count()) === 1 && !(await P.page.getByText(/Mission AUD-QA-001 créée/).count()),
    dlgText.match(/.{0,50}cannot be before.{0,40}/i)?.[0] ?? `(absent) ${dlgText.slice(0, 200)}`);
  await P.page.screenshot({ path: `${SHOTS}/03-creation-refus-serveur.png`, fullPage: true });
  check("1.2 aucune mission AUD-QA-001 créée côté API ; pas de bandeau global en doublon", (await byRef("p", "AUD-QA-001")) === undefined && pageBannerDuring === 0,
    `banniere globale=${pageBannerDuring}`);

  await P.pickDay("Fin prévue", 20);
  await P.dialog.getByLabel("Second Auditeur QA").check();
  await P.page.screenshot({ path: `${SHOTS}/04-creation-formulaire-complet.png`, fullPage: true });
  await P.submit().click();
  await P.dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
  await sleep(500);
  const ok = post("p", BASE).at(-1);
  const m1 = await byRef("p", "AUD-QA-001");
  const body = ok?.body ?? {};
  check("1.3 POST = 201 ; corps rogné, auditorIds = [S], aucun champ d'attribution",
    ok?.status === 201 && body.reference === "AUD-QA-001" && body.title === "Revue des accès" && body.scope === "Périmètre QA"
      && JSON.stringify(body.auditorIds) === JSON.stringify([ids.s]) && !Object.keys(body).some((k) => /By(Id)?$/.test(k)),
    `status=${ok?.status}; body=${JSON.stringify(body)}`);
  check("1.3 fenêtre fermée, bandeau « Mission AUD-QA-001 créée. »", (await P.dialog.count()) === 0 && (await P.page.getByText("Mission AUD-QA-001 créée.").count()) === 1);
  const c1 = [await P.cell("AUD-QA-001", 1), await P.cell("AUD-QA-001", 2), await P.cell("AUD-QA-001", 3), await P.cell("AUD-QA-001", 4)];
  await P.page.screenshot({ path: `${SHOTS}/05-mission-planifiee.png`, fullPage: true });
  check("1.3 ligne : « Planifiée », prévue 2026-10-12 → 2026-10-20, réelle « — »", /Planifiée/.test(c1[0]) && c1[1] === "2026-10-12 → 2026-10-20" && c1[2] === "—", JSON.stringify(c1));
  check("1.3 équipe affichée avec les noms (responsable + Second Auditeur QA), sans UUID", /Pilote Audit QA \(responsable\)/.test(c1[3]) && /Second Auditeur QA/.test(c1[3]) && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(c1[3]), c1[3]);
  check("1.3 API : PLANIFIEE, responsable = P, auditeurs = [S]", m1?.status === "PLANIFIEE" && m1.leadAuditorId === ids.p && JSON.stringify(m1.auditorIds) === JSON.stringify([ids.s]), JSON.stringify({ s: m1?.status, l: m1?.leadAuditorId, a: m1?.auditorIds }));

  // ================================================================================================ 2. Cycle de vie (P)
  await P.row("AUD-QA-001").getByRole("button", { name: "Démarrer" }).click();
  await sleep(800);
  const st = post("p", `/${m1.id}/start`).at(-1);
  const m1s = await byRef("p", "AUD-QA-001");
  const c2 = [await P.cell("AUD-QA-001", 1), await P.cell("AUD-QA-001", 3)];
  await P.page.screenshot({ path: `${SHOTS}/06-mission-en-cours.png`, fullPage: true });
  check("2.1 Démarrer : POST /start = 200 sans date dans le corps", st?.status === 200 && (st.body === null || Object.keys(st.body).length === 0), `status=${st?.status}; body=${JSON.stringify(st?.body)}`);
  check("2.1 ligne « En cours », réelle = « <aujourd'hui UTC> → — » = date posée par le serveur", /En cours/.test(c2[0]) && c2[1] === `${TODAY} → —` && m1s?.status === "EN_COURS" && m1s.actualStartDate?.slice(0, 10) === TODAY,
    `${c2[0]} | ${c2[1]} | api=${m1s?.actualStartDate}`);
  check("2.1 plus de « Démarrer » sur la ligne ; « Clôturer » présent", (await P.row("AUD-QA-001").getByRole("button", { name: "Démarrer" }).count()) === 0 && (await P.row("AUD-QA-001").getByRole("button", { name: "Clôturer" }).count()) === 1);

  await P.row("AUD-QA-001").getByRole("button", { name: "Clôturer" }).click();
  await P.dialog.waitFor();
  const closeBtn = P.dialog.getByRole("button", { name: "Clôturer" });
  const d0 = await closeBtn.isDisabled();
  await P.dialog.locator("#m-close").fill("   ");
  const d1 = await closeBtn.isDisabled();
  await P.dialog.locator("#m-close").fill("  Mission terminée, constats remis.  ");
  const d2 = await closeBtn.isDisabled();
  await P.page.screenshot({ path: `${SHOTS}/07-cloture-fenetre.png`, fullPage: true });
  check("2.2 « Clôturer » de la fenêtre : inactif à vide, inactif avec espaces seuls, actif avec un commentaire", d0 === true && d1 === true && d2 === false, `vide=${d0}; espaces=${d1}; motif=${d2}`);
  await closeBtn.click();
  await P.dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
  await sleep(600);
  const cl = post("p", `/${m1.id}/close`).at(-1);
  const m1c = await byRef("p", "AUD-QA-001");
  const rowText = (await P.row("AUD-QA-001").innerText()).replace(/\s+/g, " ");
  await P.page.screenshot({ path: `${SHOTS}/08-mission-cloturee.png`, fullPage: true });
  check("2.2 POST /close = 200 corps { comment } rogné", cl?.status === 200 && cl.body?.comment === "Mission terminée, constats remis." && Object.keys(cl.body).length === 1, `status=${cl?.status}; body=${JSON.stringify(cl?.body)}`);
  check("2.2 ligne « Clôturée », commentaire visible, réelle début → fin, plus de Démarrer/Clôturer, bandeau de succès",
    /Clôturée/.test(await P.cell("AUD-QA-001", 1)) && rowText.includes("Mission terminée, constats remis.") && /\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/.test(await P.cell("AUD-QA-001", 3))
      && (await P.row("AUD-QA-001").getByRole("button").count()) === 0 && (await P.page.getByText("Mission AUD-QA-001 clôturée.").count()) === 1, rowText.slice(0, 220));
  check("2.2 API : CLOTUREE + closureComment", m1c?.status === "CLOTUREE" && m1c.closureComment === "Mission terminée, constats remis.", `${m1c?.status}; ${m1c?.closureComment}`);
  const r1 = await api("p", "POST", `${BASE}/${m1.id}/start`, {});
  const r2 = await api("p", "POST", `${BASE}/${m1.id}/close`, { comment: "bis" });
  check("2.3 (bonus) re-démarrer / re-clôturer une mission clôturée : 400, statut inchangé", r1.status === 400 && r2.status === 400 && (await byRef("p", "AUD-QA-001")).status === "CLOTUREE", `start=${r1.status}; close=${r2.status}`);

  // ================================================================================================ 3. Filtre + lecture seule
  const mk = (ref) => api("p", "POST", BASE, { reference: ref, title: `Titre ${ref}`, scope: "Périmètre", leadAuditorId: ids.p, auditorIds: [], plannedStartDate: "2026-11-02", plannedEndDate: "2026-11-30" });
  const s2 = await mk("AUD-QA-002");
  const s3 = await mk("AUD-QA-003");
  const s3s = await api("p", "POST", `${BASE}/${s3.json?.data?.id}/start`, {});
  check("preparation : M2 PLANIFIEE (201), M3 créée puis démarrée (EN_COURS)", s2.status === 201 && s3.status === 201 && s3s.status === 200 && s3s.json?.data?.status === "EN_COURS", `${s2.status}/${s3.status}/${s3s.status}`);
  const m2 = s2.json.data;
  const m3 = s3.json.data;
  await P.goto(); // recharge la liste
  const filt = P.page.locator("select").filter({ has: P.page.locator("option", { hasText: "Tous" }) });
  const sel = async (label) => { await filt.selectOption({ label }); await sleep(700); return (await P.refs()).sort(); };
  const fp = await sel("Planifiée");
  const fe = await sel("En cours");
  const fc = await sel("Clôturée");
  const ft = await sel("Tous");
  await P.page.screenshot({ path: `${SHOTS}/09-filtre-tous.png`, fullPage: true });
  const q = calls.filter((c) => c.who === "p" && c.method === "GET" && c.path.startsWith(`/api/v1${BASE}?status=`)).map((c) => `${c.path.split("=")[1]}:${c.status}`);
  check("3.1 filtre : Planifiée → M2 seule ; En cours → M3 seule ; Clôturée → M1 seule ; Tous → 3 lignes",
    JSON.stringify(fp) === '["AUD-QA-002"]' && JSON.stringify(fe) === '["AUD-QA-003"]' && JSON.stringify(fc) === '["AUD-QA-001"]' && ft.length === 3, JSON.stringify({ fp, fe, fc, ft }));
  check("3.1 chaque filtre = GET ?status= côté serveur (200)", ["PLANIFIEE:200", "EN_COURS:200", "CLOTUREE:200"].every((x) => q.includes(x)), q.join(","));

  const R = await open("r");
  await R.goto();
  await R.page.screenshot({ path: `${SHOTS}/10-lecture-seule-R.png`, fullPage: true });
  const rRefs = (await R.refs()).sort();
  const nb = await R.page.getByRole("button", { name: "Nouvelle mission" }).count();
  const ns = await R.page.getByRole("button", { name: "Démarrer" }).count();
  const nc = await R.page.getByRole("button", { name: "Clôturer" }).count();
  check("3.2 R voit les 3 lignes mais ni « Nouvelle mission », ni « Démarrer », ni « Clôturer »", rRefs.length === 3 && nb === 0 && ns === 0 && nc === 0, `lignes=${rRefs.length}; nouvelle=${nb}; demarrer=${ns}; cloturer=${nc}`);
  const dc = await api("r", "POST", BASE, { reference: "AUD-QA-R", title: "t", scope: "s", leadAuditorId: ids.r, plannedStartDate: "2026-11-02", plannedEndDate: "2026-11-30" });
  const ds = await api("r", "POST", `${BASE}/${m2.id}/start`, {});
  const dl = await api("r", "POST", `${BASE}/${m3.id}/close`, { comment: "tentative" });
  const rl = await api("r", "GET", BASE);
  check("3.2 appels directs de R : create, start, close = 403 ; liste = 200", [dc.status, ds.status, dl.status].every((s) => s === 403) && rl.status === 200, `create=${dc.status}; start=${ds.status}; close=${dl.status}; list=${rl.status}`);
  check("3.2 aucun effet : M2 PLANIFIEE, M3 EN_COURS, pas de mission AUD-QA-R", (await byRef("p", "AUD-QA-002")).status === "PLANIFIEE" && (await byRef("p", "AUD-QA-003")).status === "EN_COURS" && !(await byRef("p", "AUD-QA-R")));

  // ================================================================================================ 4. Sans annuaire (N)
  const N = await open("n");
  await sleep(1500); // l'ecran d'arrivee (hors perimetre) peut produire ses propres 403 : comptes a part
  const landing = N.consoleErrors.length;
  N.consoleErrors.length = 0; N.jsErrors.length = 0;
  const callsBefore = calls.length;
  await N.goto();
  await N.page.getByRole("button", { name: "Nouvelle mission" }).click();
  await N.dialog.waitFor();
  await sleep(500);
  const opts = (await N.dialog.locator("#m-lead option").allInnerTexts()).map((t) => t.trim()).filter((t) => t && !t.startsWith("Sélectionner"));
  const others = await N.dialog.getByText("Autres auditeurs").count();
  await N.page.screenshot({ path: `${SHOTS}/11-sans-annuaire-N.png`, fullPage: true });
  const dir = calls.slice(callsBefore).find((c) => c.path.includes("/users/directory"));
  console.log(`INFO  N : GET /users/directory = ${dir?.status}; options responsable = ${JSON.stringify(opts)}; fieldset « Autres auditeurs » = ${others}`);
  check("4.1 le choix du responsable propose au moins le compte connecté (« Sans Annuaire QA »), aucun autre nom", opts.includes("Sans Annuaire QA") && opts.length === 1, JSON.stringify(opts));
  await N.fillMain("AUD-QA-N", "Mission sans annuaire", "Périmètre N");
  await N.dialog.locator("#m-lead").selectOption({ label: "Sans Annuaire QA" });
  await N.pickDay("Début prévu", 14);
  await N.pickDay("Fin prévue", 22);
  await N.submit().click();
  await N.dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
  await sleep(600);
  const cn = post("n", BASE).at(-1);
  const teamN = await N.cell("AUD-QA-N", 4).catch(() => "(ligne absente)");
  await N.page.screenshot({ path: `${SHOTS}/12-mission-N-creee.png`, fullPage: true });
  check("4.2 N crée une mission avec lui-même comme responsable : 201, équipe = son nom", cn?.status === 201 && /Sans Annuaire QA \(responsable\)/.test(teamN), `status=${cn?.status}; equipe=${teamN}`);
  check("4.3 aucune exception JS et aucun console.error sur la page (hors écran d'arrivée)", N.jsErrors.length === 0 && N.consoleErrors.length === 0, `js=${N.jsErrors.length}; console=${JSON.stringify(N.consoleErrors).slice(0, 300)}`);
  console.log("INFO  appels 403 de N après la navigation : " + JSON.stringify(calls.slice(callsBefore).filter((c) => c.who === "n" && c.status === 403).map((c) => c.method + " " + c.path)));
  console.log(`INFO  erreurs console à l'écran d'arrivée (compte N) : ${landing}`);
  check("aucune exception JS sur tout le parcours (4 contextes)", allJs.length === 0, allJs.join(" | ").slice(0, 300));
  const unexpected = consoleAll.filter((t) => !/Failed to load resource: the server responded with a status of (400|403)/.test(t));
  console.log(`INFO  console.error totales du parcours : ${consoleAll.length} dont inattendues (hors 400/403) : ${unexpected.length} ${JSON.stringify(unexpected).slice(0, 200)}`);
} finally {
  await browser.close();
}
console.log(failures() === 0 ? "\nTERMINE : aucun echec" : `\nTERMINE : ${failures()} echec(s)`);
process.exit(failures() === 0 ? 0 : 1);
