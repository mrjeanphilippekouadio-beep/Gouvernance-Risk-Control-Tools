// QA-retest2 : parcours navigateur (Chromium) du lot F3 contre le VRAI backend (tsx, base PostgreSQL locale grc_qa_r2e2e,
// fournisseur d'identite local, jamais Neon). Les oracles sont ecrits avant l'execution (voir docs/qa/qa-retest2-2026-10-19.md).
//
// Prerequis (voir le rapport, section Environnement) :
//   - base grc_qa_r2e2e (TEMPLATE grc_qa_a08, migrations 001..074) + seed : un tenant, A (admin, demandeur/valideur de mode),
//     B (approbateur de politique), un processus ;
//   - backend sur 127.0.0.1:8099 (AUTH_PROVIDER=local, pg.Pool sans TLS par un preload QA : pool.ts impose le TLS) ;
//   - deux serveurs vite : 5199 (VITE_LOCAL_AUTH_EMAIL = A) et 5198 (= B), VITE_API_BASE_URL=http://127.0.0.1:8099.
// Chromium : /opt/pw-browsers/chromium ; playwright : /opt/node-tools/node_modules/playwright.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const API = "http://127.0.0.1:8099";
const APP_A = "http://127.0.0.1:5199";
const APP_B = "http://127.0.0.1:5198";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/retest2";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "", known = "") => {
  const status = ok ? "PASS" : known ? `KNOWN-DEFECT(${known})` : "FAIL";
  if (!ok && !known) failures++;
  console.log(`${status}  ${name}${detail ? "  -> " + detail : ""}`);
};

async function token(email) {
  const r = await fetch(`${API}/api/v1/auth/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "whatever" }) });
  return (await r.json()).accessToken;
}
const api = async (tok, method, path, body) => {
  const r = await fetch(`${API}/api/v1${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};

async function open(browser, app, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const calls = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", async (res) => {
    const req = res.request();
    if (req.method() === "GET" || !res.url().startsWith(API)) return;
    let body = null;
    try { body = req.postDataJSON(); } catch { /* none */ }
    calls.push({ method: req.method(), path: new URL(res.url()).pathname, status: res.status(), body });
  });
  await page.goto(app);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("navigation", { name: "Navigation principale" }).waitFor();
  return { context, page, errors, calls, label };
}

async function goto(page, itemName) {
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  const admin = nav.locator("button.sidebar-group-toggle", { hasText: /Administration/i });
  if ((await admin.getAttribute("aria-expanded")) !== "true") await admin.click();
  await nav.getByRole("button", { name: new RegExp(itemName) }).click();
  await page.locator(".topbar-title strong").filter({ hasText: itemName }).waitFor();
}

