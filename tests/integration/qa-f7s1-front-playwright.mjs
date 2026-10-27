// QA-F7-S1 : parcours navigateur (Chromium) du lot F7-S1 (branche feat/f7-s1-preuves), ecran
// « Contrôle interne > Exécutions & efficacité », colonne « Preuves » -> ExecutionEvidencePanel.tsx, contre le VRAI backend
// (tsx, PostgreSQL LOCAL, fournisseur d'identite local, jamais Neon). Le stockage Drive est remplace EN MEMOIRE par le
// préchargement de TEST tests/integration/qa-f7s1-test-preload.mjs (aucune requete vers Google, aucun code applicatif touche).
// Les oracles ci-dessous sont ecrits AVANT l'execution.
//
// COMPTES (mot de passe « whatever », droits poses dans users.roles ; tous ont control.read + execution.read + evidence.read sauf C et S) :
//   V « Complet »            : + evidence.download + evidence.import
//   R « Sans telechargement » : + evidence.import seulement
//   N « Sans import »        : + evidence.download seulement
//   C « Auditeur »           : audit.read seul (lit le journal par l'API)
//   W « Sans preuves »       : control.read + execution.read, SANS evidence.read (relance PR #197, commit 83209e2)
//   S « Preparateur »        : control.read, execution.create, execution.read, evidence.upload, evidence.read (seed par l'API)
// SEED (API, comme un utilisateur) : controles CTRL-A et CTRL-B (SQL, actifs) ; S cree une execution par controle ; S depose sur
//   l'execution de CTRL-A un PDF (preuve-QA.pdf) et un xlsx (releve-QA.xlsx : feuille « Contrôles », en-tete Référence/Montant/Date/Commentaire,
//   3 lignes). L'execution de CTRL-B n'a AUCUNE preuve.
//
// ORACLES
//  1. Liste
//     1.1 (V, CTRL-A) « Voir » ouvre le panneau « Preuves de l'exécution du … » : exactement 2 lignes (PDF + xlsx). Par ligne : nom,
//         type documentaire (« Preuve QA »), date = uploadedAt[0..10] lu sur l'API, taille = ceil(fileSize/1024) « Ko » (API),
//         empreinte = 12 premiers caracteres du sha256 de l'API + « … » (title = sha256 entier ; l'empreinte entiere n'est pas dans le texte).
//         Le sha256 de l'API = SHA-256 calcule ici sur les octets deposes.
//     1.2 (V, CTRL-B) « Voir » sur l'execution sans preuve : message « Aucune preuve déposée pour cette exécution. », aucune ligne de preuve.
//  2. Ouvrir
//     2.1 (V) un clic sur « Ouvrir » (PDF) : GET /evidences/:id/url = 200, une fenetre s'ouvre sur http://127.0.0.1/qa-evidence/…,
//         et le journal d'audit (vu par C) passe de 0 a EXACTEMENT 1 ligne d'ACCES Evidence/:id pour cette preuve (hors la ligne CREATE ecrite
//         au depot ; action DOWNLOAD dans le code, le brief parlait de READ/ACCESS : l'oracle accepte DOWNLOAD|READ|ACCESS et releve laquelle),
//         aucune ligne d'acces pour l'autre preuve. [Erreur d'oracle corrigee au 1er passage : j'avais oublie la ligne CREATE du depot.]
//     2.2 (R, sans evidence.download) aucun bouton « Ouvrir » sur aucune ligne ; appel direct GET /:id/url = 403 ; aucune ligne d'audit ajoutee.
//  3. Analyser
//     3.1 (V) « Analyser » present sur la ligne xlsx UNIQUEMENT (0 sur le PDF) ; clic : POST /analysis = 200 ; le panneau affiche
//         « Analyse de releve-QA.xlsx », « Feuille « Contrôles » », « 3 ligne(s) de données », « en-tête ligne 1 », 4 colonnes dans l'ordre
//         Référence, Montant, Date, Commentaire, chacune « <nom> : <type de l'API> (ex. …) » avec des exemples ; journal : 1 ligne READ pour le xlsx.
//     3.2 (N, sans evidence.import) aucun « Analyser » ; appel direct POST /analysis = 403.
//     3.3 (R, import sans download) « Analyser » present ; resultat : feuille, lignes, colonnes affichees SANS « (ex. » ; l'API ne renvoie
//         aucun exemple (examples = [] partout).
//     2.3 (V, relance) l'onglet ouvert au clic aboutit sur l'URL de la preuve : URL finale = `url` rendue par GET /:id/url (meme preuve),
//         page non fermee, corps « QA fichier factice » (la route factice a repondu), et pas d'onglet about:blank laisse ouvert.
//  2bis. Droit evidence.read (relance, commit 83209e2)
//     2.4 (W, sans evidence.read) la colonne « Preuves » ne montre AUCUN bouton « Voir » (valeur « — » sur chaque execution) ; GET /evidences?controlExecutionId= direct = 403.
//  4. Changement de controle et console
//     4.1 (V) panneau ouvert sur CTRL-A, on choisit CTRL-B dans « Contrôle » : le panneau disparait (plus de « Preuves de »), les lignes
//         de preuve de CTRL-A aussi (4.1) ; revenir sur CTRL-A ne rouvre pas le panneau tout seul (4.1b : etat « ferme » reel, pas seulement masque).
//     4.2 aucune exception JS (pageerror) et aucun console.error sur tout le parcours de l'ecran (V, R, N) apres l'arrivee sur l'ecran ;
//         les erreurs de l'ecran d'arrivee (autre ecran, hors lot) sont comptees a part.
//
// Prerequis : docs/qa/qa-f7s1-front-2026-10-27.md, section Environnement (PG local grc_qa_f7s1 migrations 001..075, backend 127.0.0.1:8099
// AUTH_PROVIDER=local lance avec le préchargement, vite 127.0.0.1:5199 VITE_AUTH_PROVIDER=local). Backend redemarre + base neuve avant chaque passage.
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const ExcelJS = createRequire(new URL("../../backend/node_modules/", import.meta.url))("exceljs");

