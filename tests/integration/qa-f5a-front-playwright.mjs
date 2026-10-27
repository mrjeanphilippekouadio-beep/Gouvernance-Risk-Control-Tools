// QA-F5a : parcours navigateur (Chromium) du lot F5a (branche feat/f5-decisions-gouvernance), page
// « Administration > Décisions de gouvernance » (GovernanceDecisionsPage.tsx, routes D5 /api/v1/governance-principle-acceptances)
// contre le VRAI backend (tsx, PostgreSQL LOCAL, fournisseur d'identite local, jamais Neon).
// Les oracles ci-dessous sont ecrits AVANT l'execution.
//
// COMPTES (mot de passe « whatever », permissions posees dans users.roles) :
//   A « Acceptante QA »  : governancehealth.read, governanceprinciple.accept, .acceptance.confirm, .acceptance.revoke (pas d'audit.read)
//   B « Confirmeur QA »  : idem A (permissions accordees APRES la creation de l'acceptation « seul », voir seed) (pas d'audit.read)
//   C « Auditeur QA »    : governancehealth.read + audit.read, aucun droit d'action
// SEED (par l'API, comme un utilisateur ; B n'a aucun droit de confirmation au depart, donc A est « seul ») :
//   GOV-ALONE   accepte par A quand personne d'autre ne peut confirmer -> ACTIVE, regime ALONE
//   (puis B recoit les droits d'action par SQL)
//   GOV-CONFIRM, GOV-REJECT : acceptes par A -> PENDING ; GOV-BMINE : accepte par B -> PENDING
//   GOV-EXPIRE : accepte par A avec une echeance a +6 s, au point 4 seulement.
//
// ORACLES
//  1. Liste
//     1.1 (vue de A) GOV-ALONE : badges « En vigueur » ET « Acceptée seul » ; GOV-CONFIRM : « En attente de confirmation » sans
//         « Acceptée seul » ; « Catalogue v0.3 » ; Periode = « Du <acceptedAt[0..10]> au <expiresAt[0..10]> » lus sur l'API.
//     1.2 (vue de A, sans audit.read) ses lignes : « Vous » ; la ligne de B : « Masqué (droit d'audit requis) » ; l'API renvoie
//         acceptedBy = null pour A, mine = true sur ses lignes.
//     1.3 (vue de B) les lignes de A : « Masqué… » ; GOV-BMINE : « Vous ».
//     1.4 (vue de C, avec audit.read) ni « Masqué » ni « Vous » sur les lignes de A, et aucun bouton d'action (C n'a aucun droit).
//  2. Maker-checker
//     2.1 (vue de A) aucun « Confirmer »/« Rejeter » sur ses propres lignes ; un seul « Confirmer » dans la page (ligne de B).
//         Appel API direct de A : POST /:id/confirm sur GOV-CONFIRM -> 403 (message maker-checker), la ligne reste PENDING.
//     2.2 (vue de B) pas de « Confirmer » sur GOV-BMINE (la sienne). Clic « Confirmer » sur GOV-CONFIRM : POST = 200, la ligne passe
//         « En vigueur » sans « Acceptée seul », bandeau « Acceptation confirmée. », l'API (vue C) donne ACTIVE/CONFIRMED confirmedBy = B.
//  3. Motif obligatoire
//     3.1 Rejeter (B sur GOV-REJECT) : bouton Confirmer de la fenetre inactif a vide, inactif avec espaces seuls, actif avec un motif ;
//         POST /reject = 200 avec corps { reason } (rogne) ; la ligne passe « Rejetée » avec « Terminée le … : <motif> ».
//     3.2 Retirer (A sur GOV-CONFIRM, devenue ACTIVE) : meme regle de bouton ; POST /revoke = 200 corps { reason } ; la ligne passe
//         « Retirée » avec « Terminée le … : <motif> » ; l'API donne REVOKED ; plus aucun bouton d'action sur les lignes Rejetée/Retirée.
//  4. Echeance depassee (GOV-EXPIRE, B)
//     La page est chargee avant l'echeance (Confirmer visible), on attend l'echeance, on clique Confirmer : POST = 400, le message du
//     serveur (« expired ») est AFFICHE dans la page (pas avale), la ligne reste PENDING, l'API aussi, aucun bandeau de succes.
//  5. Bandeau et console
//     5.1 le bandeau « Arrive avec le panel de gouvernance (D6) » est present (vues A, B, C).
//     5.2 une charge propre de la page (A, apres l'ecran d'arrivee dont les 403 sont comptes a part) ne produit aucune exception JS ni console.error ; aucune exception JS sur tout le parcours.
//         Les « Failed to load resource » provoques volontairement (403 point 2, 400 point 4) sont comptes a part, pas des erreurs.
//
// Prerequis : voir docs/qa/qa-f5a-front-2026-10-27.md, section Environnement (PG local grc_qa_f5a migrations 001..075, backend
// 127.0.0.1:8099 AUTH_PROVIDER=local, vite 127.0.0.1:5199 avec VITE_AUTH_PROVIDER=local). Base neuve avant chaque passage.
// Chromium : /opt/pw-browsers/chromium ; playwright : /opt/node-tools/node_modules.
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const { Client } = createRequire("/home/user/Gouvernance-Risk-Control-Tools/backend/node_modules/")("pg");

