// QA visibilite des ressources, lot V1 : parcours navigateur (Chromium) contre le VRAI backend (tsx, PostgreSQL 16 LOCAL, fournisseur local,
// jamais Neon, jamais Google). Oracles ecrits AVANT l'execution. Comptes <nom>@vv1.test, mot de passe « whatever » (qa-visibility-v1-seed.sql).
//
// ORACLES
//  1. dept (membre du groupe du departement Finance) cree un risque « Restreint au perimetre » avec la personne nommee `named` : la ligne apparait au
//     registre avec le badge « Restreint au périmètre » ; l'API (dept) donne PERIMETRE + [named].
//  2. out (hors perimetre) : la ligne n'est PAS au registre, ni dans la Cartographie ; GET /risks/:id = 404 identique a un id inconnu ; /dashboard/executive ne compte pas le risque ;
//     `own` (pas encore proprietaire) : meme chose. named, rm, com, aud : la ligne est au registre.
//  3. rm designe `own` proprietaire (API). own voit la ligne, ouvre la fiche, carte « Visibilité » : niveau + « Aucune » personne (own n'a pas la liste de named?) -> la liste nommee est visible.
//  4. Modification par le Risk Manager : bouton « Enregistrer » inactif sans motif ; avec motif, niveau « Personnes nommées » -> badge change ; dept (hors liste) perd la ligne ;
//     named la garde. Audit PERMISSION_CHANGE avec le motif.
//  5. own (proprietaire) : s'ajouter lui-meme est refuse (message affiche, niveau inchange) ; « Tout le client » avec motif -> bandeau « retire toute la liste » vu avant, badge « Tout le client »,
//     la liste est vide ; out voit maintenant la ligne.
//  6. rm : la cloche affiche la notification « Visibilité d’un risque élargie par son propriétaire » ; sans contenu du risque ; com et aud : aucune notification de ce type.
//  7. zero erreur JS ; aucune erreur console imprevue (les 404 de lecture d'un risque masque ne sont pas attendus par l'ecran).
//
// Prerequis : tests/integration/qa-visibility-v1-setup.sh up ; qa-visibility-v1-server.sh start (QA_PORT=8099 pour ce script) ;
// vite 127.0.0.1:5198 (VITE_AUTH_PROVIDER=local, VITE_API_BASE_URL=http://127.0.0.1:8099). Variables : QA_API, QA_APP, QA_SHOTS.
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const API = process.env.QA_API ?? "http://127.0.0.1:8099";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5198";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/visibility-v1";
mkdirSync(SHOTS, { recursive: true });
const PSQL = process.env.QA_PSQL ?? "/usr/bin/psql";
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", process.env.QA_DB ?? "grc_qa_vv1", "-Atq"];
const sql = (q) => execFileSync(PSQL, [...PG, "-c", q], { encoding: "utf8" }).trim();
const I = (x) => `aaaaaaaa-0000-4000-8000-000000000${x}`;
const NAMES = ["dept", "out", "own", "named", "rm", "com", "aud"];
const EMAIL = Object.fromEntries(NAMES.map((n) => [n, `${n}@vv1.test`]));
const DESC = `UI-V1-${Date.now().toString(36)}`;

const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const norm = (s) => s.replace(/\s+/g, " ").trim();

// dept et own doivent pouvoir nommer des personnes (annuaire) : droit de lecture des comptes, accorde par SQL (hors perimetre de visibilite).
sql(`update users set roles = roles || '{user.read}' where email in ('dept@vv1.test','own@vv1.test') and not ('user.read' = any(roles))`);

