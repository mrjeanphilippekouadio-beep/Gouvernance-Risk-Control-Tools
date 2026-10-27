// QA-F4 : parcours navigateur (Chromium) du lot F4 (branche feat/f4-profil-designations-comptes) contre le VRAI backend
// (tsx, PostgreSQL LOCAL, fournisseur d'identite local, jamais Neon). Les oracles ci-dessous sont ecrits AVANT l'execution.
//
// ORACLES
//  1. Comptes (Administration > Comptes)
//     1.1 113 comptes actifs, page de 100 : page 1 = 100 lignes, « Comptes 1 à 100 », Suivants actif, Précédents inactif ;
//         page 2 = 13 lignes, « Comptes 101 à 113 », Suivants inactif, Précédents actif.
//     1.2 Suspendre : « Confirmer » est inactif sans motif (vide, puis espaces seuls), actif avec un motif.
//         Apres confirmation : PATCH /users/:id/suspend = 200 avec corps { reason } ; le compte disparait de la liste ;
//         la ligne d'audit (GET /audit-log?entityType=User&entityId=<id>) porte action DELETE et reason = le motif saisi.
//     1.3 Reactiver : « Confirmer » inactif sans motif ; avec motif : PATCH /users/:id/reactivate = 200, corps { reason } ;
//         ligne d'audit action UPDATE avec reason = le motif ; le compte est de nouveau actif cote API.
//     1.4 Refus metier : suspendre son propre compte -> 403 du serveur ; la fenetre RESTE ouverte et affiche le message
//         du serveur (« cannot suspend your own account ») ; le compte reste actif ; aucune ligne d'audit DELETE.
//  2. Processus > detail > Responsabilites (politique DOUBLE_CONFIRMATION, un seul detenteur de
//     process.responsibility.assign : l'admin)
//     2.1 avant : pas de badge « Champion désigné sans validation indépendante ».
//     2.2 se nommer champion : 1er PUT = 409 (GOVERNANCE_CONFIRMATION_REQUIRED), la fenetre « Appliquer sans validation
//         indépendante » s'ouvre ; « Confirmer sans validation indépendante » inactif sans motif.
//     2.3 apres motif : 2e PUT = 200 avec governanceConfirmation { rule: noSelfValidation, reason } ; le badge apparait ;
//         l'API renvoie riskChampionWithoutIndependentReview = true ; l'audit du Process porte reason = le motif et
//         governanceException non nul.
//     2.4 champion -> « Autre Compte QA » : un seul PUT = 200 (pas de confirmation) ; le badge disparait ;
//         l'API renvoie riskChampionWithoutIndependentReview = false.
//  3. Profil d'organisation et Désignations
//     3.1 les deux pages s'affichent (titre), aucune exception JS et aucun console.error pendant ces deux pages ;
//     3.2 le questionnaire est SERVI PAR LE SERVEUR : GET /organization-profile -> questionnaire.version + 6 questions ;
//         le formulaire « Remplir le profil » affiche exactement les libelles du serveur (6 questions) ;
//     3.3 Désignations : les deux emplacements (Gérant désigné, Intérimaire du Risk Manager) sont affichés « Vacant »,
//         GET /governance-designations repond 200.
//
// Prerequis (voir docs/qa/qa-f4-front-2026-10-27.md, section Environnement) :
//   - PostgreSQL local, base grc_qa_f4, migrations 001..074 (npm run migrate avec un preload qui retire le TLS) ;
//   - seed : un tenant, admin qa-f4-admin@f4.test (toutes les permissions, seul detenteur de
//     process.responsibility.assign), « Autre Compte QA », « Cible Suspension QA », 110 comptes « Zz Rempli NNN »,
//     configs.self_validation_policy = DOUBLE_CONFIRMATION ;
//   - backend sur 127.0.0.1:8099 (AUTH_PROVIDER=local) ; vite sur 5199 (VITE_API_BASE_URL=http://127.0.0.1:8099,
//     VITE_AUTH_PROVIDER=local, VITE_LOCAL_AUTH_EMAIL=qa-f4-admin@f4.test).
// Chromium : /opt/pw-browsers/chromium ; playwright : /opt/node-tools/node_modules/playwright.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const API = process.env.QA_API ?? "http://127.0.0.1:8099";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/f4";
const ADMIN_EMAIL = "qa-f4-admin@f4.test";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};

