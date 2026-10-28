// QA-F7S3 : parcours navigateur (Chromium) de l'écran « Matrice des droits » (Administration > Plateforme, RightsMatrixPage.tsx)
// contre le VRAI backend (tsx, PostgreSQL 16 LOCAL, fournisseur local, jamais Neon, jamais Google).
// Oracles ecrits AVANT l'execution. Comptes (mot de passe « whatever ») :
//   A « Admin Droits QA »      users.roles = role.read, user.read          (voit l'entree, l'annuaire)
//   N « Sans Droit QA »        users.roles = {}                            (pas de role.read)
//   C « Cible Droits QA »      users.roles = risk.read (DIRECT) + role ordinaire « Analyste QA » (risk.read, control.read)
//                              + groupe fixe Comite + role DESACTIVE « Role desactive QA » (audit.read)
//   S « Suspendu Droits QA »   suspendu (deleted_at)      O : compte d'un AUTRE tenant
//   R « Risk Manager Droits QA » membre du seul groupe fixe Risk Manager (role.read par le groupe, migration 078, q187)
//
// ORACLES
//  0. API (PG reel)
//     0.1 N : 403 sur permission-sources, governance-rights, /roles/matrix.   0.2 A : O -> 404, id inconnu -> 404, id mal forme -> 4xx (pas 500).
//     0.3 A sur C : l'ensemble des droits listes == GET /roles/users/C/permissions == GET /users/me/permissions de C (ce que requirePermission accepte) ;
//         audit.read (role desactive) absent ; risk.read = DIRECT + Analyste + Comite ; feedback.create = BASE seul.
//  1. A, ecran
//     1.1 L'entree « Matrice des droits » existe sous Administration (section Plateforme) ; le titre et les deux onglets sont affiches.
//     1.2 Matrice : une ligne par droit du catalogue (GET /permissions) ; chaque ligne porte un libelle francais (rightLabels) + le code ;
//         colonnes = roles de GET /roles, groupes fixes signales « (groupe fixe … ) » ; exactement 4 badges « Droit de décision » ( = governance-rights).
//     1.3 Cellules : pour la colonne Comite, ✓ ssi le droit est dans le role (API) — verifie sur tout le catalogue.
//     1.4 Filtre Domaine « risk » : seules les lignes risk.* ; recherche « kri.read » (code) et « Voir les risques » (libelle) ; recherche absurde -> « Aucun droit ne correspond. »
//     1.5 Lecture seule : aucun bouton Modifier/Enregistrer/Supprimer/Créer dans la page, aucune requete autre que GET apres la connexion.
//     1.6 Onglet « Droits d'un compte » : l'annuaire liste C et N, JAMAIS S (suspendu) ni O (autre tenant). Choisir C : « Rôles détenus » contient
//         Analyste QA et Comité (groupe fixe), pas « Role desactive QA » ; ligne feedback.create = « Socle de tout compte » ; ligne risk.read =
//         socle/direct/role : « Attribution directe (ancienne) », « Rôle Analyste QA », « Groupe fixe Comité des risques » ; audit.read absent ;
//         nombre de lignes == nombre de droits de l'API ; badge « Droit de décision » sur un droit de decision du Comite.
//         Choisir N : « Rôles détenus : aucun », uniquement 2 lignes « Socle de tout compte ».
//     1.7 Aucun console.error ni exception JS pendant 1.1..1.6.
//  2. N : l'entree « Matrice des droits » est ABSENTE du menu (Administration deplie).
//  4. q187 : R (Risk Manager, sans droit direct) voit l'entree, la matrice, et l'onglet compte (annuaire, droits de C).
//  0.4 F7S3-01 : compte suspendu -> 200, liste vide, suspended: true.
//  3. Acces direct sans role.read : la page n'a pas de route propre (pas d'URL) ; on retire role.read a A en base puis on remonte l'ecran
//     (Comptes -> Matrice) : le serveur refuse (403), l'ecran affiche le refus (bandeau « Chargement impossible »), aucune donnee de droit affichee.
//
// Prerequis : tests/integration/qa-f7s3-front-setup.sh up ; backend 127.0.0.1:8099 (AUTH_PROVIDER=local, preload qa-f7s1-test-preload.mjs) ;
// vite 127.0.0.1:5199 (VITE_AUTH_PROVIDER=local). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB_PORT.
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const API = process.env.QA_API ?? "http://127.0.0.1:8099";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/f7s3";
const PG = ["-h", "127.0.0.1", "-p", process.env.QA_DB_PORT ?? "55437", "-U", "postgres", "-d", "grc_qa_f7s3", "-Atq"];
const EMAIL = { a: "qa-f7s3-a@f7s3.test", n: "qa-f7s3-n@f7s3.test", c: "qa-f7s3-c@f7s3.test", s: "qa-f7s3-s@f7s3.test", o: "qa-f7s3-o@f7s3.test", r: "qa-f7s3-r@f7s3.test" };
const LABELS = JSON.parse(readFileSync(new URL("../../frontend/src/api/rightLabels.json", import.meta.url), "utf8"));
mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execFileSync("psql", [...PG, "-c", q], { encoding: "utf8" }).trim();