// Le jeu de donnees donne `adm` le droit resourcevisibility.set DIRECTEMENT (cas pathologique de la suite vitest) : il recevrait les notifications. Ici on veut le cas reel.
sql(`update users set roles = array_remove(roles, 'resourcevisibility.set') where email = 'adm@vv1.test'`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
async function open(who) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  // QA-VIS1-05 (preexisting, not V1): the server's CORS allow-list is Authorization,Content-Type only, so the browser blocks the
  // `Idempotency-Key` header of POST /risks cross-origin. TEST WORKAROUND, production untouched: answer the preflight ourselves.
  await context.route(`${API}/**`, (route) => {
    const req = route.request();
    if (req.method() !== "OPTIONS") return route.continue();
    return route.fulfill({ status: 204, headers: {
      "access-control-allow-origin": APP, "access-control-allow-methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
      "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key", vary: "Origin" } });
  });
  const page = await context.newPage();
  const st = { page, context, consoleErrors: [], jsErrors: [] };
  page.on("pageerror", (e) => st.jsErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") st.consoleErrors.push(m.text()); });
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await page.goto(APP);
  await page.getByLabel("Adresse e-mail QA").fill(EMAIL[who]);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await nav.waitFor();
  await sleep(800);
  st.go = async (label) => {
    const entry = nav.getByRole("button", { name: new RegExp(`^${label}`) });
    if ((await entry.count()) === 0 || !(await entry.first().isVisible())) {
      const group = nav.locator("button.sidebar-group-toggle", { hasText: /Risques/ });
      if ((await group.first().getAttribute("aria-expanded")) !== "true") await group.first().click();
    }
    await nav.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
    await sleep(1200);
  };
  st.registry = async () => { await st.go("Registre"); return norm(await page.locator("main").innerText()); };
  st.shot = (name) => page.screenshot({ path: `${SHOTS}/${who}-${name}.png`, fullPage: true });
  return st;
}

try {
  for (const w of NAMES) await login(w);
  const me = {};
  for (const w of NAMES) me[w] = (await api(w, "GET", "/users/me")).json?.data?.id;
  check("preparation : 7 comptes connectés", Object.values(me).every(Boolean));

  // ---- 1. dept cree le risque restreint dans l'ecran
  const D = await open("dept");
  await D.go("Registre");
  await D.page.locator("#risk-process").fill("Processus UI V1");
  await D.page.locator("#risk-description").fill(DESC);
  await D.page.locator("#risk-department").selectOption({ label: "Finance QA" });
  await D.page.locator("#risk-visibility").selectOption("PERIMETRE");
  await D.page.locator("#risk-access").selectOption({ label: "QA named" });
  await D.page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const listed = norm(await D.page.locator(".risk-access-list").innerText());
  check("1.1 la personne nommée est listée dans le formulaire avant création", /QA named/.test(listed), listed);
  await D.page.getByRole("button", { name: "Créer", exact: true }).click();
  await sleep(1500);
  await D.shot("created");
  const row = D.page.locator("tr", { hasText: DESC });
  check("1.2 la ligne apparaît au registre du créateur", (await row.count()) === 1);
  check("1.3 badge « Restreint au périmètre » sur la ligne", /Restreint au périmètre/.test(await row.innerText()));
  const mine = (await api("dept", "GET", "/risks")).json.data.find((r) => r.description === DESC);
  const RID = mine?.id;
  const vis = (await api("dept", "GET", `/risks/${RID}/visibility`)).json?.data;
  check("1.4 API : PERIMETRE + [named]", vis?.visibility === "PERIMETRE" && vis.accessUserIds.length === 1 && vis.accessUserIds[0] === me.named, JSON.stringify(vis));
  check("1.5 la création est auditée (CREATE) avec la liste", sql(`select count(*) from audit_log where entity_id::text='${RID}' and action='CREATE' and new_value::text like '%accessUserIds%'`) === "1");

  // ---- 2. hors perimetre
  const O = await open("out");
  const outReg = await O.registry();
  check("2.1 out : la ligne n'est pas au registre", !outReg.includes(DESC));
  await O.go("Cartographie");
  check("2.2 out : la ligne n'est pas dans la cartographie", !norm(await O.page.locator("main").innerText()).includes(DESC));
  const hidden = await api("out", "GET", `/risks/${RID}`);
  const unknown = await api("out", "GET", `/risks/${I("9ff")}`);
  check("2.3 out : fiche = 404 identique à un id inconnu", hidden.status === 404 && JSON.stringify(hidden.json).replace(RID, "X").replace(/"requestId":"[^"]*"/, "") === JSON.stringify(unknown.json).replace(I("9ff"), "X").replace(/"requestId":"[^"]*"/, ""));
  const exe = (await api("out", "GET", "/dashboard/executive")).json.data;
  const exeRm = (await api("rm", "GET", "/dashboard/executive")).json.data;
  check("2.4 tableau de bord : out compte 1 risque actif (le CLIENT), rm en compte 4 (3 du jeu + celui-ci)", exe.totalActiveRisks === 1 && exeRm.totalActiveRisks === 4, `${exe.totalActiveRisks} / ${exeRm.totalActiveRisks}`);
  check("2.5 out : la cartographie et le tableau de bord (API) ne contiennent pas le texte", !JSON.stringify((await api("out", "GET", "/cartography")).json).includes(DESC) && !JSON.stringify((await api("out", "GET", "/dashboard/risks")).json).includes(DESC));
  const W = await open("own");
  check("2.6 own (pas encore propriétaire) : ligne absente", !(await W.registry()).includes(DESC));
  for (const who of ["named", "rm", "com", "aud"]) {
    const S = await open(who);
    check(`2.7 ${who} : la ligne est au registre`, (await S.registry()).includes(DESC));
    await S.context.close();
  }

  // ---- 3. rm designe own proprietaire
  const own = await api("rm", "POST", `/risks/${RID}/owner`, { ownerId: me.own });
  check("3.1 rm désigne own propriétaire (API 200)", own.status === 200, String(own.status));
  const W2 = await open("own");
  check("3.2 own propriétaire : la ligne est au registre", (await W2.registry()).includes(DESC));
  await W2.page.locator("tr", { hasText: DESC }).getByRole("button", { name: "Ouvrir" }).click();
  await sleep(1500);
  await W2.shot("sheet");
  const cardText = norm(await W2.page.locator("main").innerText());
  check("3.3 fiche : carte « Visibilité » = niveau + personne nommée", /Restreint au périmètre/.test(cardText) && /QA named/.test(cardText), cardText.slice(0, 160));

  // ---- 4. modification par le Risk Manager
  const R = await open("rm");
  await R.go("Registre");
  await R.page.locator("tr", { hasText: DESC }).getByRole("button", { name: "Ouvrir" }).click();
  await sleep(1500);
  await R.page.getByRole("button", { name: "Modifier la visibilité" }).click();
  const save = R.page.getByRole("button", { name: "Enregistrer", exact: true });
  check("4.1 sans motif, « Enregistrer » est inactif", await save.isDisabled());
  await R.page.locator("#risk-visibility-level").selectOption("NOMINATIF");
  await R.page.locator("#risk-visibility-reason").fill("   ");
  check("4.2 motif blanc : toujours inactif", await save.isDisabled());
  await R.page.locator("#risk-visibility-reason").fill("Dossier sensible QA");
  await save.click();
  await sleep(1500);
  await R.shot("changed");
  const rcard = norm(await R.page.locator("main").innerText());
  check("4.3 le niveau affiché devient « Personnes nommées »", /Niveau\s*Personnes nommées/.test(rcard), rcard.slice(0, 200));
  const aud = sql(`select reason||'|'||(new_value->>'visibility') from audit_log where entity_id::text='${RID}' and action='PERMISSION_CHANGE' order by timestamp desc limit 1`);
  check("4.4 audit PERMISSION_CHANGE avec le motif", aud === "Dossier sensible QA|NOMINATIF", aud);
  const D2 = await open("dept");
  check("4.5 dept (hors liste) perd la ligne", !(await D2.registry()).includes(DESC));
  const N = await open("named");
  check("4.6 named (sur la liste) la garde", (await N.registry()).includes(DESC));
  check("4.7 notification : aucune pour l'élargissement par le RM (il restreint)", sql(`select count(*) from notifications where resource_id='${RID}'`) === "0");

  // ---- 5. proprietaire : auto-ajout refuse, puis elargissement
  const W3 = await open("own");
  await W3.go("Registre");
  await W3.page.locator("tr", { hasText: DESC }).getByRole("button", { name: "Ouvrir" }).click();
  await sleep(1500);
  await W3.page.getByRole("button", { name: "Modifier la visibilité" }).click();
  await W3.page.locator("#risk-visibility-level").selectOption("PERIMETRE");
  await W3.page.locator("#risk-visibility-add").selectOption({ label: "QA own" });
  await W3.page.locator("form", { has: W3.page.locator("#risk-visibility-level") }).getByRole("button", { name: "Ajouter", exact: true }).click();
  await W3.page.locator("#risk-visibility-reason").fill("Tentative auto-ajout");
  await W3.page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await sleep(1200);
  const err = norm(await W3.page.locator("main").innerText());
  check("5.1 auto-ajout : refus affiché (« yourself »), niveau inchangé en base", /yourself/i.test(err) && sql(`select visibility from risks where id='${RID}'`) === "NOMINATIF", err.slice(0, 160));
  await W3.shot("selfadd-refused");
  await W3.page.getByRole("button", { name: "Annuler" }).click();
  await W3.page.getByRole("button", { name: "Modifier la visibilité" }).click();
  await W3.page.locator("#risk-visibility-level").selectOption("CLIENT");
  const warn = norm(await W3.page.locator("main").innerText());
  check("5.2 bandeau « retire toute la liste » avant de valider", /retire toute la liste/.test(warn));
  await W3.page.locator("#risk-visibility-reason").fill("Plus sensible");
  await W3.page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await sleep(1500);
  await W3.shot("widened");
  const after = norm(await W3.page.locator("main").innerText());
  check("5.3 niveau « Tout le client », personnes nommées « Aucune »", /Niveau\s*Tout le client/.test(after) && /Personnes nommées\s*Aucune/.test(after), after.slice(0, 200));
  check("5.4 liste purgée en base", sql(`select count(*) from resource_access_grants where resource_id='${RID}' and revoked_at is null`) === "0");
  const O2 = await open("out");
  check("5.5 out voit maintenant la ligne", (await O2.registry()).includes(DESC));

  // ---- 6. notification du groupe Risk Manager
  const notifs = sql(`select string_agg(u.email, ',' order by u.email) from notifications n join users u on u.id=n.recipient_user_id where n.resource_id='${RID}' and n.event_type='RISK_VISIBILITY_WIDENED'`);
  check("6.1 base : destinataire = rm (groupe Risk Manager) ; ni own, ni com, ni aud", notifs === "rm@vv1.test", notifs);
  const R2 = await open("rm");
  await R2.page.getByRole("button", { name: /^Notifications/ }).click();
  await sleep(1200);
  const modal = norm(await R2.page.locator("dialog[open], [role=dialog]").first().innerText());
  await R2.shot("notif");
  check("6.2 rm : la cloche affiche l'événement d'élargissement", /Visibilité d’un risque élargie par son propriétaire/.test(modal), modal.slice(0, 200));
  check("6.3 la notification ne contient pas le contenu du risque", !modal.includes(DESC));
  for (const who of ["com", "aud"]) {
    const S = await open(who);
    await S.page.getByRole("button", { name: /^Notifications/ }).click();
    await sleep(1000);
    check(`6.4 ${who} : aucune notification d'élargissement`, !/élargie par son propriétaire/.test(norm(await S.page.locator("dialog[open], [role=dialog]").first().innerText())));
    await S.context.close();
  }

  // ---- 7. erreurs
  const all = [D, O, W, W2, W3, R, R2, D2, N, O2];
  const js = all.flatMap((s) => s.jsErrors);
  check("7.1 aucune erreur JS", js.length === 0, js.join(" | ").slice(0, 200));
  const con = all.flatMap((s) => s.consoleErrors).filter((t) => !/404|Failed to load resource/.test(t));
  check("7.2 aucune erreur console imprévue", con.length === 0, con.join(" | ").slice(0, 300));
} catch (e) {
  check("exception du script", false, String(e).slice(0, 400));
} finally {
  await browser.close();
  console.log(`\nECHECS : ${failures()}`);
  process.exit(failures() ? 1 : 0);
}