async function token(email) {
  const r = await fetch(`${API}/api/v1/auth/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "whatever" }) });
  return (await r.json()).accessToken;
}
let TOK = "";
const api = async (method, path, body) => {
  const r = await fetch(`${API}/api/v1${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${TOK}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
// GET /users est borne a 100 par page (limit max) : on parcourt les pages
const allUsers = async (includeSuspended = false) => {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const page = (await api("GET", `/users?limit=100&offset=${offset}${includeSuspended ? "&includeSuspended=true" : ""}`)).json.data;
    out.push(...page);
    if (page.length < 100) return out;
  }
};
const dirId = async (name) => (await api("GET", "/users/directory")).json.data.find((u) => u.displayName === name)?.id;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
try {
  TOK = await token(ADMIN_EMAIL);
  const adminId = (await api("GET", "/users/me")).json.data.id;

  // --- donnees de depart (via l'API, comme un utilisateur) : un departement et un processus
  // idempotent : reutilise le departement / processus d'un passage precedent (l'etat des responsabilites, lui, doit etre neuf)
  let dept = await api("POST", "/departments", { name: "Département QA F4", manager: "Admin QA F4" });
  if (dept.status !== 201) dept = { status: 201, json: { data: (await api("GET", "/departments")).json.data.find((d) => d.name === "Département QA F4") } };
  let proc = await api("POST", "/processes", { level: "PROCESS", name: "Processus QA F4", departmentId: dept.json?.data?.id });
  if (proc.status !== 201) proc = { status: 201, json: { data: (await api("GET", "/processes")).json.data.find((p) => p.name === "Processus QA F4") } };
  check("preparation : département et processus disponibles", !!dept.json?.data?.id && !!proc.json?.data?.id);
  const processId = proc.json?.data?.id;
  const cibleId = await dirId("Cible Suspension QA");
  const autreId = await dirId("Autre Compte QA");

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let jsErrors = [];
  const allJs = [];
  let consoleErrors = [];
  const calls = [];
  page.on("pageerror", (e) => { jsErrors.push(String(e)); allJs.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("response", async (res) => {
    const req = res.request();
    if (req.method() === "GET" || !res.url().startsWith(API)) return;
    let body = null;
    try { body = req.postDataJSON(); } catch { /* none */ }
    calls.push({ method: req.method(), path: new URL(res.url()).pathname, status: res.status(), body });
  });
  const lastCall = (suffix, method) => calls.filter((c) => c.path.endsWith(suffix) && (!method || c.method === method)).at(-1);

  await page.goto(APP);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await nav.waitFor();
  async function goto(itemName) {
    const admin = nav.locator("button.sidebar-group-toggle", { hasText: /Administration/i });
    if ((await admin.getAttribute("aria-expanded")) !== "true") await admin.click();
    await nav.getByRole("button", { name: new RegExp(`^${itemName}`) }).click();
    await page.locator(".topbar-title strong").filter({ hasText: itemName }).waitFor();
  }
  const auditOf = async (type, id) => (await api("GET", `/audit-log?entityType=${type}&entityId=${id}&limit=100`)).json?.data ?? [];

  // ================================================================================================ 1. Comptes
  await goto("Comptes");
  await page.getByRole("heading", { name: "Comptes" }).waitFor();
  const rows = page.locator("table tbody tr");
  await rows.first().waitFor();
  const pager = page.locator(".core-filter", { hasText: "Comptes 1 à" });
  await page.getByText("Comptes 1 à 100").waitFor({ timeout: 5000 }).catch(() => undefined);
  const p1 = await rows.count();
  const prev1 = await page.getByRole("button", { name: "Précédents" }).isDisabled();
  const next1 = await page.getByRole("button", { name: "Suivants" }).isDisabled();
  check("1.1 liste paginée : page 1 = 100 lignes, « Comptes 1 à 100 », Suivants actif, Précédents inactif", p1 === 100 && prev1 && !next1 && (await page.getByText("Comptes 1 à 100").count()) === 1, `lignes=${p1}; prev disabled=${prev1}; next disabled=${next1}`);
  await page.screenshot({ path: `${SHOTS}/comptes-page1.png` });
  await page.getByRole("button", { name: "Suivants" }).click();
  await page.getByText("Comptes 101 à 113").waitFor({ timeout: 5000 }).catch(() => undefined);
  const p2 = await rows.count();
  check("1.1 page 2 = 13 lignes, « Comptes 101 à 113 », Suivants inactif, Précédents actif", p2 === 13 && (await page.getByRole("button", { name: "Suivants" }).isDisabled()) && !(await page.getByRole("button", { name: "Précédents" }).isDisabled()), `lignes=${p2}`);
  await page.getByRole("button", { name: "Précédents" }).click();
  await page.getByText("Comptes 1 à 100").waitFor({ timeout: 5000 }).catch(() => undefined);
  void pager;

  // ouvre la page qui contient un compte (parcourt les pages)
  async function revealRow(label, buttonName) {
    const btn = page.getByRole("button", { name: buttonName });
    for (let i = 0; i < 3; i++) {
      if ((await btn.count()) > 0) return btn;
      const next = page.getByRole("button", { name: "Suivants" });
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(500);
    }
    return btn;
  }
  const dialog = page.locator("dialog[open]");
  const confirm = dialog.getByRole("button", { name: "Confirmer" });
  const reasonInput = page.locator("#user-status-reason");

  // 1.2 suspension
  const MOTIF_SUSP = "QA F4 : départ de l'équipe";
  await (await revealRow("cible", "Suspendre Cible Suspension QA")).click();
  await reasonInput.waitFor();
  const c0 = await confirm.isDisabled();
  await reasonInput.fill("   ");
  const c1 = await confirm.isDisabled();
  await reasonInput.fill(MOTIF_SUSP);
  const c2 = await confirm.isDisabled();
  check("1.2 Suspendre : Confirmer inactif sans motif (vide, espaces), actif avec motif", c0 && c1 && !c2, `vide=${c0}; espaces=${c1}; motif=${c2}`);
  await page.screenshot({ path: `${SHOTS}/comptes-suspendre.png` });
  await confirm.click();
  await page.getByText("suspendu : il ne peut plus se connecter").waitFor({ timeout: 5000 }).catch(() => undefined);
  const susp = lastCall("/suspend", "PATCH");
  check("1.2 PATCH /suspend = 200, corps { reason } = le motif", susp?.status === 200 && susp.body?.reason === MOTIF_SUSP, `status=${susp?.status}; corps=${JSON.stringify(susp?.body)}`);
  const act = (await allUsers()).find((u) => u.id === cibleId);
  check("1.2 le compte est suspendu côté serveur et absent de la liste", !act && (await page.getByRole("button", { name: "Suspendre Cible Suspension QA" }).count()) === 0);
  const aud1 = (await auditOf("User", cibleId)).filter((e) => e.action === "DELETE");
  check("1.2 audit (entityType=User, entityId) : ligne DELETE avec reason = le motif", aud1.length === 1 && aud1[0].reason === MOTIF_SUSP, JSON.stringify(aud1.map((e) => [e.action, e.reason])));

  // 1.3 reactivation
  const MOTIF_REACT = "QA F4 : retour de mission";
  await page.locator("label.core-filter", { hasText: "Inclure les comptes suspendus" }).locator("input").check();
  await page.waitForTimeout(600);
  await (await revealRow("cible", "Réactiver Cible Suspension QA")).click();
  await reasonInput.waitFor();
  const r0 = await confirm.isDisabled();
  await reasonInput.fill(MOTIF_REACT);
  const r1 = await confirm.isDisabled();
  check("1.3 Réactiver : Confirmer inactif sans motif, actif avec motif", r0 && !r1, `vide=${r0}; motif=${r1}`);
  await confirm.click();
  await page.getByText("réactivé.").first().waitFor({ timeout: 5000 }).catch(() => undefined);
  const re = lastCall("/reactivate", "PATCH");
  const aud2 = (await auditOf("User", cibleId)).filter((e) => e.action === "UPDATE" && e.reason === MOTIF_REACT);
  const back = (await allUsers()).some((u) => u.id === cibleId && !u.deletedAt);
  check("1.3 PATCH /reactivate = 200, corps { reason } ; audit UPDATE avec le motif ; compte actif", re?.status === 200 && re.body?.reason === MOTIF_REACT && aud2.length === 1 && back, `status=${re?.status}; audit=${aud2.length}; actif=${back}`);

  // 1.4 refus metier : suspendre son propre compte
  await page.locator("label.core-filter", { hasText: "Inclure les comptes suspendus" }).locator("input").uncheck();
  await page.waitForTimeout(600);
  await (await revealRow("admin", "Suspendre Admin QA F4")).click();
  await reasonInput.fill("Je me suspends");
  await confirm.click();
  await page.waitForTimeout(800);
  const self = lastCall("/suspend", "PATCH");
  const dlgText = (await dialog.innerText().catch(() => "")).replace(/\s+/g, " ");
  check("1.4 suspendre son propre compte : 403, la fenêtre reste ouverte et montre le message du serveur", self?.path.endsWith(`/${adminId}/suspend`) && self.status === 403 && (await dialog.count()) === 1 && /cannot suspend your own account/i.test(dlgText), `status=${self?.status}; fenêtre=${JSON.stringify(dlgText.slice(0, 220))}`);
  await page.screenshot({ path: `${SHOTS}/comptes-refus-auto-suspension.png` });
  const aud3 = (await auditOf("User", adminId)).filter((e) => e.action === "DELETE");
  const adminActive = (await api("GET", "/users/me")).status === 200;
  check("1.4 le compte reste actif et aucune ligne d'audit DELETE", adminActive && aud3.length === 0);
  await dialog.getByRole("button", { name: "Annuler" }).click();

  // ================================================================================================ 2. Processus
  await goto("Processus");
  await page.getByRole("button", { name: "Voir le détail de Processus QA F4" }).click();
  const card = page.locator(".card, [class*=card]").filter({ hasText: "Responsabilités" }).last();
  await page.locator("#resp-riskChampionUserId").waitFor();
  const badge = page.getByText("Champion désigné sans validation indépendante");
  check("2.1 avant : pas de badge (le détenteur unique de process.responsibility.assign n'est pas encore champion)", (await badge.count()) === 0);
  void card;
  await page.locator("#resp-riskChampionUserId").selectOption({ label: "Admin QA F4" });
  await page.getByRole("button", { name: "Enregistrer les responsabilités" }).click();
  const gov = page.locator("dialog[open]").filter({ hasText: "Appliquer sans validation indépendante" });
  await gov.waitFor({ timeout: 5000 }).catch(() => undefined);
  const put1 = calls.filter((c) => c.method === "PUT" && c.path.endsWith(`/processes/${processId}/responsibilities`));
  const gbtn = gov.getByRole("button", { name: "Confirmer sans validation indépendante" });
  check("2.2 se nommer champion : 1er PUT = 409, la double confirmation s'ouvre, Confirmer inactif sans motif", put1[0]?.status === 409 && (await gov.count()) === 1 && (await gbtn.isDisabled()), `statuts=${put1.map((c) => c.status)}`);
  await page.screenshot({ path: `${SHOTS}/processus-double-confirmation.png` });
  const MOTIF_CH = "QA F4 : structure à une personne";
  await gov.locator("#gov-confirm-reason").fill(MOTIF_CH);
  await gbtn.click();
  await badge.first().waitFor({ timeout: 5000 }).catch(() => undefined);
  const put2 = calls.filter((c) => c.method === "PUT" && c.path.endsWith(`/processes/${processId}/responsibilities`)).at(-1);
  const resp1 = (await api("GET", `/processes/${processId}/responsibilities`)).json?.data;
  const pAud = (await auditOf("Process", processId)).filter((e) => e.reason === MOTIF_CH);
  check("2.3 2e PUT = 200 avec governanceConfirmation { noSelfValidation, motif } ; le badge apparaît", put2?.status === 200 && put2.body?.governanceConfirmation?.rule === "noSelfValidation" && put2.body.governanceConfirmation.reason === MOTIF_CH && (await badge.count()) === 1, `status=${put2?.status}; badge=${await badge.count()}`);
  check("2.3 l'API renvoie riskChampionWithoutIndependentReview=true et l'audit porte motif + governanceException", resp1?.riskChampionWithoutIndependentReview === true && pAud.length === 1 && !!pAud[0].governanceException, `flag=${resp1?.riskChampionWithoutIndependentReview}; audit=${JSON.stringify(pAud.map((e) => e.governanceException))}`);
  await page.screenshot({ path: `${SHOTS}/processus-badge-champion.png` });

  const before = calls.filter((c) => c.method === "PUT" && c.path.endsWith(`/processes/${processId}/responsibilities`)).length;
  await page.locator("#resp-riskChampionUserId").selectOption({ label: "Autre Compte QA" });
  await page.getByRole("button", { name: "Enregistrer les responsabilités" }).click();
  await page.waitForTimeout(1200);
  const after = calls.filter((c) => c.method === "PUT" && c.path.endsWith(`/processes/${processId}/responsibilities`));
  const resp2 = (await api("GET", `/processes/${processId}/responsibilities`)).json?.data;
  check("2.4 champion -> autre compte : un seul PUT = 200 sans confirmation, le badge disparaît", after.length === before + 1 && after.at(-1).status === 200 && !after.at(-1).body?.governanceConfirmation && (await badge.count()) === 0 && resp2?.riskChampionUserId === autreId && resp2?.riskChampionWithoutIndependentReview === false, `PUT=${after.length - before}; status=${after.at(-1)?.status}; badge=${await badge.count()}; flag=${resp2?.riskChampionWithoutIndependentReview}`);
  await page.screenshot({ path: `${SHOTS}/processus-badge-disparu.png` });

  // ================================================================================================ 3. Profil et Désignations
  jsErrors = []; consoleErrors = [];
  await goto("Profil d'organisation");
  await page.getByRole("heading", { name: "Profil d'organisation" }).waitFor();
  const srv = (await api("GET", "/organization-profile")).json?.data;
  const questions = srv?.questionnaire?.questions ?? [];
  check("3.2 GET /organization-profile sert un questionnaire de 6 questions avec sa version", questions.length === 6 && !!srv.questionnaire.version, `version=${srv?.questionnaire?.version}; n=${questions.length}`);
  await page.getByRole("button", { name: "Remplir le profil" }).click();
  const form = page.locator("#org-profile-form");
  await form.waitFor();
  const formText = await form.textContent(); // textContent : le CSS met les libellés de champ en majuscules (innerText)
  const missing = questions.filter((q) => !formText.includes(q.label)).map((q) => q.id);
  check("3.2 le formulaire affiche exactement les 6 libellés du serveur", missing.length === 0, `manquants=${missing}`);
  await page.screenshot({ path: `${SHOTS}/profil-questionnaire.png` });
  await page.locator("dialog[open]").getByRole("button", { name: "Annuler" }).click();
  await page.waitForTimeout(300);
  await goto("Désignations");
  await page.getByRole("heading", { name: "Désignations" }).waitFor();
  await page.waitForTimeout(800);
  const dsg = await api("GET", "/governance-designations");
  const vacant = await page.getByText("Vacant", { exact: true }).count();
  check("3.3 Désignations : deux emplacements « Vacant », GET /governance-designations = 200", dsg.status === 200 && vacant === 2 && (await page.getByText("Gérant désigné").count()) > 0 && (await page.getByText("Intérimaire du Risk Manager").count()) > 0, `status=${dsg.status}; vacant=${vacant}`);
  await page.screenshot({ path: `${SHOTS}/designations.png` });
  check("3.1 aucune exception JS ni console.error sur Profil d'organisation et Désignations", jsErrors.length === 0 && consoleErrors.length === 0, [...jsErrors, ...consoleErrors].join(" | ").slice(0, 300));
  check("aucune exception JavaScript sur l'ensemble du parcours", allJs.length === 0, allJs.join(" | ").slice(0, 300));
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nTERMINE : aucun echec" : `\nTERMINE : ${failures} echec(s)`);
process.exit(failures === 0 ? 0 : 1);