const TWO_LINES = "Première ligne du motif\nDeuxième ligne du motif";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
try {
  const tokA = await token("qa-r2-a@retest2.test");
  const tokB = await token("qa-r2-b@retest2.test");

  // ===================================================================================== A : Reglages de gouvernance
  const A = await open(browser, APP_A, "A");
  const pa = A.page;
  await goto(pa, "Réglages de gouvernance");
  await pa.getByRole("heading", { name: "Réglages de gouvernance" }).waitFor();
  const cfg0 = (await api(tokA, "GET", "/config")).json.data;
  check("F3 lecture : les cinq cartes affichent la configuration du serveur", (await pa.locator(".card, [class*=card]").count()) >= 5 && (await pa.getByText("Refuser l'auto-validation").count()) > 0, `policy=${cfg0.selfValidationPolicy}`);

  // 1. le serveur accepte de nouveau un motif sur deux lignes (b45bc94) : controle direct sur l'API
  const nl = await api(tokA, "PUT", "/config/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: TWO_LINES });
  check("F-PNL3-02 : l'API accepte un motif sur deux lignes (202)", nl.status === 202, `status=${nl.status}`);

  // 2. ecran : le motif est un champ d'une ligne (maxLength 500) ; politique -> 202
  await pa.locator("section").filter({ hasText: "Politique d'auto-validation" }).getByRole("button", { name: "Modifier" }).first().click();
  await pa.locator("#gov-reason").waitFor();
  check("F-PNL3-02 : le motif de l'ecran est un <input> d'une ligne borne a 500", (await pa.locator("#gov-reason").evaluate((e) => e.tagName + ":" + e.maxLength)) === "INPUT:500");
  await pa.locator("#gov-policy").selectOption("DOUBLE_CONFIRMATION");
  await pa.locator("#gov-reason").fill(TWO_LINES); // un <input> supprime les retours a la ligne
  await pa.getByRole("button", { name: "Enregistrer" }).click();
  await pa.getByText("NON appliqué", { exact: false }).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  const put = A.calls.filter((c) => c.method === "PUT" && c.path.endsWith("/self-validation-policy")).at(-1);
  check("F-PNL2-09 : le 202 est affiche « NON appliqué : en attente », la politique reste inchangee", put?.status === 202 && (await pa.getByText("NON appliqué", { exact: false }).count()) > 0, `status=${put?.status}`);
  check("202 : la configuration du serveur est inchangee (REFUSE)", (await api(tokA, "GET", "/config")).json.data.selfValidationPolicy === "REFUSE");
  const pending = (await api(tokA, "GET", "/config/self-validation-policy/request")).json.data;
  check("202 : une demande PENDING existe, auteur = A", pending?.status === "PENDING" && pending.requestedBy === "aaaaaaaa-0000-4000-8000-00000000000a");
  check("l'ecran montre la demande en attente avec Approuver et Rejeter", (await pa.getByRole("button", { name: "Approuver" }).count()) === 1 && (await pa.getByRole("button", { name: "Rejeter" }).count()) === 1);
  await pa.screenshot({ path: `${SHOTS}/a-policy-pending.png` });

  // 3. A approuve sa propre demande : le formulaire de motif s'ouvre, le serveur refuse (maker-checker) avec SON message
  await pa.getByRole("button", { name: "Approuver" }).click();
  await pa.locator("#gov-decision-reason").fill("Je m'approuve");
  await pa.getByRole("button", { name: "Approuver" }).last().click();
  await pa.waitForTimeout(700);
  const selfApprove = A.calls.filter((c) => c.path.endsWith("/approve")).at(-1);
  const formA = await pa.locator("#gov-decide-form").innerText().catch(() => "");
  check("auteur qui approuve : refuse (>= 400) avec un message du serveur (pas « Requête invalide »), la demande reste PENDING",
    selfApprove?.status >= 400 && !/Requête invalide/.test(formA) && (await api(tokA, "GET", "/config/self-validation-policy/request")).json.data?.status === "PENDING",
    `status=${selfApprove?.status}; corps=${JSON.stringify(selfApprove?.body)}; message=${JSON.stringify(formA.split("\n").filter((l) => l.trim()).slice(0, 3))}`);
  await pa.keyboard.press("Escape");

  // ===================================================================================== B : approbateur
  const B = await open(browser, APP_B, "B");
  const pb = B.page;
  await goto(pb, "Réglages de gouvernance");
  await pb.getByRole("heading", { name: "Réglages de gouvernance" }).waitFor();
  await pb.waitForTimeout(800);
  check("B (droit d'approbation seul) voit la demande en attente de A", (await pb.getByRole("button", { name: "Approuver" }).count()) === 1);

  // 4. B rejette
  await pb.getByRole("button", { name: "Rejeter" }).click();
  await pb.locator("#gov-decision-reason").fill(TWO_LINES);
  await pb.getByRole("button", { name: "Rejeter" }).last().click();
  await pb.waitForTimeout(900);
  const rej = B.calls.filter((c) => c.path.endsWith("/reject")).at(-1);
  check("rejet par l'ecran : 200, corps { reason }, la demande n'est plus en attente, la politique reste REFUSE",
    rej?.status === 200 && typeof rej.body?.reason === "string" && (await api(tokB, "GET", "/config/self-validation-policy/request")).json.data === null && (await api(tokB, "GET", "/config")).json.data.selfValidationPolicy === "REFUSE", `status=${rej?.status}; corps=${JSON.stringify(rej?.body)}`);
  check("le rejet est confirme a l'ecran", (await pb.getByText("Demande rejetée").count()) > 0);

  // 5. nouvelle demande, B approuve sur l'ecran
  const again = await api(tokA, "PUT", "/config/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "Nouvelle demande" });
  check("nouvelle demande apres rejet : 202", again.status === 202, `${again.status}`);
  await pb.reload();
  await pb.getByLabel("Mot de passe QA").fill("whatever");
  await pb.getByRole("button", { name: "Se connecter" }).click();
  await goto(pb, "Réglages de gouvernance");
  await pb.waitForTimeout(900);
  await pb.getByRole("button", { name: "Approuver" }).click();
  await pb.locator("#gov-decision-reason").fill("Approuvé par B");
  await pb.getByRole("button", { name: "Approuver" }).last().click();
  await pb.waitForTimeout(900);
  const bApprove = B.calls.filter((c) => c.path.endsWith("/approve")).at(-1);
  check("F-PNL3-01 : B approuve sur l'ecran : 200, corps { reason }, politique appliquee, demande fermee",
    bApprove?.status === 200 && bApprove.body?.reason === "Approuvé par B" && (await api(tokB, "GET", "/config")).json.data.selfValidationPolicy === "DOUBLE_CONFIRMATION" && (await api(tokB, "GET", "/config/self-validation-policy/request")).json.data === null,
    `status=${bApprove?.status}; corps=${JSON.stringify(bApprove?.body)}`);
  check("l'approbation est confirmee a l'ecran", (await pb.getByText("Demande approuvée").count()) > 0);
  await pb.screenshot({ path: `${SHOTS}/b-approve.png` });

  // 6. cartes « Portes par le Dispositif » : lecture seule
  await pa.reload();
  await pa.getByLabel("Mot de passe QA").fill("whatever");
  await pa.getByRole("button", { name: "Se connecter" }).click();
  await goto(pa, "Réglages de gouvernance");
  await pa.getByRole("heading", { name: "Réglages de gouvernance" }).waitFor();
  const body = await pa.locator("section.core-page").innerText();
  const nbModifier = await pa.getByRole("button", { name: "Modifier" }).count();
  check("F-PNL3-03 : plus de carte Mode / Seuils / Obligation Comite modifiable ; carte « Portés par le Dispositif de risque » presente",
    /Portés par le Dispositif de risque/.test(body) && nbModifier === 2, `boutons Modifier=${nbModifier}`);
  await pa.getByRole("button", { name: "Ouvrir le Dispositif de risque" }).click();
  await pa.waitForTimeout(500);
  const title = await pa.locator(".topbar-title strong").innerText();
  check("le bouton « Ouvrir le Dispositif de risque » change d'ecran", !/Réglages de gouvernance/.test(title), title);
  await goto(pa, "Réglages de gouvernance");
  const cumBefore = (await api(tokA, "GET", "/config")).json.data.committeeAuditCumulAllowed;
  await pa.locator(".card, [class*=card]").filter({ hasText: "Cumul Comité et Audit" }).getByRole("button", { name: "Modifier" }).first().click();
  await pa.locator("#gov-setting-form input[type=checkbox]").click();
  await pa.locator("#gov-reason").fill("Motif unique");
  await pa.getByRole("button", { name: "Enregistrer" }).click();
  await pa.waitForTimeout(800);
  const cum = A.calls.filter((c) => c.path.endsWith("/committee-audit-cumul")).at(-1);
  check("carte « Cumul Comité et Audit » : 200 et valeur ecrite", cum?.status === 200 && (await api(tokA, "GET", "/config")).json.data.committeeAuditCumulAllowed === !cumBefore, `status=${cum?.status}`);
  await pa.keyboard.press("Escape");

  // ===================================================================================== A : demandes de mode
  await pa.keyboard.press("Escape");
  await goto(pa, "Demandes de mode d'évaluation");
  await pa.locator("#emr-process").selectOption({ label: "Processus QA" });
  await pa.getByRole("button", { name: "Proposer un mode" }).click();
  await pa.getByRole("button", { name: "Envoyer la demande" }).click();
  await pa.getByText("Demande créée", { exact: false }).waitFor({ timeout: 5000 }).catch(() => undefined);
  check("proposer un mode : la demande est creee (201) et listee En attente de validation", A.calls.some((c) => c.method === "POST" && c.path.endsWith("/process-evaluation-mode-requests") && c.status === 201) && (await pa.getByText("En attente de validation").count()) > 0, JSON.stringify(A.calls.filter((c) => c.path.includes("mode-requests")).map((c) => [c.method, c.status])));
  await pa.getByRole("button", { name: /Valider la demande/ }).click();
  await pa.getByText("Appliquer sans validation indépendante").first().waitFor({ timeout: 5000 }).catch(() => undefined);
  const first409 = A.calls.filter((c) => c.path.endsWith("/validate")).at(0);
  check("auto-validation sans autre valideur : 409 puis dialogue de double confirmation", first409?.status === 409 && (await pa.getByText("Confirmer sans validation indépendante").count()) > 0, `status=${first409?.status}`);
  const raw409 = await api(tokA, "POST", `/process-evaluation-mode-requests/${(await api(tokA, "GET", "/process-evaluation-mode-requests?processId=cccccccc-0000-4000-8000-00000000000c")).json.data[0].id}/validate`, {});
  check("I06 : le 409 porte `code: GOVERNANCE_CONFIRMATION_REQUIRED` en plus du prefixe du message", raw409.status === 409 && raw409.json.code === "GOVERNANCE_CONFIRMATION_REQUIRED" && /^GOVERNANCE_CONFIRMATION_REQUIRED:/.test(raw409.json.error), JSON.stringify(raw409.json).slice(0, 120));
  // le client lit `payload.error.code` (objet) ; ici `error` est une chaine : il retombe sur le prefixe du message
  await pa.locator("#gov-confirm-reason").first().fill(TWO_LINES);
  await pa.getByRole("button", { name: "Confirmer sans validation indépendante" }).click();
  await pa.waitForTimeout(700);
  const second = A.calls.filter((c) => c.path.endsWith("/validate")).at(-1);
  const dlg2 = await pa.locator("[role=dialog]").innerText().catch(() => "");
  check("F-PNL3-02 double confirmation avec un motif sur deux lignes : acceptee", second && second.status === 200 && typeof second.body?.governanceConfirmation?.reason === "string", `status=${second?.status}; dialogue=${JSON.stringify(dlg2.split("\n").filter((l) => /invalide|Requ/i.test(l)))}`);
  const last = second;
  check("renvoi avec la confirmation (motif sur une ligne) : 200, le corps renvoye porte { rule, reason }", last?.status === 200 && last.body?.governanceConfirmation?.rule === "noSelfValidation", `status=${last?.status}`);
  const reqs = (await api(tokA, "GET", "/process-evaluation-mode-requests?processId=cccccccc-0000-4000-8000-00000000000c")).json.data;
  check("la demande est VALIDATED avec validationIndependence WITHOUT_INDEPENDENT_REVIEW (q142)", reqs[0].status === "VALIDATED" && reqs[0].validationIndependence === "WITHOUT_INDEPENDENT_REVIEW", JSON.stringify([reqs[0].status, reqs[0].validationIndependence]));
  check("le badge « Appliqué sans validation indépendante » est affiche dans la liste", (await pa.getByText("Appliqué sans validation indépendante").count()) > 0);
  await pa.screenshot({ path: `${SHOTS}/a-mode-requests.png` });

  // rejet d'une demande de mode avec un motif sur deux lignes
  await pa.getByRole("button", { name: "Proposer un mode" }).click();
  await pa.locator("#emr-mode").selectOption("CLASSIQUE");
  await pa.getByRole("button", { name: "Envoyer la demande" }).click();
  await pa.waitForTimeout(800);
  await pa.getByRole("button", { name: /Rejeter la demande/ }).first().click();
  await pa.locator("#emr-reject-reason").fill(TWO_LINES);
  await pa.getByRole("button", { name: "Rejeter" }).last().click();
  await pa.waitForTimeout(700);
  const rej2 = A.calls.filter((c) => c.path.endsWith("/reject")).at(-1);
  const banner = await pa.getByText("Action refusée").count();
  check("rejet de sa propre demande de mode (champ d'une ligne, corps { reason }) : refuse 403 par le serveur (maker-checker), l'ecran affiche « Action refusée »", rej2?.status === 403 && typeof rej2.body?.reason === "string" && banner > 0, `status=${rej2?.status}; banniere=${banner}`);

  const jsErrors = [...A.errors, ...B.errors];
  check("aucune exception JavaScript pendant le parcours", jsErrors.length === 0, jsErrors.join(" | ").slice(0, 200));
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nTERMINE : aucun echec hors defauts connus" : `\nTERMINE : ${failures} echec(s)`);
process.exit(failures === 0 ? 0 : 1);
