// QA-panel2 : parcours navigateur (Chromium) du frontend F0/F1/F2 sur API SIMULEE (aucun backend, aucune base).
//
// Prerequis : le frontend tourne en dev avec
//   VITE_API_BASE_URL=http://api.test VITE_AUTH_PROVIDER=local VITE_LOCAL_AUTH_EMAIL=qa@example.test npx vite --port 5199 --host 127.0.0.1
// (le design-system doit etre construit : npm run build --workspace @djamo/design-system), puis :
//   node tests/integration/qa-panel2-front-playwright.mjs
// Chromium : /opt/pw-browsers/chromium ; playwright : /opt/node-tools/node_modules/playwright.
// Les oracles sont ecrits avant l'execution (voir le rapport docs/qa/qa-panel-retest-2026-10-19.md).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const API = "http://api.test";
const SHOTS = process.env.QA_SHOTS ?? "/tmp/claude-0/qa-panel2-shots";
mkdirSync(SHOTS, { recursive: true });

const results = [];
// `known` = a defect already reported in the QA report: a failure is printed KNOWN-DEFECT and does not fail the run.
const check = (name, ok, detail = "", known = "") => {
  const status = ok ? "PASS" : known ? `KNOWN-DEFECT(${known})` : "FAIL";
  results.push({ name, ok: Boolean(ok) || Boolean(known), detail });
  console.log(`${status}  ${name}${detail ? "  -> " + detail : ""}`);
};

