// QA droits par ligne de defense (DECISION-098/101/103, q188/q189/q200) : parcours navigateur (Chromium) de « Matrice des droits »
// contre le VRAI backend (tsx, PostgreSQL 16 LOCAL, fournisseur local, jamais Neon, jamais Google). Oracles ecrits AVANT l'execution.
// Comptes (<nom>@rl.test, mot de passe « whatever »), voir qa-rights-lines-setup.sh :
//   adm  Admin Droits (role.read, role.assign : administrateur)   rm1/rm2 Manager Un/Deux (groupe Risk Manager)
//   com  Comite Membre (groupe Comite + role.read direct)          com0 Comite Sans Lecture (groupe Comite seul, pas de role.read)
//   aud  Auditeur Interne (groupe Audit)   stf Agent Premiere Ligne (role Analyste QA)   roa Admin Par Role (role Administrateurs QA)
//
// ORACLES
//  0. API : rm1 -> /roles, /roles/matrix, /roles/accounts sans Audit ni Administrateurs QA ni aud/adm/roa ; /roles/:id et /roles/users/:id/permission-sources
//     d'un cache == id inconnu (404, meme corps hors id) ; adm voit tout ; les lignes portent ADMIN / AUDIT / LINE_2 / LINE_1.
//  1. rm1, ecran : colonnes de la matrice = Risk Manager, Comite, Analyste QA, chacune avec son badge de ligne (« 2e ligne », « 1re ligne »),
//     aucune colonne Audit ni Administrateurs QA ; onglet « Droits d'un compte » : ni aud, ni adm, ni roa dans la liste, badge de ligne apres choix ;
//     pas d'onglet « Vue élargie du Risk Manager » ; zero erreur console/JS.
//  2. adm, ecran : toutes les colonnes avec badges « Administrateur » et « Audit (3e ligne) » ; tous les comptes dans la liste ; onglet « Vue élargie » present.
//  3. Demande : adm choisit Manager Un + motif -> ligne « En attente de confirmation » ; audit SUBMIT ; notification SENSITIVE_VIEW_GRANT_PENDING a
//     com, com0, aud seulement (ni adm, ni rm1) ; rm1 ne voit toujours pas l'Audit ; adm (auteur) et rm1 (beneficiaire) : 403 en confirmation, pas de bouton Confirmer pour adm.
//  4. com0 (Comite sans role.read) : entree « Matrice des droits » presente (QA-RL-03, corrige) ; seul l'onglet des vues elargies, demande avec Confirmer.
//  5. com, ecran : onglet « Vue élargie » -> Confirmer -> « Active » ; audit APPROVE par com.
//  6. rm1 (nouvelle session) voit TOUT : colonnes Audit et Administrateurs QA avec badges, comptes aud/adm/roa dans la liste, droits de aud ouverts, source
//     « Vue élargie confirmée » sur son propre compte ; rm2 reste restreint (API).
//  7. Retrait : adm saisit un motif, « Retirer » -> « Retirée » ; audit UNASSIGN avec motif ; rm1 ne voit plus l'Audit (API puis ecran) ; aud -> 404 pour rm1.
//  8. Sortie du groupe par l'application : la vue elargie de rm2 passe REVOKED (audit UNASSIGN) ; son retour ne la rend pas (SEC-RL-05).
//  9. com0 (sans role.read) confirme une nouvelle demande a l'ecran : APPROVED, decideur com0, rm1 voit l'Audit.
//
// Prerequis : tests/integration/qa-rights-lines-setup.sh up ; backend 127.0.0.1:8099 (AUTH_PROVIDER=local, preload qa-f7s1-test-preload.mjs) ;
// vite 127.0.0.1:5199 (VITE_AUTH_PROVIDER=local, VITE_API_BASE_URL). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB_PORT.
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const API = process.env.QA_API ?? "http://127.0.0.1:8099";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/rights-lines";
const PG = ["-h", "127.0.0.1", "-p", process.env.QA_DB_PORT ?? "55438", "-U", "postgres", "-d", "grc_qa_rl", "-Atq"];
const EMAIL = Object.fromEntries(["adm", "rm1", "rm2", "com", "com0", "aud", "stf", "roa"].map((n) => [n, `${n}@rl.test`]));
mkdirSync(SHOTS, { recursive: true });
// Absolute path: never resolve psql through PATH (Sonar S4036).
const PSQL = process.env.QA_PSQL ?? "/usr/bin/psql";
const sql = (q) => execFileSync(PSQL, [...PG, "-c", q], { encoding: "utf8" }).trim();

