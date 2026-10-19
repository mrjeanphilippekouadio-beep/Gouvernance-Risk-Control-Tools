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
const SHOTS = process.env.QA_SHOTS ?? "/tmp/claude-0/qa-retest2-shots";
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

  // 1. politique, motif sur deux lignes (une zone de texte invite au retour a la ligne)
  const openPolicy = async () => { await pa.locator("section").filter({ hasText: "Politique d'auto-validation" }).getByRole("button", { name: "Modifier" }).first().click(); await pa.locator("#gov-reason").waitFor(); };
  await openPolicy();
  await pa.locator("#gov-policy").selectOption("DOUBLE_CONFIRMATION");
  await pa.locator("#gov-reason").fill(TWO_LINES);
  await pa.getByRole("button", { name: "Enregistrer" }).click();
  await pa.waitForTimeout(600);
  let put = A.calls.filter((c) => c.method === "PUT" && c.path.endsWith("/self-validation-policy")).at(-1);
  const dlgText = await pa.locator("#gov-setting-form").innerText().catch(() => "");
  check("F-PNL3-02 motif sur deux lignes (politique) : accepte (le serveur repond < 400)", put && put.status < 400, `status=${put?.status}; message affiche = ${JSON.stringify(dlgText.split("\n").filter((l) => l.trim() && !/Motif|Politique demandée|Si une seconde/.test(l)).slice(0, 3))}`, "F-PNL3-02");
  await pa.screenshot({ path: `${SHOTS}/a-policy-two-lines.png` });

  // 2. politique, motif sur une ligne : 202 (B peut approuver)
  await pa.locator("#gov-reason").fill("Assouplir pour le test de retest");
  await pa.getByRole("button", { name: "Enregistrer" }).click();
  await pa.getByText("NON appliqué", { exact: false }).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  put = A.calls.filter((c) => c.method === "PUT" && c.path.endsWith("/self-validation-policy")).at(-1);
  check("F-PNL2-09 : le 202 est affiche « NON appliqué : en attente », la politique reste inchangee", put?.status === 202 && (await pa.getByText("NON appliqué", { exact: false }).count()) > 0, `status=${put?.status}`);
  const afterA = (await api(tokA, "GET", "/config")).json.data;
  check("202 : la configuration du serveur est inchangee (REFUSE)", afterA.selfValidationPolicy === "REFUSE");
  const pending = (await api(tokA, "GET", "/config/self-validation-policy/request")).json.data;
  check("202 : une demande PENDING existe, auteur = A", pending?.status === "PENDING" && pending.requestedBy === "aaaaaaaa-0000-4000-8000-00000000000a", JSON.stringify(pending?.status));
  check("l'ecran montre la demande en attente avec Approuver et Rejeter", (await pa.getByRole("button", { name: "Approuver" }).count()) === 1 && (await pa.getByRole("button", { name: "Rejeter" }).count()) === 1);
  await pa.screenshot({ path: `${SHOTS}/a-policy-pending.png` });

  // 3. A approuve sa propre demande : le serveur doit refuser (maker-checker) avec un message intelligible
  await pa.getByRole("button", { name: "Approuver" }).click();
  await pa.waitForTimeout(600);
  const selfApprove = A.calls.filter((c) => c.path.endsWith("/approve")).at(-1);
  const bannerA = await pa.locator("[role=alert], .message-banner, [class*=banner]").allInnerTexts().catch(() => []);
  check("auteur qui clique Approuver : refuse (>= 400), la demande reste PENDING", selfApprove?.status >= 400 && (await api(tokA, "GET", "/config/self-validation-policy/request")).json.data?.status === "PENDING", `status=${selfApprove?.status}; corps envoye=${JSON.stringify(selfApprove?.body)}; banniere=${JSON.stringify(bannerA.join(" / ").slice(0, 200))}`);

  // ===================================================================================== B : approbateur
  const B = await open(browser, APP_B, "B");
  const pb = B.page;
  await goto(pb, "Réglages de gouvernance");
  await pb.getByRole("heading", { name: "Réglages de gouvernance" }).waitFor();
  await pb.waitForTimeout(800);
  check("B (droit d'approbation seul) voit la demande en attente de A", (await pb.getByRole("button", { name: "Approuver" }).count()) === 1);
  await pb.getByRole("button", { name: "Approuver" }).click();
  await pb.waitForTimeout(800);
  const bApprove = B.calls.filter((c) => c.path.endsWith("/approve")).at(-1);
  const stateAfterB = (await api(tokB, "GET", "/config/self-validation-policy/request")).json.data;
  const bannerB = await pb.locator("[role=alert], .message-banner, [class*=banner]").allInnerTexts().catch(() => []);
  check("F-PNL3-01 : B clique Approuver sur l'ecran : la demande est approuvee (200) et la politique appliquee",
    bApprove?.status === 200 && (await api(tokB, "GET", "/config")).json.data.selfValidationPolicy === "DOUBLE_CONFIRMATION",
    `status=${bApprove?.status}; corps envoye=${JSON.stringify(bApprove?.body)}; demande=${stateAfterB?.status}; banniere=${JSON.stringify(bannerB.join(" / ").slice(0, 160))}`, "F-PNL3-01");
  await pb.screenshot({ path: `${SHOTS}/b-approve.png` });

  // 4. B rejette avec un motif sur deux lignes puis sur une ligne
  await pb.getByRole("button", { name: "Rejeter" }).click();
  await pb.locator("#gov-reject-reason").fill(TWO_LINES);
  await pb.getByRole("button", { name: "Rejeter" }).last().click();
  await pb.waitForTimeout(600);
  let rej = B.calls.filter((c) => c.path.endsWith("/reject")).at(-1);
  check("F-PNL3-02 rejet avec un motif sur deux lignes : accepte", rej && rej.status < 400, `status=${rej?.status}`, "F-PNL3-02");
  await pb.locator("#gov-reject-reason").fill("Rejet sur une seule ligne");
  await pb.getByRole("button", { name: "Rejeter" }).last().click();
  await pb.waitForTimeout(800);
  rej = B.calls.filter((c) => c.path.endsWith("/reject")).at(-1);
  check("rejet avec un motif sur une ligne : 200, la demande n'est plus en attente, la politique reste REFUSE",
    rej?.status === 200 && (await api(tokB, "GET", "/config/self-validation-policy/request")).json.data === null && (await api(tokB, "GET", "/config")).json.data.selfValidationPolicy === "REFUSE", `status=${rej?.status}`);

  // 5. le serveur accepte l'approbation AVEC motif (contournement hors ecran), pour la suite du parcours
  const again = await api(tokA, "PUT", "/config/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "Nouvelle demande" });
  const reqId = again.json?.pendingRequest?.id;
  const ok = await api(tokB, "POST", `/config/self-validation-policy/requests/${reqId}/approve`, { reason: "Approuve par B" });
  check("hors ecran : l'approbation avec { reason } passe (200) et applique la politique", again.status === 202 && ok.status === 200 && ok.json.data.selfValidationPolicy === "DOUBLE_CONFIRMATION", `202=${again.status} approve=${ok.status}`);
  const empty = await api(tokA, "PUT", "/config/self-validation-policy", { policy: "REFUSE", reason: "retour" }); // tightening applies directly
  const back = await api(tokA, "PUT", "/config/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "re-assouplir" });
  const reqId2 = back.json?.pendingRequest?.id;
  const noBody = await api(tokB, "POST", `/config/self-validation-policy/requests/${reqId2}/approve`, {});
  check("hors ecran : l'approbation avec un corps vide est refusee 400 (le contrat du backend exige le motif)", empty.status === 200 && back.status === 202 && noBody.status === 400, `${empty.status}/${back.status}/${noBody.status}`);
  await api(tokB, "POST", `/config/self-validation-policy/requests/${reqId2}/approve`, { reason: "ok" });

  // 6. autres reglages : 200 avec un motif sur une ligne ; motif sur deux lignes
  const cardBtn = (title) => pa.locator(".card, [class*=card]").filter({ hasText: title }).getByRole("button", { name: "Modifier" }).first();
  await cardBtn("Passage obligatoire par le Comité").click();
  await pa.locator("#gov-reason").fill(TWO_LINES);
  await pa.getByRole("button", { name: "Enregistrer" }).click();
  await pa.waitForTimeout(600);
  let enf = A.calls.filter((c) => c.path.endsWith("/committee-enforcement")).at(-1);
  check("F-PNL3-02 passage obligatoire par le Comite, motif sur deux lignes : accepte", enf && enf.status < 400, `status=${enf?.status}`, "F-PNL3-02");
  await pa.locator("#gov-setting-form input[type=checkbox]").click();
  await pa.locator("#gov-reason").fill("Motif unique");
  await pa.getByRole("button", { name: "Enregistrer" }).click();
  await pa.waitForTimeout(800);
  enf = A.calls.filter((c) => c.path.endsWith("/committee-enforcement")).at(-1);
  const shown = await pa.locator("#gov-setting-form").innerText().catch(() => "");
  check("F-PNL3-03 « Passage obligatoire par le Comité » (carte modifiable sur l'ecran) : un motif sur une ligne est accepte", enf?.status === 200,
    `status=${enf?.status}; message affiche=${JSON.stringify(shown.split("\n").filter((l) => /Dispositif|invalide/.test(l)))}`, "F-PNL3-03");
  await pa.keyboard.press("Escape");
  for (const [title, path, tag] of [["Mode d'évaluation par défaut", "/evaluation-mode", "mode"], ["Seuils de passage au Comité", "/committee-thresholds", "seuils"]]) {
    await cardBtn(title).click();
    await pa.locator("#gov-reason").fill("Motif unique");
    if (tag === "seuils") await pa.locator("#gov-eval-min").fill("12");
    if (tag === "mode") await pa.locator("#gov-mode").selectOption("PARTICIPATIF");
    await pa.getByRole("button", { name: "Enregistrer" }).click();
    await pa.waitForTimeout(700);
    const c = A.calls.filter((x) => x.path.endsWith(path)).at(-1);
    check(`F-PNL3-03 carte « ${title} » : un motif sur une ligne est accepte`, c?.status === 200, `status=${c?.status}`, "F-PNL3-03");
    await pa.keyboard.press("Escape");
  }
  const cumBefore = (await api(tokA, "GET", "/config")).json.data.committeeAuditCumulAllowed;
  await cardBtn("Cumul Comité et Audit").click();
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
  await pa.locator("[role=dialog] textarea, #gov-confirm-reason").first().fill(TWO_LINES);
  await pa.getByRole("button", { name: "Confirmer sans validation indépendante" }).click();
  await pa.waitForTimeout(700);
  const second = A.calls.filter((c) => c.path.endsWith("/validate")).at(-1);
  const dlg2 = await pa.locator("[role=dialog]").innerText().catch(() => "");
  check("F-PNL3-02 double confirmation avec un motif sur deux lignes : acceptee", second && second.status === 200, `status=${second?.status}; dialogue=${JSON.stringify(dlg2.split("\n").filter((l) => /invalide|Requ/i.test(l)))}`, "F-PNL3-02");
  await pa.locator("[role=dialog] textarea, #gov-confirm-reason").first().fill("Je suis le seul valideur disponible");
  await pa.getByRole("button", { name: "Confirmer sans validation indépendante" }).click();
  await pa.waitForTimeout(1000);
  const last = A.calls.filter((c) => c.path.endsWith("/validate")).at(-1);
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
  check("F-PNL3-02 rejet d'une demande de mode, motif sur deux lignes : accepte", rej2 && rej2.status < 400, `status=${rej2?.status}`, "F-PNL3-02");

  const jsErrors = [...A.errors, ...B.errors];
  check("aucune exception JavaScript pendant le parcours", jsErrors.length === 0, jsErrors.join(" | ").slice(0, 200));
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nTERMINE : aucun echec hors defauts connus" : `\nTERMINE : ${failures} echec(s)`);
process.exit(failures === 0 ? 0 : 1);