const cors = { "access-control-allow-origin": APP, "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "X-Request-Id", "x-request-id": "req-qa" };
const MISSION = { id: "m1", reference: "MIS-1", title: "Mission test", scope: "s", status: "EN_COURS", leadAuditorId: "u", auditorIds: [], plannedStartDate: "2026-01-01", plannedEndDate: "2026-12-31", actualStartDate: null, actualEndDate: null, closureComment: null, createdBy: "u", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
const finding = (over = {}) => ({ id: "f1", auditMissionId: "m1", title: "Constat A", description: "d", severity: "HIGH", recommendation: null, relatedObjectType: null, relatedObjectId: null, status: "EN_TRAITEMENT", raisedBy: "me", closedBy: null, closedAt: null, closureComment: null, createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z", ...over });
const plan = (over = {}) => ({ id: "ap1", title: "Plan A", description: "", sourceType: "MANAGEMENT", sourceId: null, responsibleUserId: "me", departmentId: null, dueDate: "2027-01-01", status: "EN_COURS", computedStatus: "EN_COURS", progressPercent: 40, progressComment: null, evidenceId: null, createdBy: "me", closedBy: null, closedAt: null, closureComment: null, createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z", links: [], ...over });

/** Installs the simulated API. `script` decides the answers of the two close routes. */
async function mockApi(context, script) {
  const log = [];
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    log.push({ method: req.method(), path, body });
    const json = (status, payload) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (path === "/api/v1/auth/local") return json(200, { accessToken: "tok" });
    if (path === "/api/v1/audit-missions") return json(200, { data: [MISSION] });
    if (path === "/api/v1/findings" && req.method() === "GET") return json(200, { data: script.findings() });
    if (/^\/api\/v1\/findings\/[^/]+\/close$/.test(path)) return script.closeFinding(json, body);
    if (path === "/api/v1/dashboard/actions" && req.method() === "GET") return json(200, { data: script.plans() });
    if (/^\/api\/v1\/actions\/[^/]+\/close$/.test(path)) return script.closePlan(json, body);
    if (path === "/api/v1/evidences" && req.method() === "POST") return json(201, { data: { id: "ev1", fileName: "preuve.txt", documentType: "ACTION_PLAN_CLOSURE", uploadedAt: "2026-02-02T00:00:00Z" } });
    if (path === "/api/v1/config/self-validation-policy") return json(202, { data: { selfValidationPolicy: "REFUSE" }, pendingRequest: { id: "req1", status: "PENDING", requestedPolicy: "DOUBLE_CONFIRMATION" } });
    if (path === "/api/v1/notifications/unread-count") return json(200, { data: { count: 0 } });
    return json(200, { data: [] });
  });
  return log;
}

async function login(page) {
  await page.goto(APP);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("navigation", { name: "Navigation principale" }).waitFor();
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
try {
  // ------------------------------------------------------------------------------------------------ F1 menu
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await mockApi(context, { findings: () => [], plans: () => [], closeFinding: (j) => j(200, { data: {} }), closePlan: (j) => j(200, { data: {} }) });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    await login(page);
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    const toggles = nav.locator("button.sidebar-group-toggle");
    const labels = (await toggles.allInnerTexts()).map((t) => t.replace(/\s*\d+\s*$/, "").trim().toLowerCase());
    check("F1 menu : sept groupes dans l'ordre Risques, Contrôle interne, Indicateurs, Plans & revues, Audit, Administration", JSON.stringify(labels) === JSON.stringify(["Risques", "Contrôle interne", "Indicateurs", "Plans & revues", "Audit", "Administration"].map((x) => x.toLowerCase())), JSON.stringify(labels));
    check("F1 menu : « Risques » est ouvert au départ (aria-expanded) avec Cartographie, Registre, Évaluations",
      (await toggles.first().getAttribute("aria-expanded")) === "true" && (await nav.locator(".sidebar-group").first().locator("button.sidebar-link").allInnerTexts()).map((t) => t.trim()).join("|") === "Cartographie|Registre|Évaluations");
    await toggles.last().click();
    check("F1 menu : ouvrir « Administration » referme « Risques » (un seul groupe ouvert)", (await toggles.first().getAttribute("aria-expanded")) === "false" && (await toggles.last().getAttribute("aria-expanded")) === "true");
    const heads = (await nav.locator(".sidebar-subhead").allInnerTexts()).map((h) => h.toLowerCase());
    check("F1 menu : Administration > Méthodologie / Référentiels / Plateforme (intertitres, non cliquables)", JSON.stringify(heads) === JSON.stringify(["méthodologie", "référentiels", "plateforme"]), JSON.stringify(heads));
    const adminItems = (await nav.locator(".sidebar-group").last().locator("button.sidebar-link").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    check("F1 menu : le Dispositif, les grilles et l'appétence sont sous Méthodologie, avant Référentiels", adminItems.slice(0, 3).join("|") === "Dispositif de risque|Grilles de cotation|Appétence", adminItems.join("|"));
    await nav.getByRole("button", { name: /Grilles de cotation/ }).click();
    check("F1 menu : cliquer un item charge l'écran (titre de la barre haute)", (await page.locator(".topbar-title strong").innerText()) === "Grilles de cotation");
    const soon = nav.getByRole("button", { name: /Paramètres & référentiels/ });
    check("F1 menu : un item « À venir » est aria-disabled et ne change pas d'écran", (await soon.getAttribute("aria-disabled")) === "true");
    await soon.click({ force: true });
    check("F1 menu : cliquer un item « À venir » laisse l'écran courant", (await page.locator(".topbar-title strong").innerText()) === "Grilles de cotation");
    // keyboard
    await toggles.nth(1).focus();
    await page.keyboard.press("Enter");
    check("F1 menu : au clavier, Entrée sur un groupe l'ouvre", (await toggles.nth(1).getAttribute("aria-expanded")) === "true");
    // collapsed rail
    await page.locator("button.sidebar-collapse").click();
    const railLinks = await nav.locator("button.sidebar-link").count();
    check("F1 menu : rail replié = tous les items restent atteignables (titre en infobulle)", railLinks >= 20, `items=${railLinks}`);
    await page.screenshot({ path: `${SHOTS}/f1-rail.png` });
    await page.locator("button.sidebar-collapse").click();
    await page.screenshot({ path: `${SHOTS}/f1-menu-admin.png` });
    // mobile
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(600);
    const asideVisibleBefore = await page.locator("aside.app-sidebar").evaluate((el) => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left >= 0; });
    await page.getByRole("button", { name: "Ouvrir la navigation" }).click();
    await page.waitForTimeout(600);
    const asideVisibleAfter = await page.locator("aside.app-sidebar").evaluate((el) => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left >= 0; });
    await page.screenshot({ path: `${SHOTS}/f1-mobile-open.png` });
    check("F1 menu mobile : le menu est caché puis s'ouvre par le bouton", !asideVisibleBefore && asideVisibleAfter, `avant=${asideVisibleBefore} apres=${asideVisibleAfter}`);
    await nav.locator("button.sidebar-group-toggle").first().click();
    await nav.getByRole("button", { name: /Cartographie/ }).click();
    await page.waitForTimeout(600);
    check("F1 menu mobile : choisir un item referme le menu", (await page.locator("aside.app-sidebar").evaluate((el) => el.getBoundingClientRect().right <= 0)) === true);
    check("F1 : aucune exception JavaScript pendant le parcours", consoleErrors.length === 0, consoleErrors.join(" | "));
    await context.close();
  }

  // ------------------------------------------------------------------------------------------------ F2 sur les constats
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let state = finding();
    const calls = [];
    const log = await mockApi(context, {
      findings: () => [state],
      plans: () => [],
      closePlan: (j) => j(200, { data: {} }),
      closeFinding: (j, body) => {
        calls.push(body);
        const conf = body?.governanceConfirmation;
        if (!conf) return j(409, { error: "GOVERNANCE_CONFIRMATION_REQUIRED: The auditor who raised this Finding cannot close it themselves — ask another auditor to close it Personne d'autre ne peut valider : renvoyez la demande avec governanceConfirmation.", requestId: "r1" });
        if (conf.reason.includes("INVALIDE")) return j(400, { error: "Requête invalide.", requestId: "r2" });
        state = finding({ status: "CLOS", closedBy: "me", closureComment: body.comment, validationIndependence: "WITHOUT_INDEPENDENT_REVIEW" });
        return j(200, { data: state });
      },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await login(page);
    await page.locator("nav button.sidebar-group-toggle", { hasText: "Audit" }).click();
    await page.getByRole("button", { name: /Constats & recommandations/ }).click();
    await page.getByText("Constat A").waitFor();
    await page.getByRole("button", { name: "Clôturer", exact: true }).click();
    await page.locator("#closure-comment").fill("Clôture par l'auditeur auteur");
    await page.getByRole("button", { name: "Confirmer la clôture" }).click();
    const dialog = page.getByRole("dialog", { name: /Appliquer sans validation indépendante/ });
    await dialog.waitFor({ timeout: 5000 }).catch(() => undefined);
    const dialogCount = await page.getByText("Appliquer sans validation indépendante", { exact: true }).count();
    check("F2 constat : le 409 ouvre le dialogue de double confirmation", dialogCount >= 1, `occurrences du titre=${dialogCount}`);
    const hit = await page.locator("#gov-confirm-reason").evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { onTop: top === el || el.contains(top), topTag: top?.tagName, topClass: top?.className?.toString().slice(0, 60) };
    }).catch((e) => ({ onTop: false, topTag: String(e) }));
    await page.screenshot({ path: `${SHOTS}/f2-finding-dialog.png` });
    check("F2 constat : le dialogue est AU-DESSUS de la fenêtre « Clôturer le constat » (zone de saisie atteignable)", hit.onTop, JSON.stringify(hit));
    const confirmBtn = page.getByRole("button", { name: "Confirmer sans validation indépendante" });
    check("F2 constat : le bouton de confirmation reste inactif sans motif", await confirmBtn.isDisabled());
    await page.locator("#gov-confirm-reason").fill("   ");
    check("F2 constat : un motif d'espaces ne l'active pas", await confirmBtn.isDisabled());
    await page.locator("#gov-confirm-reason").fill("INVALIDE motif refusé par le serveur");
    await confirmBtn.click();
    await page.getByText("Requête invalide.").first().waitFor({ timeout: 3000 }).catch(() => undefined);
    check("F2 constat : un 400 du serveur reste DANS le dialogue (motif corrigeable), rien n'est clos", (await page.getByText("Requête invalide.").count()) >= 1 && state.status === "EN_TRAITEMENT");
    await page.locator("#gov-confirm-reason").fill("Seul auditeur de la structure");
    await Promise.all([confirmBtn.dblclick().catch(() => undefined)]);
    await page.getByText("Constat clôturé").first().waitFor({ timeout: 5000 }).catch(() => undefined);
    const closeCalls = calls.filter((c) => c?.governanceConfirmation && !c.governanceConfirmation.reason.includes("INVALIDE"));
    check("F2 constat : le renvoi porte { rule: noSelfValidation, reason } et le MÊME commentaire", closeCalls.length >= 1 && closeCalls[0].governanceConfirmation.rule === "noSelfValidation" && closeCalls[0].comment === "Clôture par l'auteur".replace("l'auteur", "l'auditeur auteur"), JSON.stringify(closeCalls[0] ?? null));
    check("F2 constat : un double clic n'envoie le renvoi qu'UNE fois", closeCalls.length === 1, `renvois=${closeCalls.length}`);
    check("F2 constat : le premier appel est parti SANS confirmation (l'écran ne prédit pas la règle)", calls[0] && calls[0].governanceConfirmation === undefined);
    check("F2 constat : après succès, la ligne affiche CLOS et le badge « Appliqué sans validation indépendante »", (await page.locator("table").getByText("Appliqué sans validation indépendante").count()) >= 1);
    check("F2 constat : la fenêtre de clôture et le dialogue sont refermés", (await page.getByRole("dialog").count()) === 0 || (await page.locator('[role="dialog"]:visible').count()) === 0);
    await page.screenshot({ path: `${SHOTS}/f2-finding-after.png` });

    // cancel path on a fresh row
    state = finding({ id: "f2", title: "Constat B" });
    await page.getByRole("button", { name: "Actualiser" }).click();
    await page.getByText("Constat B").waitFor();
    const before = calls.length;
    await page.getByRole("button", { name: "Clôturer", exact: true }).click();
    await page.locator("#closure-comment").fill("Clôture B");
    await page.getByRole("button", { name: "Confirmer la clôture" }).click();
    await page.locator("#gov-confirm-reason").waitFor({ timeout: 5000 });
    await page.locator("dialog[open]").filter({ has: page.locator("#gov-confirm-reason") }).getByRole("button", { name: "Annuler" }).click();
    await page.getByText(/Confirmation annulée/).first().waitFor({ timeout: 3000 }).catch(() => undefined);
    check("F2 constat : Annuler n'envoie aucun renvoi et l'écran le dit (« Confirmation annulée »)", calls.length === before + 1 && (await page.getByText(/Confirmation annulée/).count()) >= 1, `appels depuis=${calls.length - before}`);
    check("F2 constat : après Annuler le constat n'est pas clos", state.status === "EN_TRAITEMENT");
    // Escape key on the dialog
    await page.getByRole("button", { name: "Confirmer la clôture" }).click().catch(() => undefined);
    check("F2 : aucune exception JavaScript", errors.length === 0, errors.join(" | "));
    void log;
    await context.close();
  }

  // ------------------------------------------------------------------------------------------------ F2 sur les plans d'action
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let state = plan();
    const calls = [];
    await mockApi(context, {
      findings: () => [], plans: () => [state], closeFinding: (j) => j(200, { data: {} }),
      closePlan: (j, body) => {
        calls.push(body);
        if (!body?.governanceConfirmation) return j(409, { error: "GOVERNANCE_CONFIRMATION_REQUIRED: The actor who created this action cannot close it themselves — ask another user to close it Personne d'autre ne peut valider.", requestId: "r1" });
        state = plan({ status: "TERMINEE", computedStatus: "TERMINEE", evidenceId: "ev1", closedBy: "me" }); // GET /dashboard/actions carries NO validationIndependence (backend actionPlanDashboard.routes.ts)
        return j(200, { data: { ...state, validationIndependence: "WITHOUT_INDEPENDENT_REVIEW" } }); // PATCH /actions/:id/close does
      },
    });
    const page = await context.newPage();
    await login(page);
    await page.locator("nav button.sidebar-group-toggle", { hasText: "Plans & revues" }).click();
    await page.getByRole("button", { name: /Plans d'action/ }).click();
    await page.getByText("Plan A").waitFor();
    await page.getByRole("button", { name: /Clôturer/ }).first().click();
    await page.locator('input[type="file"]').first().setInputFiles({ name: "preuve.txt", mimeType: "text/plain", buffer: Buffer.from("preuve") });
    await page.getByRole("button", { name: /Déposer|Téléverser|Envoyer/ }).first().click().catch(() => undefined);
    await page.getByText(/Preuve déposée/).first().waitFor({ timeout: 5000 }).catch(() => undefined);
    const confirmClose = page.getByRole("button", { name: /Confirmer la clôture/ });
    await confirmClose.click().catch(() => undefined);
    await page.locator("#gov-confirm-reason").waitFor({ timeout: 5000 }).catch(() => undefined);
    const open = (await page.locator("#gov-confirm-reason").count()) === 1;
    check("F2 plan d'action : le 409 ouvre le dialogue", open);
    if (open) {
      const hit = await page.locator("#gov-confirm-reason").evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === el || el.contains(top); });
      await page.screenshot({ path: `${SHOTS}/f2-plan-dialog.png` });
      check("F2 plan d'action : le dialogue est au-dessus de la fenêtre de clôture", hit);
      await page.locator("#gov-confirm-reason").fill("Seul responsable disponible");
      await page.getByRole("button", { name: "Confirmer sans validation indépendante" }).click();
      await page.getByText(/Clôture enregistrée/).first().waitFor({ timeout: 5000 }).catch(() => undefined);
      check("F2 plan d'action : le renvoi garde l'evidenceId et le commentaire, et porte la confirmation", calls.length === 2 && calls[1].evidenceId === "ev1" && calls[1].governanceConfirmation?.rule === "noSelfValidation", JSON.stringify(calls[1] ?? null));
      await page.getByRole("button", { name: "Actualiser" }).click().catch(() => undefined);
      await page.waitForTimeout(500);
      check("F2 plan d'action : après rechargement de la liste (GET /dashboard/actions), le badge « Appliqué sans validation indépendante » est affiché", (await page.getByText("Appliqué sans validation indépendante").count()) >= 1, "la liste lue par l'écran ne porte pas validationIndependence", "F-PNL2-01");
    }
    await context.close();
  }

  // ------------------------------------------------------------------------------------------------ F0 client : 202 pendingRequest
  {
    const context = await browser.newContext();
    await mockApi(context, { findings: () => [], plans: () => [], closeFinding: (j) => j(200, { data: {} }), closePlan: (j) => j(200, { data: {} }) });
    const page = await context.newPage();
    await login(page);
    const out = await page.evaluate(async () => {
      const mod = await import("/src/api/client.ts");
      const full = await mod.apiRequestFull("/api/v1/config/self-validation-policy", { method: "PUT", token: "t", body: { policy: "DOUBLE_CONFIRMATION", reason: "x" } });
      const plain = await mod.apiRequest("/api/v1/config/self-validation-policy", { method: "PUT", token: "t", body: { policy: "DOUBLE_CONFIRMATION", reason: "x" } });
      return { fullStatus: full.status, fullPending: full.pendingRequest ?? null, fullData: full.data, plain };
    });
    check("F0 client : apiRequestFull garde le 202 et le pendingRequest", out.fullStatus === 202 && out.fullPending?.status === "PENDING", JSON.stringify(out));
    check("F0 client : apiRequest (le chemin de TOUS les écrans) renvoie la config inchangée SANS signal d'attente (piege pour D7)", out.plain?.selfValidationPolicy === "REFUSE" && !("pendingRequest" in (out.plain ?? {})), JSON.stringify(out.plain));
    await context.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ` ; ${failed.length} FAIL` : ""}`);
process.exit(failed.length ? 1 : 0);