const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const byText = (a, b) => a.localeCompare(b);
const same = (a, b) => JSON.stringify([...a].sort(byText)) === JSON.stringify([...b].sort(byText));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
async function open(who) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await context.newPage();
  const st = { page, context, consoleErrors: [], jsErrors: [], calls: [] };
  page.on("pageerror", (e) => st.jsErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") st.consoleErrors.push(m.text()); });
  page.on("response", (res) => {
    if (res.url().startsWith(API)) st.calls.push({ method: res.request().method(), path: new URL(res.url()).pathname, status: res.status() });
  });
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await page.goto(APP);
  await page.getByLabel("Adresse e-mail QA").fill(EMAIL[who]);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await nav.waitFor();
  await sleep(800);
  st.nav = nav;
  st.menuEntries = async () => {
    const group = nav.locator("button.sidebar-group-toggle", { hasText: /Administration/i });
    if ((await group.count()) === 0) return [];
    if ((await group.first().getAttribute("aria-expanded")) !== "true") await group.first().click();
    return (await nav.locator("button").allInnerTexts()).map(norm);
  };
  st.goto = async () => {
    await st.menuEntries();
    await nav.getByRole("button", { name: /^Matrice des droits/ }).click();
    await page.getByRole("heading", { name: "Matrice des droits" }).waitFor();
    await sleep(900);
    st.consoleErrors.length = 0; // l'ecran d'arrivee est hors perimetre (403 attendus sans droit de lecture metier)
  };
  st.seg = () => page.getByRole("group", { name: "Vue" });
  st.tab = async (name) => { await st.seg().getByRole("button", { name }).click(); await sleep(900); };
  st.headers = async () => (await page.locator("table thead th").allTextContents()).map(norm);
  st.options = async () => (await page.locator("#rights-user option").allInnerTexts()).map(norm);
  return st;
}