const API = process.env.QA_API ?? "http://127.0.0.1:8099";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/f5a";
const DB = process.env.QA_DB ?? "postgres://postgres@127.0.0.1:55434/grc_qa_f5a";
const EMAIL = { a: "qa-f5a-a@f5a.test", b: "qa-f5a-b@f5a.test", c: "qa-f5a-c@f5a.test" };
const MASKED = "Masqué (droit d'audit requis)";
mkdirSync(SHOTS, { recursive: true });

const { check, failures } = verdicts();
const { TOK, login, api } = localApi(API, EMAIL);
const BASE = "/governance-principle-acceptances";
const list = async (who) => (await api(who, "GET", BASE)).json?.data ?? [];
const byPrinciple = async (who, pid) => (await list(who)).find((a) => a.principleId === pid);
const accept = (who, principleId, days = 30, reason = `Motif QA ${principleId}`) =>
  api(who, "POST", BASE, { principleId, reason, expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() });

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
    if (req.method() === "GET" || !res.url().startsWith(API)) return;
    let body = null;
    try { body = req.postDataJSON(); } catch { /* none */ }
    calls.push({ who, method: req.method(), path: new URL(res.url()).pathname, status: res.status(), body });
  });
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  // le jeton n'est gardé qu'en mémoire : un rechargement renvoie à l'écran de connexion
  state.signIn = async () => {
    await page.goto(APP);
    await page.getByLabel("Adresse e-mail QA").fill(EMAIL[who]);
    await page.getByLabel("Mot de passe QA").fill("whatever");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await nav.waitFor();
  };
  await state.signIn();
  state.goto = async () => {
    const admin = nav.locator("button.sidebar-group-toggle", { hasText: /Administration/i });
    if ((await admin.getAttribute("aria-expanded")) !== "true") await admin.click();
    await nav.getByRole("button", { name: /^Décisions de gouvernance/ }).click();
    await page.getByRole("heading", { name: "Décisions de gouvernance" }).waitFor();
    await page.locator("table tbody tr").first().waitFor({ timeout: 8000 }).catch(() => undefined);
    await sleep(300);
  };
  state.row = (pid) => page.locator("table tbody tr").filter({ hasText: pid });
  state.cell = async (pid, i) => ((await state.row(pid).locator("td").nth(i).innerText()).replace(/\s+/g, " ").trim());
  return state;
}
const lastCall = (who, suffix) => calls.filter((c) => c.who === who && c.method === "POST" && c.path.endsWith(suffix)).at(-1);