const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const norm = (s) => s.replace(/\s+/g, " ").trim();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
async function open(who) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await context.newPage();
  const st = { page, consoleErrors: [], jsErrors: [], calls: [] };
  page.on("pageerror", (e) => st.jsErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") st.consoleErrors.push(m.text()); });
  page.on("response", (res) => {
    if (!res.url().startsWith(API)) return;
    st.calls.push({ method: res.request().method(), path: new URL(res.url()).pathname, status: res.status() });
  });
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await page.goto(APP);
  await page.getByLabel("Adresse e-mail QA").fill(EMAIL[who]);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await nav.waitFor();
  await sleep(800);
  st.nav = nav;
  st.admin = async () => {
    const group = nav.locator("button.sidebar-group-toggle", { hasText: /Administration/i });
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
    return group;
  };
  st.goto = async (name, heading) => {
    await st.admin();
    await nav.getByRole("button", { name }).click();
    await page.getByRole("heading", { name: heading }).waitFor();
    await sleep(900);
  };
  st.rows = () => page.locator("table tbody tr");
  return st;
}

try {
  for (const w of ["a", "n", "c", "r"]) await login(w);
  const id = (r) => r.json?.data?.id;
  const ids = { a: id(await api("a", "GET", "/users/me")), n: id(await api("n", "GET", "/users/me")), c: id(await api("c", "GET", "/users/me")) };
  ids.s = sql("select id from users where email='qa-f7s3-s@f7s3.test'");
  ids.o = sql("select id from users where email='qa-f7s3-o@f7s3.test'");
  check("preparation : 3 comptes connectés, identifiants lus", Object.values(ids).every(Boolean));

  // ================================================================================================ 0. API
  for (const p of [`/roles/users/${ids.c}/permission-sources`, "/roles/governance-rights", "/roles/matrix"]) {
    const r = await api("n", "GET", p);
    check(`0.1 N sans role.read : GET ${p.replace(ids.c, ":id")} = 403`, r.status === 403 && !JSON.stringify(r.json).includes("risk.read"), `status=${r.status}`);
  }
  const cross = await api("a", "GET", `/roles/users/${ids.o}/permission-sources`);
  const unknown = await api("a", "GET", "/roles/users/00000000-0000-4000-8000-0000000000aa/permission-sources");
  check("0.2 compte d'un autre tenant : 404, identique à un id inconnu, aucun droit dans le corps",
    cross.status === 404 && unknown.status === 404 && !JSON.stringify(cross.json).includes("risk.read"), `cross=${cross.status}; inconnu=${unknown.status}`);
  const malformed = await api("a", "GET", "/roles/users/not-a-uuid/permission-sources");
  check("0.2 identifiant mal formé : 400 (pas 500) [QA-F7S3-01]", malformed.status === 400, `status=${malformed.status}`);
  const susp = await api("a", "GET", `/roles/users/${ids.s}/permission-sources`);
  check("0.4 compte suspendu : 200, aucun droit, suspended: true [F7S3-01]",
    susp.status === 200 && susp.json?.suspended === true && (susp.json?.data ?? [1]).length === 0, `status=${susp.status}; ${JSON.stringify(susp.json).slice(0, 120)}`);

  const src = (await api("a", "GET", `/roles/users/${ids.c}/permission-sources`)).json?.data ?? [];
  const listed = src.map((x) => x.permission).sort();
  const viaPerms = ((await api("a", "GET", `/roles/users/${ids.c}/permissions`)).json?.data ?? []).slice().sort();
  const self = ((await api("c", "GET", "/users/me/permissions")).json?.data ?? []).slice().sort();
  const kinds = (p) => (src.find((x) => x.permission === p)?.sources ?? []).map((s) => (s.kind === "ROLE" ? `ROLE:${s.roleName}` : s.kind));
  check("0.3 droits listés == GET /roles/users/:id/permissions", JSON.stringify(listed) === JSON.stringify(viaPerms), `${listed.length} vs ${viaPerms.length}`);
  // /users/me/permissions exclut le socle ? on compare l'inclusion dans les deux sens apres retrait du socle.
  const noBase = (xs) => xs.filter((p) => !["feedback.create", "notification.read"].includes(p));
  check("0.3 ce que la cible possède réellement (/users/me/permissions, résolveur d'identité) concorde avec la liste (hors socle si absent)",
    JSON.stringify(noBase(listed)) === JSON.stringify(noBase(self)), `liste=${listed.length}; reel=${self.length}`);
  check("0.3 rôle désactivé exclu (audit.read absent) ; risk.read = DIRECT + Analyste QA + Comité ; feedback.create = BASE seul",
    !listed.includes("audit.read") && JSON.stringify(kinds("risk.read")) === JSON.stringify(["DIRECT", "ROLE:Analyste QA", "ROLE:Comité"]) && JSON.stringify(kinds("feedback.create")) === '["BASE"]',
    JSON.stringify(kinds("risk.read")));

  // ================================================================================================ 1. A, ecran
  const A = await open("a");
  const group = await A.admin();
  const entries = (await A.nav.locator("button").allInnerTexts()).map(norm);
  const sections = await A.nav.locator(".sidebar-separator, .sidebar-section, [class*=separator]").allInnerTexts().catch(() => []);
  check("1.1 l'entrée « Matrice des droits » existe dans le menu Administration", entries.some((t) => /^Matrice des droits/.test(t)), `sections=${sections.map(norm).join("|")}`);
  A.consoleErrors.length = 0; // l'ecran d'arrivee (Cartographie) est hors perimetre : A n'a pas risk.read (cf. QA-F5A-03)
  await A.goto(/^Matrice des droits/, "Matrice des droits");
  await A.page.screenshot({ path: `${SHOTS}/01-matrice-A.png`, fullPage: true });
  const seg = A.page.getByRole("group", { name: "Vue" });
  check("1.1 deux onglets « Matrice des rôles » et « Droits d'un compte »",
    (await seg.getByRole("button", { name: "Matrice des rôles" }).count()) === 1 && (await seg.getByRole("button", { name: "Droits d'un compte" }).count()) === 1);

  const catalog = (await api("a", "GET", "/permissions")).json?.data ?? [];
  const roles = (await api("a", "GET", "/roles")).json?.data ?? [];
  const gov = (await api("a", "GET", "/roles/governance-rights")).json?.data ?? [];
  check("1.2 une ligne par droit du catalogue", (await A.rows().count()) === catalog.length, `lignes=${await A.rows().count()}; catalogue=${catalog.length}`);
  const unlabelled = catalog.filter((p) => !LABELS[p]);
  const firstCells = (await A.rows().locator("td:first-child").allInnerTexts()).map(norm);
  const missingFr = catalog.filter((p, i) => LABELS[p] && !firstCells.some((t) => t.includes(LABELS[p]) && t.includes(p)));
  check("1.2 chaque droit affiche son libellé français ET son code", missingFr.length === 0, `sans libelle dans le catalogue=${unlabelled.length}; ligne incorrecte=${missingFr.slice(0, 3).join(",")}`);
  // textContent : le CSS met les en-tetes en majuscules (innerText les renverrait en majuscules).
  const headers = (await A.page.locator("table thead th").allTextContents()).map(norm);
  const fixedRoles = roles.filter((r) => r.systemGroup);
  check("1.2 colonnes = rôles de l'API ; groupes fixes signalés « (groupe fixe … ) »",
    headers.length === roles.length + 1 && fixedRoles.every((r) => headers.some((h) => h.includes(r.name) && /groupe fixe/.test(h))) && headers.some((h) => h.includes("Analyste QA") && !/groupe fixe/.test(h)),
    headers.join(" | "));
  check("1.2 exactement 4 badges « Droit de décision » (= governance-rights)", gov.length === 4 && (await A.page.getByText("Droit de décision", { exact: true }).count()) === 4,
    `badges=${await A.page.getByText("Droit de décision", { exact: true }).count()}; api=${gov.length}`);
  const badgeRows = (await A.rows().filter({ hasText: "Droit de décision" }).locator("td:first-child code").allInnerTexts()).map(norm).sort();
  check("1.2 les badges sont sur les 4 droits de gouvernance de l'API", JSON.stringify(badgeRows) === JSON.stringify(gov.map((g) => g.permission).sort()), badgeRows.join(","));

  const comite = roles.find((r) => r.systemGroup === "RISK_COMMITTEE");
  const colIdx = headers.findIndex((h) => h.includes(comite.name));
  let wrong = 0;
  for (const p of catalog) {
    const row = A.rows().filter({ has: A.page.locator("td:first-child code", { hasText: new RegExp(`^${p.replace(/\./g, "\\.")}$`) }) });
    const cell = row.locator("td").nth(colIdx);
    const granted = (await cell.locator("[aria-label=accordé]").count()) === 1;
    if (granted !== comite.permissions.includes(p)) wrong++;
  }
  check("1.3 colonne Comité : ✓/· concorde avec l'API sur tout le catalogue", wrong === 0, `ecarts=${wrong}; colonne=${colIdx}`);

  const dom = A.page.getByLabel("Domaine");
  await dom.selectOption("risk");
  await sleep(300);
  const riskCodes = (await A.rows().locator("td:first-child code").allInnerTexts()).map(norm);
  check("1.4 filtre Domaine « risk » : uniquement des droits risk.* et tous ceux du catalogue",
    riskCodes.length === catalog.filter((p) => p.startsWith("risk.")).length && riskCodes.every((c) => c.startsWith("risk.")), `${riskCodes.length} lignes`);
  await dom.selectOption("");
  const search = A.page.getByLabel("Rechercher un droit");
  await search.fill("kri.read");
  await sleep(300);
  const byCode = (await A.rows().locator("td:first-child code").allInnerTexts()).map(norm);
  check("1.4 recherche par code « kri.read »", byCode.length >= 1 && byCode.every((c) => c.includes("kri.read")) && byCode.includes("kri.read"), byCode.join(","));
  await search.fill(LABELS["risk.read"].toLowerCase());
  await sleep(300);
  const byLabel = (await A.rows().locator("td:first-child code").allInnerTexts()).map(norm);
  check(`1.4 recherche par libellé français « ${LABELS["risk.read"]} » (insensible à la casse)`, byLabel.includes("risk.read"), byLabel.join(","));
  await search.fill("zzzzqqq");
  await sleep(300);
  check("1.4 recherche sans résultat : « Aucun droit ne correspond. »", (await A.page.getByText("Aucun droit ne correspond.").count()) >= 1);
  await A.page.screenshot({ path: `${SHOTS}/02-recherche-vide.png`, fullPage: true });
  await search.fill("");

  const buttons = (await A.page.locator("main button, section button").allInnerTexts()).map(norm);
  check("1.5 lecture seule : aucun bouton d'écriture dans la page", !buttons.some((t) => /Modifier|Enregistrer|Supprimer|Créer|Ajouter|Désactiver|Attribuer/.test(t)), buttons.join("|"));

  // --- onglet 2
  await seg.getByRole("button", { name: "Droits d'un compte" }).click();
  await sleep(900);
  const picker = A.page.locator("#rights-user");
  const options = (await picker.locator("option").allInnerTexts()).map(norm);
  check("1.6 l'annuaire propose C et N, jamais le compte suspendu ni celui d'un autre tenant",
    options.includes("Cible Droits QA") && options.includes("Sans Droit QA") && !options.some((o) => /Suspendu|Autre Tenant/.test(o)), options.join(" | "));
  await picker.selectOption({ label: "Cible Droits QA" });
  await sleep(1200);
  await A.page.screenshot({ path: `${SHOTS}/03-droits-cible.png`, fullPage: true });
  const held = norm(await A.page.getByText("Rôles détenus").locator("..").innerText());
  check("1.6 « Rôles détenus » : Analyste QA et Comité (groupe fixe) ; pas le rôle désactivé",
    /Analyste QA/.test(held) && /Comité \(groupe fixe Comité des risques\)/.test(held) && !/desactive/i.test(held), held);
  const rowOf = (code) => A.rows().filter({ has: A.page.locator("code", { hasText: new RegExp(`^${code.replace(/\./g, "\\.")}$`) }) });
  const textOf = async (code) => ((await rowOf(code).count()) ? norm(await rowOf(code).first().innerText()) : "");
  const t1 = await textOf("feedback.create");
  check("1.6 feedback.create : origine « Socle de tout compte » seule", /Socle de tout compte/.test(t1) && !/Rôle|Groupe fixe|directe/.test(t1), t1);
  const t2 = await textOf("risk.read");
  check("1.6 risk.read : directe + rôle ordinaire + groupe fixe", /Attribution directe \(ancienne\)/.test(t2) && /Rôle Analyste QA/.test(t2) && /Groupe fixe Comité des risques/.test(t2), t2);
  check("1.6 libellé français du droit affiché sur la ligne", t2.includes(LABELS["risk.read"]), t2);
  check("1.6 audit.read (rôle désactivé) absent", (await rowOf("audit.read").count()) === 0);
  check("1.6 nombre de lignes == droits effectifs de l'API", (await A.rows().count()) === src.length, `lignes=${await A.rows().count()}; api=${src.length}`);
  const decisionC = gov.find((g) => g.groups.includes("RISK_COMMITTEE"))?.permission;
  check("1.6 badge « Droit de décision » sur un droit de décision détenu via le Comité",
    !!decisionC && /Droit de décision/.test(await textOf(decisionC)) && /Groupe fixe Comité des risques/.test(await textOf(decisionC)), `${decisionC}: ${await textOf(decisionC)}`);
  await picker.selectOption({ label: "Sans Droit QA" });
  await sleep(1200);
  const heldN = norm(await A.page.getByText("Rôles détenus").locator("..").innerText());
  const rowsN = (await A.rows().allInnerTexts()).map(norm);
  check("1.6 compte sans rôle : « Rôles détenus : aucun » et seulement 2 lignes « Socle de tout compte »",
    /aucun/.test(heldN) && rowsN.length === 2 && rowsN.every((t) => /Socle de tout compte/.test(t)), `${heldN} / ${rowsN.join(" ; ")}`);
  await A.page.screenshot({ path: `${SHOTS}/04-droits-sans-role.png`, fullPage: true });
  const writes = A.calls.filter((c) => c.method !== "GET" && !/\/auth\//.test(c.path));
  check("1.5 aucune requête d'écriture émise par l'écran", writes.length === 0, JSON.stringify(writes));
  check("1.7 aucun console.error ni exception JS", A.consoleErrors.length === 0 && A.jsErrors.length === 0, `console=${A.consoleErrors.join(" || ")}; js=${A.jsErrors.join(" || ")}`);

  // ================================================================================================ 2. N
  const N = await open("n");
  await N.admin().catch(() => undefined);
  const nEntries = (await N.nav.locator("button").allInnerTexts()).map(norm);
  await N.page.screenshot({ path: `${SHOTS}/05-menu-N.png`, fullPage: true });
  check("2 compte sans role.read : l'entrée « Matrice des droits » est absente du menu", !nEntries.some((t) => /Matrice des droits/.test(t)) && nEntries.some((t) => /^Comptes/.test(t) || /Administration/.test(t)), nEntries.slice(0, 40).join("|"));
  check("2 le menu de N n'a déclenché aucun appel aux routes de la matrice", !N.calls.some((c) => /\/roles\/(matrix|governance-rights)|permission-sources/.test(c.path)));

  // ================================================================================================ 3. Refus affiche
  await A.page.getByRole("button", { name: /^Comptes/ }).click();
  await A.page.getByRole("heading", { name: "Comptes" }).waitFor();
  sql(`update users set roles='{user.read}' where id='${ids.a}'`);
  A.consoleErrors.length = 0;
  await A.nav.getByRole("button", { name: /^Matrice des droits/ }).click();
  await A.page.getByRole("heading", { name: "Matrice des droits" }).waitFor();
  await sleep(1500);
  await A.page.screenshot({ path: `${SHOTS}/06-refus-role-read.png`, fullPage: true });
  const banner = norm(await A.page.locator(".message-banner, [role=alert]").allInnerTexts().then((t) => t.join(" | ")));
  const bodyText = norm(await A.page.locator("main, body").first().innerText());
  const refused = A.calls.filter((c) => /\/roles/.test(c.path)).slice(-3);
  check("3 sans role.read en base : le serveur refuse (403) et l'écran affiche le refus (bandeau « Chargement impossible »)",
    refused.some((c) => c.status === 403) && /Chargement impossible/.test(banner), `banniere=${banner.slice(0, 200)}; appels=${JSON.stringify(refused)}`);
  check("3 aucune donnée de droit affichée après le refus", !/Droit de décision/.test(bodyText) && (await A.rows().filter({ hasText: "risk.read" }).count()) === 0);
  check("3 le refus est en français, sans clé brute [QA-F7S3-02]", !/Missing permission|role\.read/.test(banner) && /Voir les rôles/.test(banner), banner.slice(0, 200));
  sql(`update users set roles='{role.read,user.read}' where id='${ids.a}'`);

  // ================================================================================================ 4. R, Risk Manager (q187)
  const R = await open("r");
  await R.admin();
  const rEntries = (await R.nav.locator("button").allInnerTexts()).map(norm);
  check("4 Risk Manager (role.read par le groupe fixe) : l'entrée « Matrice des droits » est présente", rEntries.some((t) => /^Matrice des droits/.test(t)), rEntries.slice(0, 40).join("|"));
  R.consoleErrors.length = 0;
  await R.goto(/^Matrice des droits/, "Matrice des droits");
  check("4 Risk Manager : la matrice s'affiche (une ligne par droit)", (await R.rows().count()) === catalog.length, `lignes=${await R.rows().count()}`);
  await R.page.getByRole("group", { name: "Vue" }).getByRole("button", { name: "Droits d'un compte" }).click();
  await sleep(900);
  const rPicker = R.page.locator("#rights-user");
  await rPicker.selectOption({ label: "Cible Droits QA" });
  await sleep(1200);
  await R.page.screenshot({ path: `${SHOTS}/07-risk-manager-compte.png`, fullPage: true });
  check("4 Risk Manager : onglet compte, droits de C affichés (même nombre que l'API)", (await R.rows().count()) === src.length, `lignes=${await R.rows().count()}; api=${src.length}`);
  check("4 aucun console.error ni exception JS (Risk Manager)", R.consoleErrors.length === 0 && R.jsErrors.length === 0, `console=${R.consoleErrors.join(" || ")}; js=${R.jsErrors.join(" || ")}`);
} catch (e) {
  check("script : exception inattendue", false, String(e?.stack ?? e));
} finally {
  await browser.close();
}
console.log(failures() === 0 ? "\nTOUT PASS" : `\n${failures()} ECHEC(S)`);
process.exit(failures() === 0 ? 0 : 1);