try {
  for (const w of ["adm", "rm1", "rm2", "com", "com0", "aud"]) await login(w);
  const me = {};
  for (const w of ["adm", "rm1", "rm2", "com", "com0", "aud"]) me[w] = (await api(w, "GET", "/users/me")).json?.data?.id;
  me.stf = sql("select id from users where email='stf@rl.test'");
  me.roa = sql("select id from users where email='roa@rl.test'");
  const roleId = (name) => sql(`select id from roles where name='${name}' and tenant_id=(select tenant_id from users where email='adm@rl.test')`);
  const audRoleId = roleId("Audit");
  const admRoleId = roleId("Administrateurs QA");
  check("preparation : 6 comptes connectés, identifiants lus", Object.values(me).every(Boolean));

  // ================================================================================================ 0. API
  const accountsOf = async (w) => ((await api(w, "GET", "/roles/accounts")).json?.data ?? []);
  const restrictedIds = (await accountsOf("rm1")).map((a) => a.id);
  const fullAccounts = await accountsOf("adm");
  check("0.1 rm1 : /roles/accounts = 1re et 2e ligne seulement (stf, rm1, rm2, com, com0), sans aud/adm/roa",
    same(restrictedIds, [me.stf, me.rm1, me.rm2, me.com, me.com0]), `${restrictedIds.length} comptes`);
  check("0.1 adm : voit les 8 comptes, lignes ADMIN/AUDIT/LINE_2/LINE_1 correctes",
    fullAccounts.length === 8 && fullAccounts.find((a) => a.id === me.aud)?.line === "AUDIT" && fullAccounts.find((a) => a.id === me.roa)?.line === "ADMIN"
      && fullAccounts.find((a) => a.id === me.adm)?.line === "ADMIN" && fullAccounts.find((a) => a.id === me.rm1)?.line === "LINE_2" && fullAccounts.find((a) => a.id === me.stf)?.line === "LINE_1",
    JSON.stringify(fullAccounts.map((a) => a.line)));
  const rolesRm = (await api("rm1", "GET", "/roles")).json?.data ?? [];
  const matrixRm = (await api("rm1", "GET", "/roles/matrix")).json?.data ?? [];
  const bodies = JSON.stringify([rolesRm, matrixRm]);
  check("0.2 rm1 : /roles et /roles/matrix sans rôle Audit ni Administrateurs QA (nom, id, droits audit.read)",
    !/"Audit"|Administrateurs QA|audit\.read/.test(bodies) && !bodies.includes(audRoleId) && !bodies.includes(admRoleId) && rolesRm.length === 3 && matrixRm.length === 3, `roles=${rolesRm.length}`);
  const unknownId = "00000000-0000-4000-8000-0000000000aa";
  const unknownRole = await api("rm1", "GET", `/roles/${unknownId}`);
  const strip = (r, id) => JSON.stringify(r.json).split(id).join("<ID>").replace(/"requestId":"[^"]*"/, "");
  for (const [label, id] of [["Audit", audRoleId], ["Administrateurs QA", admRoleId]]) {
    const r = await api("rm1", "GET", `/roles/${id}`);
    check(`0.3 rm1 : GET /roles/<${label}> == id inconnu (404, même corps hors id)`, r.status === 404 && unknownRole.status === 404 && strip(r, id) === strip(unknownRole, unknownId), `status=${r.status}`);
  }
  const unknownSrc = await api("rm1", "GET", `/roles/users/${unknownId}/permission-sources`);
  for (const w of ["aud", "adm", "roa"]) {
    const r = await api("rm1", "GET", `/roles/users/${me[w]}/permission-sources`);
    const p = await api("rm1", "GET", `/roles/users/${me[w]}/permissions`);
    check(`0.3 rm1 : permission-sources et permissions de ${w} == compte inconnu (404, même corps)`,
      r.status === 404 && p.status === 404 && unknownSrc.status === 404 && strip(r, me[w]) === strip(unknownSrc, unknownId), `src=${r.status}; perms=${p.status}`);
  }
  const hiddenSheet = await api("rm1", "GET", `/roles/users/${me.aud}`);
  const unknownSheet = await api("rm1", "GET", `/roles/users/${unknownId}`);
  check("0.4 [QA-RL-02] fiche /roles/users/:id : un compte Audit caché répond comme un id inconnu",
    hiddenSheet.status === unknownSheet.status, `compte Audit=${hiddenSheet.status}; inconnu=${unknownSheet.status}`);
  const nonUuid = await api("adm", "GET", "/roles/not-a-uuid");
  check("0.5 [QA-RL-01] GET /roles/not-a-uuid : 4xx (pas de 500)", nonUuid.status >= 400 && nonUuid.status < 500, `status=${nonUuid.status}`);
  check("0.6 la demande ne prend aucun champ d'attribution du client (requestedBy / status) : 400",
    (await api("adm", "POST", "/roles/sensitive-view-grants", { userId: me.rm1, reason: "x", requestedBy: me.com })).status === 400
    && (await api("adm", "POST", "/roles/sensitive-view-grants", { userId: me.rm1, reason: "x", status: "APPROVED" })).status === 400);
  check("0.7 rm1 (role.read seul) : liste des demandes et demande = 403 ; demande hors groupe Risk Manager (stf) = 400 ; pour soi-même = 403",
    (await api("rm1", "GET", "/roles/sensitive-view-grants")).status === 403
    && (await api("rm1", "POST", "/roles/sensitive-view-grants", { userId: me.rm2, reason: "x" })).status === 403
    && (await api("adm", "POST", "/roles/sensitive-view-grants", { userId: me.stf, reason: "x" })).status === 400
    && (await api("adm", "POST", "/roles/sensitive-view-grants", { userId: me.adm, reason: "x" })).status === 403);

  // ================================================================================================ 1. rm1 restreint, ecran
  const R = await open("rm1");
  const rmEntries = await R.menuEntries();
  check("1.0 rm1 voit l'entrée « Matrice des droits » (q187)", rmEntries.some((t) => /^Matrice des droits/.test(t)), rmEntries.join("|"));
  await R.goto();
  const rmHeaders = await R.headers();
  await R.page.screenshot({ path: `${SHOTS}/01-rm1-matrice-restreinte.png`, fullPage: true });
  check("1.1 colonnes = Risk Manager · 2e ligne, Comité · 2e ligne, Analyste QA · 1re ligne ; ni Audit ni Administrateurs QA",
    rmHeaders.length === 4 && rmHeaders.some((h) => /Risk Manager.*· 2e ligne/.test(h)) && rmHeaders.some((h) => /Comité.*· 2e ligne/.test(h))
      && rmHeaders.some((h) => /Analyste QA · 1re ligne/.test(h)) && !rmHeaders.some((h) => /Audit|Administrateurs/.test(h)), rmHeaders.join(" | "));
  check("1.2 rm1 : pas d'onglet « Vue élargie du Risk Manager » (ni role.assign ni droit de décision)",
    (await R.seg().getByRole("button", { name: "Vue élargie du Risk Manager" }).count()) === 0);
  await R.tab("Droits d'un compte");
  const rmOptions = await R.options();
  check("1.3 liste des comptes de rm1 : ni Auditeur Interne, ni Admin Droits, ni Admin Par Role",
    !rmOptions.some((o) => /Auditeur|Admin Droits|Admin Par Role/.test(o)) && rmOptions.includes("Agent Premiere Ligne") && rmOptions.includes("Comite Membre"), rmOptions.join(" | "));
  await R.page.locator("#rights-user").selectOption({ label: "Agent Premiere Ligne" });
  await sleep(1000);
  check("1.4 compte 1re ligne choisi : badge « 1re ligne » affiché", (await R.page.getByText("1re ligne", { exact: true }).count()) >= 1);
  await R.page.locator("#rights-user").selectOption({ label: "Comite Membre" });
  await sleep(1000);
  check("1.4 compte 2e ligne choisi : badge « 2e ligne » affiché", (await R.page.getByText("2e ligne", { exact: true }).count()) >= 1);
  check("1.5 aucune erreur console ni exception JS (écran restreint)", R.consoleErrors.length === 0 && R.jsErrors.length === 0, [...R.consoleErrors, ...R.jsErrors].join(" ; ").slice(0, 200));
  await R.context.close();

  // ================================================================================================ 2. adm, ecran
  const A = await open("adm");
  await A.goto();
  const admHeaders = await A.headers();
  await A.page.screenshot({ path: `${SHOTS}/02-adm-matrice-complete.png`, fullPage: true });
  check("2.1 adm : 6 colonnes dont Audit · Audit (3e ligne) et Administrateurs QA · Administrateur",
    admHeaders.length === 6 && admHeaders.some((h) => /Audit.*· Audit \(3e ligne\)/.test(h)) && admHeaders.some((h) => /Administrateurs QA · Administrateur/.test(h)), admHeaders.join(" | "));
  check("2.2 adm : onglet « Vue élargie du Risk Manager » présent", (await A.seg().getByRole("button", { name: "Vue élargie du Risk Manager" }).count()) === 1);
  await A.tab("Droits d'un compte");
  const admOptions = await A.options();
  check("2.3 adm : les 8 comptes dans la liste", ["Auditeur Interne", "Admin Droits", "Admin Par Role", "Manager Un", "Comite Membre"].every((n) => admOptions.includes(n)), admOptions.join(" | "));
  await A.page.locator("#rights-user").selectOption({ label: "Auditeur Interne" });
  await sleep(1000);
  check("2.4 adm : badge « Audit (3e ligne) » sur le compte Auditeur", (await A.page.getByText("Audit (3e ligne)", { exact: true }).count()) >= 1);

  // ================================================================================================ 3. demande
  await A.tab("Vue élargie du Risk Manager");
  check("3.0 avant demande : « Aucune vue élargie demandée. »", (await A.page.getByText("Aucune vue élargie demandée.").count()) === 1);
  const pick = A.page.getByLabel("Membre du Risk Manager");
  const pickOptions = (await pick.locator("option").allInnerTexts()).map(norm);
  check("3.1 la liste de demande ne propose que des comptes de 2e ligne (aucun admin, aucun Audit, aucun agent)",
    !pickOptions.some((o) => /Admin|Auditeur|Agent/.test(o)) && pickOptions.includes("Manager Un"), pickOptions.join(" | "));
  await pick.selectOption({ label: "Manager Un" });
  check("3.2 « Demander » est inactif sans motif", await A.page.getByRole("button", { name: "Demander" }).isDisabled());
  await A.page.getByLabel("Motif").fill("Contrôle trimestriel des habilitations");
  await A.page.getByRole("button", { name: "Demander" }).click();
  await sleep(1200);
  const pendingRow = A.page.locator("table tbody tr", { hasText: "Manager Un" });
  check("3.3 demande créée : ligne « En attente de confirmation » pour Manager Un", (await pendingRow.filter({ hasText: "En attente de confirmation" }).count()) === 1);
  check("3.4 adm (auteur) n'a pas de bouton Confirmer ; il a Retirer", (await pendingRow.getByRole("button", { name: "Confirmer" }).count()) === 0 && (await pendingRow.getByRole("button", { name: "Retirer" }).count()) === 1);
  await A.page.screenshot({ path: `${SHOTS}/03-demande-en-attente.png`, fullPage: true });
  const grantId = sql("select id from sensitive_view_grants where user_id=(select id from users where email='rm1@rl.test') and status='PENDING'");
  check("3.5 audit SUBMIT écrit par adm", sql(`select count(*) from audit_log where entity_type='SensitiveViewGrant' and entity_id='${grantId}' and action='SUBMIT' and user_id='${me.adm}'`) === "1");
  const recipients = sql(`select recipient_user_id from notifications where event_type='SENSITIVE_VIEW_GRANT_PENDING' and resource_id='${grantId}'`).split("\n").filter(Boolean);
  check("3.6 notification SENSITIVE_VIEW_GRANT_PENDING : com, com0, aud seulement (ni l'auteur ni le bénéficiaire)",
    same(recipients, [me.com, me.com0, me.aud]), `${recipients.length} destinataires`);
  check("3.7 rm1 ne voit toujours pas l'Audit tant que la demande est en attente", !(await accountsOf("rm1")).some((a) => a.id === me.aud));
  check("3.8 l'auteur (adm) et le bénéficiaire (rm1) ne peuvent pas confirmer : 403 ; un compte sans droit non plus",
    (await api("adm", "POST", `/roles/sensitive-view-grants/${grantId}/approve`, {})).status === 403
    && (await api("rm1", "POST", `/roles/sensitive-view-grants/${grantId}/approve`, {})).status === 403
    && (await api("rm2", "POST", `/roles/sensitive-view-grants/${grantId}/approve`, {})).status === 403
    && sql(`select status from sensitive_view_grants where id='${grantId}'`) === "PENDING");
  check("3.9 une seconde demande pour le même compte : 409 (une seule demande vivante)",
    (await api("adm", "POST", "/roles/sensitive-view-grants", { userId: me.rm1, reason: "Doublon" })).status === 409);
  await A.context.close();

  // ================================================================================================ 4. com0 : confirmeur sans role.read
  const C0 = await open("com0");
  const c0Entries = await C0.menuEntries();
  check("4.1 [QA-RL-03] com0 (groupe Comité seul, droit de confirmer) : l'entrée « Matrice des droits » s'affiche",
    c0Entries.some((t) => /^Matrice des droits/.test(t)), `entrées=${c0Entries.filter((t) => /Matrice|Comptes|Rôles/.test(t)).join("|") || "(aucune)"}`);
  check("4.2 com0 voit la demande par l'API (liste 200, 1 demande en attente)",
    (await api("com0", "GET", "/roles/sensitive-view-grants")).json?.data?.some((g) => g.id === grantId && g.status === "PENDING") === true);
  await C0.goto();
  const c0Pending = C0.page.locator("table tbody tr", { hasText: "En attente de confirmation" });
  check("4.3 [QA-RL-03] com0 sans role.read : pas d'onglets matrice/compte, la demande en attente avec Confirmer et Refuser",
    (await C0.seg().count()) === 0 && (await c0Pending.count()) === 1 && (await c0Pending.getByRole("button", { name: "Confirmer" }).count()) === 1
      && (await C0.page.getByText("Chargement impossible").count()) === 0);
  await C0.context.close();

  // ================================================================================================ 5. com confirme, ecran
  const C = await open("com");
  await C.goto();
  await C.tab("Vue élargie du Risk Manager");
  const comRow = C.page.locator("table tbody tr", { hasText: "Manager Un" });
  check("5.1 com voit la demande avec Confirmer et Refuser ; Refuser inactif sans motif ; pas de Retirer (pas role.assign)",
    (await comRow.getByRole("button", { name: "Confirmer" }).count()) === 1 && (await comRow.getByRole("button", { name: "Refuser" }).isDisabled())
      && (await comRow.getByRole("button", { name: "Retirer" }).count()) === 0);
  await C.page.screenshot({ path: `${SHOTS}/05-comite-confirme.png`, fullPage: true });
  await comRow.getByRole("button", { name: "Confirmer" }).click();
  await sleep(1200);
  check("5.2 après confirmation : ligne « Active »", (await C.page.locator("table tbody tr", { hasText: "Manager Un" }).filter({ hasText: "Active" }).count()) === 1);
  check("5.3 audit APPROVE écrit par com ; statut APPROVED en base ; décideur != auteur != bénéficiaire",
    sql(`select count(*) from audit_log where entity_id='${grantId}' and action='APPROVE' and user_id='${me.com}'`) === "1"
    && sql(`select status from sensitive_view_grants where id='${grantId}'`) === "APPROVED"
    && sql(`select (decided_by <> requested_by and decided_by <> user_id) from sensitive_view_grants where id='${grantId}'`) === "t");
  check("5.4 re-confirmer la même demande : 409, état inchangé", (await api("com", "POST", `/roles/sensitive-view-grants/${grantId}/approve`, {})).status === 409);
  await C.context.close();

  // ================================================================================================ 6. rm1 voit tout
  const R2 = await open("rm1");
  await R2.goto();
  const wideHeaders = await R2.headers();
  await R2.page.screenshot({ path: `${SHOTS}/06-rm1-vue-elargie.png`, fullPage: true });
  check("6.1 rm1 : 6 colonnes, Audit et Administrateurs QA avec leurs badges", wideHeaders.length === 6 && wideHeaders.some((h) => /Audit.*· Audit \(3e ligne\)/.test(h)) && wideHeaders.some((h) => /Administrateurs QA · Administrateur/.test(h)), wideHeaders.join(" | "));
  await R2.tab("Droits d'un compte");
  const wideOptions = await R2.options();
  check("6.2 rm1 : Auditeur Interne, Admin Droits, Admin Par Role dans la liste", ["Auditeur Interne", "Admin Droits", "Admin Par Role"].every((n) => wideOptions.includes(n)), wideOptions.join(" | "));
  await R2.page.locator("#rights-user").selectOption({ label: "Auditeur Interne" });
  await sleep(1200);
  check("6.3 droits de l'Auditeur affichés (ligne audit.read), sans erreur", (await R2.page.locator("table tbody tr", { hasText: "audit.read" }).count()) >= 1 && (await R2.page.getByText("Chargement impossible").count()) === 0);
  await R2.page.locator("#rights-user").selectOption({ label: "Manager Un" });
  await sleep(1200);
  const srcRow = R2.page.locator("table tbody tr", { hasText: "role.read.sensitive" });
  check("6.4 sur son propre compte : ligne role.read.sensitive d'origine « Vue élargie confirmée »", (await srcRow.count()) === 1 && /Vue élargie confirmée/.test(await srcRow.innerText()), norm(await srcRow.first().innerText().catch(() => "")));
  check("6.5 rm2 (même groupe, sans confirmation) reste restreint par l'API", !(await accountsOf("rm2")).some((a) => a.id === me.aud) && (await api("rm2", "GET", `/roles/${audRoleId}`)).status === 404);
  check("6.6 aucune erreur console ni exception JS (écran élargi)", R2.consoleErrors.length === 0 && R2.jsErrors.length === 0, [...R2.consoleErrors, ...R2.jsErrors].join(" ; ").slice(0, 200));
  await R2.context.close();

  // ================================================================================================ 7. retrait
  const A2 = await open("adm");
  await A2.goto();
  await A2.tab("Vue élargie du Risk Manager");
  const activeRow = A2.page.locator("table tbody tr", { hasText: "Manager Un" });
  check("7.1 « Retirer » inactif sans motif", await activeRow.getByRole("button", { name: "Retirer" }).isDisabled());
  await A2.page.getByLabel("Motif").fill("Mission de contrôle terminée");
  await activeRow.getByRole("button", { name: "Retirer" }).click();
  await sleep(1200);
  check("7.2 après retrait : ligne « Retirée » et motif affiché", (await A2.page.locator("table tbody tr", { hasText: "Manager Un" }).filter({ hasText: "Retirée" }).count()) === 1
    && (await A2.page.getByText("Mission de contrôle terminée").count()) >= 1);
  check("7.3 audit UNASSIGN avec le motif, écrit par adm", sql(`select count(*) from audit_log where entity_id='${grantId}' and action='UNASSIGN' and user_id='${me.adm}' and reason='Mission de contrôle terminée'`) === "1");
  check("7.4 rm1 : l'Audit n'est plus visible (accounts, rôle, compte) -> 404 comme un inconnu",
    !(await accountsOf("rm1")).some((a) => a.id === me.aud) && (await api("rm1", "GET", `/roles/${audRoleId}`)).status === 404
    && (await api("rm1", "GET", `/roles/users/${me.aud}/permission-sources`)).status === 404);
  check("7.5 retirer une seconde fois : 409 ; confirmer après retrait : 409",
    (await api("adm", "POST", `/roles/sensitive-view-grants/${grantId}/revoke`, { reason: "Encore" })).status === 409
    && (await api("com", "POST", `/roles/sensitive-view-grants/${grantId}/approve`, {})).status === 409);
  await A2.context.close();
  const R3 = await open("rm1");
  await R3.goto();
  const backHeaders = await R3.headers();
  check("7.6 rm1 (écran, nouvelle session) : colonnes Audit et Administrateurs QA disparues", backHeaders.length === 4 && !backHeaders.some((h) => /Audit|Administrateurs/.test(h)), backHeaders.join(" | "));
  await R3.page.screenshot({ path: `${SHOTS}/07-rm1-apres-retrait.png`, fullPage: true });
  await R3.context.close();

  // ================================================================================================ 8. sortie du groupe
  const g2 = (await api("adm", "POST", "/roles/sensitive-view-grants", { userId: me.rm2, reason: "Contrôle rm2" })).json?.data?.id;
  const ok = (await api("aud", "POST", `/roles/sensitive-view-grants/${g2}/approve`, {})).status === 200;
  check("8.1 une demande pour rm2 confirmée par un membre de l'Audit : rm2 voit l'Audit", ok && (await accountsOf("rm2")).some((a) => a.id === me.aud));
  // SEC-RL-05: leaving the group through the application ends the widened view for good (REVOKED, audited).
  await api("adm", "POST", `/roles/${roleId("Analyste QA")}/assign`, { userId: me.rm2 }); // rm2 keeps another role
  const rmRoleId = sql(`select id from roles where system_group='RISK_MANAGER' and tenant_id=(select tenant_id from users where id='${me.rm2}')`);
  const leave = await api("adm", "POST", `/roles/${rmRoleId}/revoke`, { userId: me.rm2, reason: "Changement de fonction" });
  const afterLeave = await api("rm2", "GET", "/roles/accounts");
  check("8.2 [SEC-RL-05] rm2 retiré du groupe Risk Manager : vue élargie REVOKED (audit UNASSIGN), plus rien de l'Audit",
    leave.status < 300 && sql(`select status from sensitive_view_grants where id='${g2}'`) === "REVOKED"
      && sql(`select count(*) from audit_log where entity_id='${g2}' and action='UNASSIGN'`) === "1"
      && (afterLeave.status === 403 || !(afterLeave.json?.data ?? []).some((a) => a.id === me.aud)), `leave=${leave.status} accounts=${afterLeave.status}`);
  await api("adm", "POST", `/roles/${rmRoleId}/assign`, { userId: me.rm2, reason: "Retour dans la fonction" });
  check("8.3 [SEC-RL-05] retour de rm2 dans le groupe : toujours aucune vue élargie (il faut une nouvelle demande)",
    !(await accountsOf("rm2")).some((a) => a.id === me.aud));

  // ================================================================================================ 9. com0 confirme a l'ecran
  const g3 = (await api("adm", "POST", "/roles/sensitive-view-grants", { userId: me.rm1, reason: "Nouveau contrôle" })).json?.data?.id;
  const C9 = await open("com0");
  await C9.goto();
  const row9 = C9.page.locator("table tbody tr", { hasText: "En attente de confirmation" });
  await row9.getByRole("button", { name: "Confirmer" }).click();
  await sleep(1200);
  check("9.1 [QA-RL-03] com0 (Comité, sans role.read) confirme à l'écran : demande APPROVED, décideur com0, rm1 voit l'Audit",
    sql(`select status from sensitive_view_grants where id='${g3}'`) === "APPROVED" && sql(`select decided_by from sensitive_view_grants where id='${g3}'`) === me.com0
      && (await accountsOf("rm1")).some((a) => a.id === me.aud));
  check("9.2 aucune erreur console ni exception JS (écran du confirmateur)", C9.consoleErrors.length === 0 && C9.jsErrors.length === 0, [...C9.consoleErrors, ...C9.jsErrors].join(" ; ").slice(0, 200));
  await C9.context.close();
} finally {
  await browser.close();
}
console.log(failures() === 0 ? "\nTOUS LES CONTROLES PASSENT" : `\n${failures()} CONTROLE(S) EN ECHEC`);
process.exit(failures() === 0 ? 0 : 1);