try {
  for (const w of ["a", "b", "c"]) await login(w);

  // ---------------------------------------------------------------- seed (API, comme un utilisateur)
  const seedAlone = await accept("a", "GOV-ALONE");
  check("preparation : A accepte GOV-ALONE quand personne d'autre ne peut confirmer -> 201, ACTIVE, ALONE", seedAlone.status === 201 && seedAlone.json?.data?.status === "ACTIVE" && seedAlone.json.data.regime === "ALONE", `status=${seedAlone.status}; ${seedAlone.json?.data?.status}/${seedAlone.json?.data?.regime}`);
  const db = new Client({ connectionString: DB });
  await db.connect();
  await db.query(`UPDATE users SET roles = ARRAY['governancehealth.read','governanceprinciple.accept','governanceprinciple.acceptance.confirm','governanceprinciple.acceptance.revoke']::text[] WHERE email = $1`, [EMAIL.b]);
  await db.end();
  const s1 = await accept("a", "GOV-CONFIRM");
  const s2 = await accept("a", "GOV-REJECT");
  const s3 = await accept("b", "GOV-BMINE");
  check("preparation : trois acceptations PENDING (A x2, B x1)", [s1, s2, s3].every((s) => s.status === 201 && s.json?.data?.status === "PENDING"), [s1, s2, s3].map((s) => `${s.status}/${s.json?.data?.status}`).join(" "));
  const apiA = Object.fromEntries((await list("a")).map((x) => [x.principleId, x]));
  const ids = { a: (await api("a", "GET", "/users/me")).json?.data?.id, b: (await api("b", "GET", "/users/me")).json?.data?.id };

  // ================================================================================================ 1. Liste (vue de A)
  const A = await open("a");
  await A.goto();
  await A.page.screenshot({ path: `${SHOTS}/01-liste-vue-A.png`, fullPage: true });
  const stAlone = await A.cell("GOV-ALONE", 1);
  const stConfirm = await A.cell("GOV-CONFIRM", 1);
  const perAlone = await A.cell("GOV-ALONE", 3);
  const prAlone = await A.cell("GOV-ALONE", 0);
  const expPeriod = `Du ${apiA["GOV-ALONE"].acceptedAt.slice(0, 10)} au ${apiA["GOV-ALONE"].expiresAt.slice(0, 10)}`;
  check("1.1 GOV-ALONE : « En vigueur » + « Acceptée seul »", /En vigueur/.test(stAlone) && /Acceptée seul/.test(stAlone), stAlone);
  check("1.1 GOV-CONFIRM : « En attente de confirmation » sans « Acceptée seul »", /En attente de confirmation/.test(stConfirm) && !/Acceptée seul/.test(stConfirm), stConfirm);
  check("1.1 période « Du … au … » = dates de l'API ; « Catalogue v0.3 »", perAlone.startsWith(expPeriod) && /Catalogue v0\.3/.test(prAlone), `${perAlone} | attendu ${expPeriod} | ${prAlone}`);
  const authMine = [await A.cell("GOV-ALONE", 4), await A.cell("GOV-CONFIRM", 4), await A.cell("GOV-REJECT", 4)];
  const authB = await A.cell("GOV-BMINE", 4);
  check("1.2 (A, sans audit.read) ses lignes = « Vous », la ligne de B = « Masqué… »", authMine.every((t) => t === "Vous") && authB === MASKED, `${JSON.stringify(authMine)}; B=${authB}`);
  check("1.2 l'API renvoie acceptedBy=null et mine=true pour A", apiA["GOV-CONFIRM"].acceptedBy === null && apiA["GOV-CONFIRM"].mine === true && apiA["GOV-BMINE"].mine === false, `acceptedBy=${apiA["GOV-CONFIRM"].acceptedBy}`);

  // ================================================================================================ 2.1 maker-checker (A)
  const ownBtns = (await A.row("GOV-ALONE").getByRole("button", { name: /^(Confirmer|Rejeter)$/ }).count())
    + (await A.row("GOV-CONFIRM").getByRole("button", { name: /^(Confirmer|Rejeter)$/ }).count())
    + (await A.row("GOV-REJECT").getByRole("button", { name: /^(Confirmer|Rejeter)$/ }).count());
  const totalConfirm = await A.page.getByRole("button", { name: "Confirmer", exact: true }).count();
  check("2.1 (A) aucun Confirmer/Rejeter sur ses propres lignes ; un seul Confirmer dans la page (ligne de B)", ownBtns === 0 && totalConfirm === 1 && (await A.row("GOV-BMINE").getByRole("button", { name: "Confirmer", exact: true }).count()) === 1, `sur ses lignes=${ownBtns}; total Confirmer=${totalConfirm}`);
  const direct = await api("a", "POST", `${BASE}/${apiA["GOV-CONFIRM"].id}/confirm`);
  const still = await byPrinciple("a", "GOV-CONFIRM");
  check("2.1 appel API direct de A : confirm sur sa propre acceptation -> 403 maker-checker, ligne toujours PENDING", direct.status === 403 && /maker-checker/i.test(JSON.stringify(direct.json)) && still?.status === "PENDING", `status=${direct.status}; ${JSON.stringify(direct.json)?.slice(0, 160)}; statut=${still?.status}`);

  // ================================================================================================ 1.3 vue de B + 2.2
  const B = await open("b");
  await B.goto();
  await B.page.screenshot({ path: `${SHOTS}/02-liste-vue-B.png`, fullPage: true });
  const bOfA = [await B.cell("GOV-ALONE", 4), await B.cell("GOV-CONFIRM", 4), await B.cell("GOV-REJECT", 4)];
  check("1.3 (B) les lignes de A = « Masqué… », GOV-BMINE = « Vous »", bOfA.every((t) => t === MASKED) && (await B.cell("GOV-BMINE", 4)) === "Vous", `${JSON.stringify(bOfA)}; mine=${await B.cell("GOV-BMINE", 4)}`);
  check("2.2 (B) pas de Confirmer/Rejeter sur GOV-BMINE (la sienne)", (await B.row("GOV-BMINE").getByRole("button", { name: /^(Confirmer|Rejeter)$/ }).count()) === 0);
  await B.row("GOV-CONFIRM").getByRole("button", { name: "Confirmer", exact: true }).click();
  await B.page.getByText("Acceptation confirmée.").waitFor({ timeout: 6000 }).catch(() => undefined);
  await sleep(500);
  const conf = lastCall("b", "/confirm");
  const stAfter = await B.cell("GOV-CONFIRM", 1);
  const viaC = await byPrinciple("c", "GOV-CONFIRM");
  check("2.2 B confirme : POST = 200, ligne « En vigueur » sans « Acceptée seul », bandeau de succes", conf?.status === 200 && /En vigueur/.test(stAfter) && !/Acceptée seul/.test(stAfter) && (await B.page.getByText("Acceptation confirmée.").count()) === 1, `status=${conf?.status}; statut=${stAfter}`);
  check("2.2 l'API (vue audit) : ACTIVE/CONFIRMED, confirmedBy = B", viaC?.status === "ACTIVE" && viaC.regime === "CONFIRMED" && viaC.confirmedBy === ids.b, `${viaC?.status}/${viaC?.regime}/confirmedBy=${viaC?.confirmedBy}`);
  await B.page.screenshot({ path: `${SHOTS}/03-B-confirme.png`, fullPage: true });

  // ================================================================================================ 3.1 Rejeter (B)
  const dialog = (S) => S.page.locator("dialog[open]");
  const dConfirm = (S) => dialog(S).getByRole("button", { name: "Confirmer", exact: true });
  await B.row("GOV-REJECT").getByRole("button", { name: "Rejeter", exact: true }).click();
  await dialog(B).locator("#decision-reason").waitFor();
  const rj0 = await dConfirm(B).isDisabled();
  await dialog(B).locator("#decision-reason").fill("     ");
  const rj1 = await dConfirm(B).isDisabled();
  const MOTIF_REJ = "QA F5a : portée non justifiée";
  await dialog(B).locator("#decision-reason").fill(`  ${MOTIF_REJ}  `);
  const rj2 = await dConfirm(B).isDisabled();
  check("3.1 Rejeter : Confirmer inactif a vide et avec espaces seuls, actif avec un motif", rj0 && rj1 && !rj2, `vide=${rj0}; espaces=${rj1}; motif=${rj2}`);
  await B.page.screenshot({ path: `${SHOTS}/04-rejeter-fenetre.png` });
  await dConfirm(B).click();
  await B.page.getByText("Acceptation rejetée.").waitFor({ timeout: 6000 }).catch(() => undefined);
  await sleep(500);
  const rej = lastCall("b", "/reject");
  const rejRow = await B.cell("GOV-REJECT", 1);
  const rejPer = await B.cell("GOV-REJECT", 3);
  check("3.1 POST /reject = 200, corps { reason } rogné ; ligne « Rejetée » avec « Terminée le … : motif »", rej?.status === 200 && rej.body?.reason === MOTIF_REJ && /Rejetée/.test(rejRow) && /Terminée le \d{4}-\d{2}-\d{2} : /.test(rejPer) && rejPer.includes(MOTIF_REJ), `status=${rej?.status}; corps=${JSON.stringify(rej?.body)}; statut=${rejRow}; période=${rejPer}`);
  await B.page.screenshot({ path: `${SHOTS}/05-rejetee.png`, fullPage: true });

  // ================================================================================================ 3.2 Retirer (A, sur GOV-CONFIRM devenue ACTIVE)
  await A.signIn();
  await A.goto();
  await A.row("GOV-CONFIRM").getByRole("button", { name: "Retirer", exact: true }).click();
  await dialog(A).locator("#decision-reason").waitFor();
  const rv0 = await dConfirm(A).isDisabled();
  await dialog(A).locator("#decision-reason").fill("   ");
  const rv1 = await dConfirm(A).isDisabled();
  const MOTIF_REV = "QA F5a : principe de nouveau respecté";
  await dialog(A).locator("#decision-reason").fill(MOTIF_REV);
  const rv2 = await dConfirm(A).isDisabled();
  check("3.2 Retirer : Confirmer inactif a vide et avec espaces seuls, actif avec un motif", rv0 && rv1 && !rv2, `vide=${rv0}; espaces=${rv1}; motif=${rv2}`);
  await A.page.screenshot({ path: `${SHOTS}/06-retirer-fenetre.png` });
  await dConfirm(A).click();
  await A.page.getByText("Acceptation retirée").waitFor({ timeout: 6000 }).catch(() => undefined);
  await sleep(500);
  const rev = lastCall("a", "/revoke");
  const revRow = await A.cell("GOV-CONFIRM", 1);
  const revPer = await A.cell("GOV-CONFIRM", 3);
  const revApi = await byPrinciple("c", "GOV-CONFIRM");
  check("3.2 POST /revoke = 200, corps { reason } ; ligne « Retirée » avec « Terminée le … : motif » ; API REVOKED", rev?.status === 200 && rev.body?.reason === MOTIF_REV && /Retirée/.test(revRow) && revPer.includes(MOTIF_REV) && revApi?.status === "REVOKED", `status=${rev?.status}; statut=${revRow}; période=${revPer}; api=${revApi?.status}`);
  await A.page.screenshot({ path: `${SHOTS}/07-retiree.png`, fullPage: true });
  const dead = (await A.row("GOV-CONFIRM").getByRole("button").count()) + (await A.row("GOV-REJECT").getByRole("button").count());
  check("3.2 plus aucun bouton d'action sur les lignes Retirée et Rejetée", dead === 0, `boutons=${dead}`);

  // ================================================================================================ 4. Echeance depassee
  const SOON = 6;
  const exp = await api("a", "POST", BASE, { principleId: "GOV-EXPIRE", reason: "Motif QA GOV-EXPIRE", expiresAt: new Date(Date.now() + SOON * 1000).toISOString() });
  check("preparation : A accepte GOV-EXPIRE avec une échéance à +6 s -> 201 PENDING", exp.status === 201 && exp.json?.data?.status === "PENDING", `status=${exp.status}`);
  await B.signIn();
  await B.goto();
  const btnExp = B.row("GOV-EXPIRE").getByRole("button", { name: "Confirmer", exact: true });
  const visibleBefore = (await btnExp.count()) === 1;
  while (Date.now() < new Date(exp.json.data.expiresAt).getTime() + 1500) await sleep(300);
  await btnExp.click();
  await B.page.waitForTimeout(1200);
  const callExp = lastCall("b", `/${exp.json.data.id}/confirm`);
  const bodyText = (await B.page.locator("section.core-page").innerText()).replace(/\s+/g, " ");
  const apiExp = await byPrinciple("b", "GOV-EXPIRE");
  check("4 la page chargée avant l'échéance montre Confirmer ; après l'échéance, POST /confirm = 400", visibleBefore && callExp?.status === 400, `visible=${visibleBefore}; status=${callExp?.status}`);
  check("4 le refus du serveur est AFFICHÉ dans la page (« expired »), pas de bandeau de succès", /expired/i.test(bodyText) && !/Acceptation confirmée\./.test(bodyText), bodyText.match(/.{0,60}expired.{0,60}/i)?.[0] ?? `(absent) ${bodyText.slice(0, 200)}`);
  check("4 la ligne et l'API restent PENDING", /En attente de confirmation/.test(await B.cell("GOV-EXPIRE", 1)) && apiExp?.status === "PENDING", `api=${apiExp?.status}`);
  await B.page.screenshot({ path: `${SHOTS}/08-echeance-depassee.png`, fullPage: true });
  const errBanner = (await B.page.getByText("Chargement impossible").count()) > 0;
  console.log(`INFO  le refus s'affiche sous le titre « Chargement impossible » : ${errBanner}`);

  // ================================================================================================ 1.4 vue de C
  const C = await open("c");
  await C.goto();
  await C.page.screenshot({ path: `${SHOTS}/09-liste-vue-C-audit.png`, fullPage: true });
  const cAuthors = [await C.cell("GOV-ALONE", 4), await C.cell("GOV-BMINE", 4)];
  const cBtns = await C.page.locator("table tbody").getByRole("button").count();
  check("1.4 (C, audit.read) ni « Masqué » ni « Vous » sur les lignes d'autrui ; aucun bouton d'action", cAuthors.every((t) => t !== MASKED && t !== "Vous" && t.length > 0) && cBtns === 0, `auteurs=${JSON.stringify(cAuthors)}; boutons=${cBtns}`);
  console.log(`INFO  « Acceptée par » vu avec audit.read : ${JSON.stringify(cAuthors)} (identifiants de compte attendus : A=${ids.a}, B=${ids.b})`);

  // ================================================================================================ 5. Bandeau et console
  const banners = [];
  for (const S of [A, B, C]) banners.push((await S.page.getByText("Arrive avec le panel de gouvernance (D6)").count()) === 1);
  check("5.1 le bandeau « Arrive avec le panel de gouvernance (D6) » est présent (vues A, B, C)", banners.every(Boolean), JSON.stringify(banners));
  const Clean = await open("a");
  // l'ecran d'arrivee (Cartographie) appelle /risks et /cartography/scale : 403 pour un compte sans risk.read, hors perimetre F5a.
  // On les compte a part (observation) et on remet la collecte a zero avant d'ouvrir la page testee.
  await sleep(1500);
  const landing = Clean.consoleErrors.length;
  Clean.consoleErrors.length = 0; Clean.jsErrors.length = 0;
  await Clean.goto();
  await sleep(800);
  check("5.2 charge propre de la page (A) : aucune exception JS, aucun console.error", Clean.jsErrors.length === 0 && Clean.consoleErrors.length === 0, [...Clean.jsErrors, ...Clean.consoleErrors].join(" | ").slice(0, 300));
  console.log(`INFO  erreurs console à l'écran d'arrivée (Cartographie, compte A sans risk.read) : ${landing}`);
  const unexpected = consoleAll.filter((t) => !/Failed to load resource: the server responded with a status of (400|403)/.test(t));
  check("5.2 aucune exception JS sur tout le parcours ; seuls les 400/403 provoqués volontairement apparaissent en console", allJs.length === 0 && unexpected.length === 0, `exceptions=${allJs.length}; console inattendue=${JSON.stringify(unexpected).slice(0, 300)}; 400/403 provoqués=${consoleAll.length - unexpected.length}`);
} finally {
  await browser.close();
}
console.log(failures() === 0 ? "\nTERMINE : aucun echec" : `\nTERMINE : ${failures()} echec(s)`);
process.exit(failures() === 0 ? 0 : 1);