const API = process.env.QA_API ?? "http://127.0.0.1:8099";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/f7s1";
const EMAIL = Object.fromEntries(["v", "r", "n", "c", "s", "w"].map((k) => [k, `qa-f7s1-${k}@f7s1.test`]));
const CTRL_A = "CTRL-A Rapprochement";
const CTRL_B = "CTRL-B Revue acces";
const CID_A = "f7510000-0000-4000-8000-0000000000c1";
const CID_B = "f7510000-0000-4000-8000-0000000000c2";
const DOCTYPE = "Preuve QA";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
mkdirSync(SHOTS, { recursive: true });

const { check, failures } = verdicts();
const { TOK, login, api } = localApi(API, EMAIL);
async function upload(who, name, mime, buf, executionId) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime }), name);
  form.append("documentType", DOCTYPE);
  form.append("controlExecutionId", executionId);
  const r = await fetch(`${API}/api/v1/evidences`, { method: "POST", headers: { authorization: `Bearer ${TOK[who]}` }, body: form });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const auditRows = async (evidenceId) => (await api("c", "GET", `/audit-log?entityType=Evidence&entityId=${evidenceId}&limit=200`)).json?.data ?? [];
const accessRows = async (evidenceId) => (await auditRows(evidenceId)).filter((r) => r.action !== "CREATE");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// ------------------------------------------------------------------------------------------------ fichiers deposes
const pdfBuf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\nQA F7-S1 preuve PDF\n", "latin1");
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Contrôles");
ws.addRow(["Référence", "Montant", "Date", "Commentaire"]);
ws.addRow(["REF-001", 1500, new Date(Date.UTC(2026, 9, 1)), "conforme"]);
ws.addRow(["REF-002", 2300.5, new Date(Date.UTC(2026, 9, 2)), "écart expliqué"]);
ws.addRow(["REF-003", 99, new Date(Date.UTC(2026, 9, 3)), "conforme"]);
const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const allJs = [];
const landing = {};
const screenErrors = [];
const calls = [];
async function open(who) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  // le « lien » factice du stockage en memoire : on repond a la place du reseau (rien ne sort)
  await context.route("http://127.0.0.1/qa-evidence/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "QA fichier factice" }));
  const page = await context.newPage();
  const state = { who, context, page, collecting: false, errors: [], js: [] };
  page.on("pageerror", (e) => { allJs.push(`${who}: ${e}`); state.js.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error") { if (state.collecting) screenErrors.push(`${who}: ${m.text()}`); else landing[who] = (landing[who] ?? 0) + 1; } });
  page.on("response", (res) => {
    if (!res.url().startsWith(API)) return;
    const p = new URL(res.url()).pathname;
    if (/\/evidences\//.test(p) || /\/evidences$/.test(p)) calls.push({ who, method: res.request().method(), path: p, status: res.status() });
  });
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await page.goto(APP);
  await page.getByLabel("Adresse e-mail QA").fill(EMAIL[who]);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await nav.waitFor();
  await sleep(1500);
  state.collecting = true;
  state.goto = async () => {
    const grp = nav.locator("button.sidebar-group-toggle", { hasText: /Contrôle interne/i });
    if ((await grp.getAttribute("aria-expanded")) !== "true") await grp.click();
    await nav.getByRole("button", { name: /^Exécutions & efficacité/ }).click();
    await page.getByRole("heading", { name: "Exécutions & efficacité" }).waitFor();
    await page.locator("#monitor-control").waitFor();
    await sleep(500);
  };
  state.pick = async (label) => {
    const value = await page.locator("#monitor-control option", { hasText: label }).first().getAttribute("value");
    await page.locator("#monitor-control").selectOption(value);
    await page.locator("table tbody tr").first().waitFor({ timeout: 8000 }).catch(() => undefined);
    await sleep(500);
  };
  state.voir = async () => { await page.getByRole("button", { name: /^Voir les preuves de l'exécution/ }).first().click(); await sleep(900); };
  state.panelTitle = page.getByRole("heading", { name: /^Preuves de / });
  state.row = (name) => page.locator("tr").filter({ hasText: name });
  state.cell = async (name, i) => (await state.row(name).locator("td").nth(i).innerText()).replace(/\s+/g, " ").trim();
  return state;
}

try {
  for (const w of ["v", "r", "n", "c", "s", "w"]) await login(w);

  // ---------------------------------------------------------------- seed (API, comme un utilisateur)
  const exA = await api("s", "POST", "/executions", { controlId: CID_A, status: "DONE", plannedDate: "2026-10-01", completedDate: "2026-10-01", result: "Rapprochement OK" });
  const exB = await api("s", "POST", "/executions", { controlId: CID_B, status: "DONE", plannedDate: "2026-10-02", completedDate: "2026-10-02", result: "Revue OK" });
  check("preparation : deux executions creees (une par controle) -> 201", exA.status === 201 && exB.status === 201, `${exA.status}/${exB.status} ${JSON.stringify(exA.json)?.slice(0, 120)}`);
  const upPdf = await upload("s", "preuve-QA.pdf", "application/pdf", pdfBuf, exA.json?.data?.id);
  const upXlsx = await upload("s", "releve-QA.xlsx", XLSX_MIME, xlsxBuf, exA.json?.data?.id);
  check("preparation : PDF et xlsx deposes sur l'execution de CTRL-A -> 201", upPdf.status === 201 && upXlsx.status === 201, `${upPdf.status}/${upXlsx.status} ${JSON.stringify(upPdf.json)?.slice(0, 160)} ${JSON.stringify(upXlsx.json)?.slice(0, 160)}`);
  const evPdf = upPdf.json.data;
  const evXlsx = upXlsx.json.data;
  const listed = (await api("v", "GET", `/evidences?controlExecutionId=${exA.json.data.id}`)).json?.data ?? [];
  const apiPdf = listed.find((e) => e.id === evPdf.id);
  const apiXlsx = listed.find((e) => e.id === evXlsx.id);
  check("preparation : l'API liste 2 preuves, sha256 = SHA-256 des octets deposes", listed.length === 2 && apiPdf?.sha256 === sha(pdfBuf) && apiXlsx?.sha256 === sha(xlsxBuf), `n=${listed.length}; champs=${Object.keys(apiPdf ?? {}).join(",")}`);

  // ================================================================================================ 1. Liste (V)
  const V = await open("v");
  await V.goto();
  await V.pick(CTRL_A);
  await V.voir();
  await V.page.screenshot({ path: `${SHOTS}/01-panneau-V-CTRL-A.png`, fullPage: true });
  const nPdfRows = await V.row("preuve-QA.pdf").count();
  const nXlsxRows = await V.row("releve-QA.xlsx").count();
  const check11 = async (name, ev, buf) => {
    const c = Object.fromEntries(await Promise.all([[0, "file"], [1, "date"], [2, "size"], [3, "sha"]].map(async ([i, k]) => [k, await V.cell(name, i)])));
    const title = await V.row(name).locator("td code").getAttribute("title");
    const expSize = `${Math.ceil(ev.fileSize / 1024)} Ko`;
    const ok = c.file.includes(name) && c.file.includes(DOCTYPE) && c.date === ev.uploadedAt.slice(0, 10) && c.size === expSize
      && c.sha === `${sha(buf).slice(0, 12)}…` && title === sha(buf) && !c.sha.includes(sha(buf).slice(0, 13));
    check(`1.1 ${name} : nom, type, date, taille, empreinte tronquée (title = empreinte entière)`, ok, `${JSON.stringify(c)}; attendu date=${ev.uploadedAt.slice(0, 10)} taille=${expSize}; title=${title?.slice(0, 16)}…`);
  };
  check("1.1 le panneau « Preuves de l'exécution du … » liste exactement 2 lignes (PDF + xlsx)", (await V.panelTitle.count()) === 1 && nPdfRows === 1 && nXlsxRows === 1, `titre=${await V.panelTitle.allInnerTexts()}; pdf=${nPdfRows}; xlsx=${nXlsxRows}`);
  await check11("preuve-QA.pdf", apiPdf, pdfBuf);
  await check11("releve-QA.xlsx", apiXlsx, xlsxBuf);

  // ================================================================================================ 1.2 execution sans preuve
  await V.page.getByRole("button", { name: "Fermer" }).click();
  await V.pick(CTRL_B);
  await V.voir();
  const emptyMsg = await V.page.getByText("Aucune preuve déposée pour cette exécution.").count();
  const rowsB = (await V.page.locator("tr").filter({ hasText: /\.(pdf|xlsx)/ }).count());
  await V.page.screenshot({ path: `${SHOTS}/02-V-CTRL-B-vide.png`, fullPage: true });
  check("1.2 exécution sans preuve : message vide affiché, aucune ligne de preuve", emptyMsg === 1 && rowsB === 0, `message=${emptyMsg}; lignes=${rowsB}`);

  // ================================================================================================ 2.1 Ouvrir (V)
  await V.pick(CTRL_A);
  await V.voir();
  const before = { pdf: (await accessRows(evPdf.id)).length, xlsx: (await accessRows(evXlsx.id)).length };
  const nUrl0 = calls.filter((c) => c.who === "v" && c.path.endsWith("/url")).length;
  const openBtns = await V.page.getByRole("button", { name: "Ouvrir", exact: true }).count();
  const popupP = V.context.waitForEvent("page", { timeout: 6000 }).catch(() => null);
  await V.row("preuve-QA.pdf").getByRole("button", { name: "Ouvrir", exact: true }).click();
  const popup = await popupP;
  await sleep(800);
  const urlCall = calls.filter((c) => c.who === "v" && c.path.endsWith("/url")).slice(nUrl0);
  const rowsPdf = await accessRows(evPdf.id);
  const newPdf = rowsPdf.slice(0, rowsPdf.length - before.pdf);
  const newXlsx = (await accessRows(evXlsx.id)).length - before.xlsx;
  await V.page.screenshot({ path: `${SHOTS}/03-V-ouvrir.png`, fullPage: true });
  check("2.1 (V) 2 boutons « Ouvrir » (un par preuve) ; le clic appelle GET /:id/url = 200 une fois", openBtns === 2 && urlCall.length === 1 && urlCall[0].status === 200 && urlCall[0].path.includes(evPdf.id), `boutons=${openBtns}; appels=${JSON.stringify(urlCall)}`);
  check("2.1 une fenêtre s'ouvre sur le lien délivré (http://127.0.0.1/qa-evidence/…)", !!popup && /^http:\/\/127\.0\.0\.1\/qa-evidence\/qa-/.test(popup.url()), popup ? popup.url() : "(aucune fenêtre)");
  check("2.1 audit (vue C) : 0 -> exactement 1 ligne pour cette preuve (accès DOWNLOAD|READ|ACCESS), 0 pour l'autre preuve", before.pdf === 0 && newPdf.length === 1 && /^(DOWNLOAD|READ|ACCESS)$/.test(newPdf[0]?.action) && newXlsx === 0, `avant=${before.pdf}; nouvelles=${JSON.stringify(newPdf.map((r) => ({ a: r.action, e: r.entityType, u: r.userId })))}; autre preuve +${newXlsx}`);
  const relink = (await api("v", "GET", `/evidences/${evPdf.id}/url`)).json?.data?.url;
  if (popup) await popup.waitForURL(/qa-evidence/, { timeout: 4000 }).catch(() => undefined);
  const popBody = popup && !popup.isClosed() ? await popup.locator("body").innerText().catch(() => "") : "";
  check("2.3 l'onglet ouvert aboutit sur l'URL de la preuve (même lien que l'API), reste ouvert, contenu servi", !!popup && !popup.isClosed() && popup.url() === relink && /\/qa-evidence\/qa-/.test(relink ?? "") && popBody.includes("QA fichier factice"), `onglet=${popup?.url()}; api=${relink}; corps=${popBody.slice(0, 40)}`);
  console.log(`INFO  action d'audit observée pour « Ouvrir » : ${newPdf[0]?.action} (le brief annonçait READ/ACCESS)`);

  // ================================================================================================ 3.1 Analyser (V)
  const anBtns = await V.page.getByRole("button", { name: "Analyser", exact: true }).count();
  const anOnXlsx = await V.row("releve-QA.xlsx").getByRole("button", { name: "Analyser", exact: true }).count();
  const anOnPdf = await V.row("preuve-QA.pdf").getByRole("button", { name: "Analyser", exact: true }).count();
  const nAn0 = calls.filter((c) => c.who === "v" && c.path.endsWith("/analysis")).length;
  await V.row("releve-QA.xlsx").getByRole("button", { name: "Analyser", exact: true }).click();
  await V.page.getByRole("heading", { name: /^Analyse de / }).waitFor({ timeout: 6000 }).catch(() => undefined);
  await sleep(500);
  const anCall = calls.filter((c) => c.who === "v" && c.path.endsWith("/analysis")).slice(nAn0);
  await V.page.screenshot({ path: `${SHOTS}/04-V-analyse.png`, fullPage: true });
  const txt = (await V.page.locator("h3").filter({ hasText: /^Analyse de/ }).locator("xpath=..").innerText()).replace(/[ \t]+/g, " ");
  const apiAn = (await api("v", "POST", `/evidences/${evXlsx.id}/analysis`)).json?.data;
  const cols = apiAn?.sheets?.[0]?.columns ?? [];
  const liTexts = (await V.page.locator("h3").filter({ hasText: /^Analyse de/ }).locator("xpath=..").locator("li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  check("3.1 (V) « Analyser » : 1 bouton, sur la ligne xlsx seulement (0 sur le PDF)", anBtns === 1 && anOnXlsx === 1 && anOnPdf === 0, `total=${anBtns}; xlsx=${anOnXlsx}; pdf=${anOnPdf}`);
  check("3.1 POST /analysis = 200 ; titre « Analyse de releve-QA.xlsx », feuille « Contrôles », 3 lignes, en-tête ligne 1", anCall.length === 1 && anCall[0].status === 200 && txt.includes("Analyse de releve-QA.xlsx") && txt.includes("Feuille « Contrôles »") && txt.includes("3 ligne(s) de données") && txt.includes("en-tête ligne 1"), `appels=${JSON.stringify(anCall)}; ${txt.slice(0, 160)}`);
  const expectedNames = ["Référence", "Montant", "Date", "Commentaire"];
  check("3.1 4 colonnes dans l'ordre, « <nom> : <type de l'API> (ex. …) » avec exemples", cols.length === 4 && expectedNames.every((n, i) => liTexts[i]?.startsWith(`${n} : ${cols[i].inferredType}`) && /\(ex\. .+\)$/.test(liTexts[i])), JSON.stringify(liTexts));
  const readRows = (await auditRows(evXlsx.id)).filter((r) => r.action === "READ");
  check("3.1 audit (vue C) : la lecture du xlsx est journalisée (READ) pour cette preuve", readRows.length >= 1, `READ=${readRows.length}`);

  // ================================================================================================ 4.1 changer de controle (V)
  const titleBefore = await V.panelTitle.count();
  await V.pick(CTRL_B);
  const titleB = await V.panelTitle.count();
  const leftover = await V.page.locator("tr").filter({ hasText: /preuve-QA\.pdf|releve-QA\.xlsx/ }).count();
  const analysisLeft = await V.page.getByRole("heading", { name: /^Analyse de / }).count();
  await V.page.screenshot({ path: `${SHOTS}/05-V-controle-change.png`, fullPage: true });
  await V.pick(CTRL_A);
  const titleBack = await V.panelTitle.count();
  check("4.1 (V) changer de contrôle ferme le panneau (et son analyse, et ses lignes de preuve)", titleBefore === 1 && titleB === 0 && leftover === 0 && analysisLeft === 0, `avant=${titleBefore}; CTRL-B=${titleB}; restes=${leftover}; analyse=${analysisLeft}`);
  check("4.1b (V) revenir sur CTRL-A ne rouvre pas le panneau tout seul", titleBack === 0, `titres au retour=${titleBack}`);

  // ================================================================================================ 2.2 + 3.3 (R : import sans download)
  const R = await open("r");
  await R.goto();
  await R.pick(CTRL_A);
  await R.voir();
  const rOpen = await R.page.getByRole("button", { name: "Ouvrir", exact: true }).count();
  const rRows = await R.row("preuve-QA.pdf").count() + await R.row("releve-QA.xlsx").count();
  const auditR0 = (await auditRows(evPdf.id)).length + (await auditRows(evXlsx.id)).length;
  const direct = await api("r", "GET", `/evidences/${evPdf.id}/url`);
  const auditR1 = (await auditRows(evPdf.id)).length + (await auditRows(evXlsx.id)).length;
  await R.page.screenshot({ path: `${SHOTS}/06-R-sans-download.png`, fullPage: true });
  check("2.2 (R, sans evidence.download) les 2 preuves sont listées, aucun bouton « Ouvrir » ; GET /:id/url direct = 403 ; aucune ligne d'audit ajoutée", rRows === 2 && rOpen === 0 && direct.status === 403 && auditR1 === auditR0, `lignes=${rRows}; Ouvrir=${rOpen}; direct=${direct.status} ${JSON.stringify(direct.json)?.slice(0, 100)}; audit ${auditR0}->${auditR1}`);
  const rAn = await R.row("releve-QA.xlsx").getByRole("button", { name: "Analyser", exact: true }).count();
  await R.row("releve-QA.xlsx").getByRole("button", { name: "Analyser", exact: true }).click();
  await R.page.getByRole("heading", { name: /^Analyse de / }).waitFor({ timeout: 6000 }).catch(() => undefined);
  await sleep(500);
  const rBox = R.page.locator("h3").filter({ hasText: /^Analyse de/ }).locator("xpath=..");
  const rTxt = (await rBox.innerText()).replace(/[ \t]+/g, " ");
  const rLis = (await rBox.locator("li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const rApi = (await api("r", "POST", `/evidences/${evXlsx.id}/analysis`)).json?.data;
  await R.page.screenshot({ path: `${SHOTS}/07-R-analyse-sans-exemples.png`, fullPage: true });
  check("3.3 (R, import sans download) « Analyser » présent ; feuille, 3 lignes et 4 colonnes affichées SANS « (ex. »", rAn === 1 && rTxt.includes("Feuille « Contrôles »") && rTxt.includes("3 ligne(s) de données") && rLis.length === 4 && rLis.every((t) => !t.includes("(ex.")), JSON.stringify(rLis));
  check("3.3 l'API ne renvoie aucun exemple à R (examples = [] partout)", (rApi?.sheets?.[0]?.columns ?? []).length === 4 && rApi.sheets[0].columns.every((c) => c.examples.length === 0), JSON.stringify(rApi?.sheets?.[0]?.columns?.map((c) => c.examples)));

  // ================================================================================================ 3.2 (N : download sans import)
  const N = await open("n");
  await N.goto();
  await N.pick(CTRL_A);
  await N.voir();
  const nAnalyser = await N.page.getByRole("button", { name: "Analyser", exact: true }).count();
  const nOuvrir = await N.page.getByRole("button", { name: "Ouvrir", exact: true }).count();
  const nDirect = await api("n", "POST", `/evidences/${evXlsx.id}/analysis`);
  await N.page.screenshot({ path: `${SHOTS}/08-N-sans-import.png`, fullPage: true });
  check("3.2 (N, sans evidence.import) aucun « Analyser », 2 « Ouvrir » ; POST /analysis direct = 403", nAnalyser === 0 && nOuvrir === 2 && nDirect.status === 403, `Analyser=${nAnalyser}; Ouvrir=${nOuvrir}; direct=${nDirect.status} ${JSON.stringify(nDirect.json)?.slice(0, 100)}`);

  // ================================================================================================ 2.4 (W : sans evidence.read)
  const W = await open("w");
  await W.goto();
  await W.pick(CTRL_A);
  const wVoir = await W.page.getByRole("button", { name: /^Voir les preuves/ }).count();
  const wCells = (await W.page.locator("table tbody tr td").allInnerTexts()).map((t) => t.trim());
  const wDirect = await api("w", "GET", `/evidences?controlExecutionId=${exA.json.data.id}`);
  await W.page.screenshot({ path: `${SHOTS}/09-W-sans-evidence-read.png`, fullPage: true });
  check("2.4 (W, sans evidence.read) aucun bouton « Voir », aucun panneau ; GET /evidences direct = 403", (await W.page.locator("table tbody tr").count()) >= 1 && wVoir === 0 && (await W.panelTitle.count()) === 0 && wCells.includes("—") && wDirect.status === 403, `Voir=${wVoir}; cellules=${JSON.stringify(wCells).slice(0, 160)}; direct=${wDirect.status}`);

  // ================================================================================================ 4.2 console
  console.log(`INFO  erreurs console à l'écran d'arrivée (hors écran testé) : ${JSON.stringify(landing)}`);
  check("4.2 aucune exception JS et aucun console.error sur tout le parcours de l'écran (V, R, N, W)", allJs.length === 0 && screenErrors.length === 0, `exceptions=${JSON.stringify(allJs)}; console=${JSON.stringify(screenErrors).slice(0, 300)}`);
} finally {
  await browser.close();
}
console.log(failures() === 0 ? "\nTERMINE : aucun echec" : `\nTERMINE : ${failures()} echec(s)`);
process.exit(failures() === 0 ? 0 : 1);
