// QA-F7S6 : parcours navigateur (Chromium) de l'ecran KRI (KriPage.tsx) contre le VRAI backend (tsx, PostgreSQL 16 LOCAL, jamais Neon).
// Prerequis : qa-f7s6-front-setup.sh up ; backend 127.0.0.1:8099 (AUTH_PROVIDER=local, preload qa-f7s1-test-preload.mjs) ; vite 127.0.0.1:5199.
// Comptes (mot de passe « whatever ») : m = tous droits KRI + risk/department ; l = kri.read seul ; u = kri.update sans kri.delete ; x = autre tenant.
// ORACLES (ecrits avant execution)
//  A. Jeu : depts Alpha/Beta ; risques A1,A2 (Alpha), B1 (Beta), D (Alpha, archive plus tard) ; KRI K1 (A1, Entite-1, mesure 0.5 le 2026-10-01 -> Vert),
//     K2 (B1, Entite-2, mesure 12 le 2026-10-20 -> Rouge), K3 (A2, Entite-1, sans mesure). Seuils 1/5/10.
//  1. Tableau de bord : 3 lignes ; filtre Statut Rouge -> K2 ; Departement Beta -> K2 ; Entite Entite-1 -> K1,K3 ; « Dernière mesure du » 2026-10-15 -> K2 ; combinaison vide -> message vide.
//  2. Fiche K1 : formule, « Autres risques couverts : aucun ». Cocher A2 + B1 puis Enregistrer -> texte mis a jour, API coveredRiskIds = {A2,B1},
//     audit ASSIGN old {[]} -> new {A2,B1} ; re-ouvrir : cases cochees ; retirer B1 -> audit old {A2,B1} -> new {A2}. La liste de cases exclut le risque principal, un risque archive et un risque d'un autre tenant.
//  3. Risque couvert devenu archive (D couvert par K3 puis archive) : rouvrir « Risques couverts » de K3 et enregistrer un changement doit aboutir (sinon defaut).
//  4. Desactivation K2 : motif espaces seuls -> refus, KRI toujours liste ; motif valide -> K2 disparait, API GET = 404, base : deleted_at/deletion_reason renseignes,
//     audit DELETE avec motif ; mesure sur K2 -> 400 ; KRI et mesures conserves en base.
//  5. l (lecture) : ni « Nouveau KRI », ni Modifier / Risques couverts / Désactiver / Saisir une mesure. u : Modifier + Risques couverts, pas Désactiver ; API disable par u = 403, PUT {active:false} = 4xx.
//  6. x (autre tenant) : disable K1 = 404 ; M rattache un risque de x a K1 = 400 ; KRI de M absents du dashboard de x.
//  7. Aucun console.error ni exception JS pendant les parcours de m, l, u (hors 4xx volontaires journalises « Failed to load resource »).
import { localApi, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8099";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5199";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/f7s6";
const PSQL = process.env.QA_PSQL ?? "/usr/bin/psql"; // chemin absolu (Sonar S4036)
const sql = (q) => execFileSync(PSQL, ["-h", "127.0.0.1", "-p", process.env.QA_DB_PORT ?? "55437", "-U", "postgres", "-d", "grc_qa_f7s3", "-Atq", "-c", q], { encoding: "utf8" }).trim();
const EMAIL = Object.fromEntries(["m", "l", "u", "x"].map((k) => [k, `qa-f7s6-${k}@f7s6.test`]));
mkdirSync(SHOTS, { recursive: true });

const { check, failures } = verdicts();
const { TOK, login, api } = localApi(API, EMAIL);
const norm = (s) => s.replace(/\s+/g, " ").trim();
// Code-unit order, identical to the default sort of strings, with an explicit compare function (Sonar S2871).
const byText = (x, y) => Number(x > y) - Number(x < y);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

async function open(who) {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 1000 } })).newPage();
  const st = { page, errors: [], bad: [] };
  page.on("pageerror", (e) => st.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) st.errors.push(m.text()); });
  page.on("response", (r) => { if (r.url().startsWith(API) && r.status() >= 500) st.bad.push(`${r.status()} ${r.url()}`); });
  await page.goto(APP);
  await page.getByLabel("Adresse e-mail QA").fill(EMAIL[who]);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await nav.waitFor();
  await sleep(800);
  const group = nav.locator("button.sidebar-group-toggle", { hasText: /Indicateurs/i });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await nav.getByRole("button", { name: /^KRI/ }).click();
  await page.getByRole("heading", { name: "Indicateurs de risque (KRI)" }).waitFor();
  await sleep(900);
  st.labels = async () => (await page.locator("table").first().locator("tbody tr td:first-child strong").allInnerTexts()).map(norm).sort(byText);
  st.btn = (name) => page.getByRole("button", { name, exact: true });
  st.detail = async (label) => { await page.getByRole("button", { name: `Voir le détail de ${label}` }).click(); await sleep(900); };
  return st;
}

try {
  for (const w of ["m", "l", "u", "x"]) await login(w);
  const D = (r) => r.json?.data;
  // ---------------- jeu A (API, comptes m et x)
  const dA = D(await api("m", "POST", "/departments", { name: "Dept Alpha QA", manager: "Mgr A" })).id;
  const dB = D(await api("m", "POST", "/departments", { name: "Dept Beta QA", manager: "Mgr B" })).id;
  // La creation de risque exige un en-tete Idempotency-Key (non gere par localApi).
  const mkRisk = async (who, description, ownerDepartmentId) => {
    const r = await fetch(`${API}/api/v1/risks`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOK[who]}`, "idempotency-key": `qa-f7s6-${description}` }, body: JSON.stringify({ process: "Process QA", description, ownerDepartmentId }) });
    return (await r.json()).data?.id;
  };
  const rA1 = await mkRisk("m", "Risque A1 QA", dA), rA2 = await mkRisk("m", "Risque A2 QA", dA), rB1 = await mkRisk("m", "Risque B1 QA", dB), rD = await mkRisk("m", "Risque D archive QA", dA);
  const rX = await mkRisk("x", "Risque autre tenant QA", null);
  const mkKri = async (label, riskId, entity) => D(await api("m", "POST", "/kris", { label, formula: "f", thresholdGreen: 1, thresholdOrange: 5, thresholdRed: 10, frequency: "MONTHLY", riskId, entity })).id;
  const k1 = await mkKri("KRI Vert QA", rA1, "Entite-1"), k2 = await mkKri("KRI Rouge QA", rB1, "Entite-2"), k3 = await mkKri("KRI Sans mesure QA", rA2, "Entite-1");
  const meas = (kriId, measureDate, value) => api("m", "POST", "/kri-measures", { kriId, measureDate, value, source: "qa" });
  await meas(k1, "2026-10-01", 0.5); await meas(k2, "2026-10-20", 12);
  check("A. jeu cree (2 depts, 5 risques, 3 KRI, 2 mesures)", [dA, dB, rA1, rA2, rB1, rD, rX, k1, k2, k3].every(Boolean));
  const audits = (id) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('a',action,'o',old_value,'n',new_value,'r',reason) order by timestamp),'[]') from audit_log where entity_id='${id}' and entity_type='Kri'`));

  // ---------------- m
  let M = await open("m");
  await M.page.screenshot({ path: `${SHOTS}/01-dashboard-m.png`, fullPage: true });
  const L = (...a) => a.map((s) => s).sort(byText);
  const eq = async (name, expected) => { const got = await M.labels(); check(name, JSON.stringify(got) === JSON.stringify(L(...expected)), `got=${got.join("|")}`); };
  await eq("1. tableau de bord : les 3 KRI", ["KRI Vert QA", "KRI Rouge QA", "KRI Sans mesure QA"]);
  const apiAll = D(await api("m", "GET", "/kris/dashboard")).map((r) => r.label).sort(byText);
  check("1. = GET /kris/dashboard", JSON.stringify(apiAll) === JSON.stringify(await M.labels()));
  await M.page.locator("#kri-f-status").selectOption("ROUGE"); await sleep(700);
  await eq("1. filtre Statut Rouge", ["KRI Rouge QA"]);
  await M.page.locator("#kri-f-status").selectOption(""); await sleep(300);
  await M.page.locator("#kri-f-dept").selectOption(dB); await sleep(700);
  await eq("1. filtre Département Beta", ["KRI Rouge QA"]);
  await M.page.locator("#kri-f-dept").selectOption(""); await sleep(300);
  await M.page.locator("#kri-f-entity").fill("Entite-1"); await sleep(900);
  await eq("1. filtre Entité Entite-1", ["KRI Vert QA", "KRI Sans mesure QA"]);
  await M.page.locator("#kri-f-entity").fill(""); await sleep(300);
  await M.page.locator("#kri-f-from").fill("2026-10-15"); await sleep(900);
  await eq("1. filtre période (dernière mesure du 2026-10-15)", ["KRI Rouge QA"]);
  await M.page.locator("#kri-f-status").selectOption("VERT"); await sleep(900);
  check("1. combinaison sans résultat : message vide", (await M.page.getByText("Aucun KRI ne correspond aux filtres.").count()) === 1);
  await M.page.locator("#kri-f-status").selectOption(""); await M.page.locator("#kri-f-from").fill(""); await sleep(900);
  await M.page.locator("#kri-f-risk").selectOption({ label: "Risque A2 QA" }); await sleep(500);
  await eq("1. filtre Risque (affichage) A2", ["KRI Sans mesure QA"]);
  await M.page.locator("#kri-f-risk").selectOption(""); await sleep(300);

  // 2. fiche K1 + rattachement
  await M.detail("KRI Vert QA");
  const body = norm(await M.page.locator("main").innerText());
  check("2. fiche K1 : formule et « Autres risques couverts : aucun »", /Formule : f/.test(body) && /Autres risques couverts : aucun/.test(body), body.slice(0, 160));
  await M.btn("Risques couverts").click(); await sleep(500);
  const modalOf = () => M.page.locator("dialog[open]"); // M change de page apres l etape 3
  const boxes = (await modalOf().locator("label.core-filter").allInnerTexts()).map(norm).sort(byText);
  check("2. cases : A2, B1 (ni A1 principal, ni D archivé plus tard n'est encore là mais D oui, ni risque autre tenant)",
    JSON.stringify(boxes) === JSON.stringify(["Risque A2 QA", "Risque B1 QA", "Risque D archive QA"]), boxes.join("|"));
  await modalOf().getByLabel("Risque A2 QA").check(); await modalOf().getByLabel("Risque B1 QA").check();
  await modalOf().getByRole("button", { name: "Enregistrer" }).click(); await sleep(1000);
  check("2. texte mis à jour après enregistrement", /Autres risques couverts : Risque A2 QA · Risque B1 QA|Autres risques couverts : Risque B1 QA · Risque A2 QA/.test(norm(await M.page.locator("main").innerText())));
  const got = D(await api("m", "GET", `/kris/${k1}`)).coveredRiskIds.sort(byText);
  check("2. API coveredRiskIds = {A2,B1}", JSON.stringify(got) === JSON.stringify([rA2, rB1].sort(byText)));
  let au = audits(k1).filter((e) => e.a === "ASSIGN");
  check("2. audit ASSIGN #1 : avant [] / après {A2,B1}", au.length === 1 && au[0].o.coveredRiskIds.length === 0 && au[0].n.coveredRiskIds.length === 2, JSON.stringify(au));
  await M.btn("Risques couverts").click(); await sleep(500);
  check("2. réouverture : A2 et B1 cochées", (await modalOf().getByLabel("Risque A2 QA").isChecked()) && (await modalOf().getByLabel("Risque B1 QA").isChecked()));
  await modalOf().getByLabel("Risque B1 QA").uncheck();
  await modalOf().getByRole("button", { name: "Enregistrer" }).click(); await sleep(1000);
  au = audits(k1).filter((e) => e.a === "ASSIGN");
  check("2. audit ASSIGN #2 : avant {A2,B1} / après {A2}", au.length === 2 && au[1].o.coveredRiskIds.length === 2 && JSON.stringify(au[1].n.coveredRiskIds) === JSON.stringify([rA2]), JSON.stringify(au[1]));
  await M.page.screenshot({ path: `${SHOTS}/02-fiche-k1.png`, fullPage: true });

  // 3. risque couvert devenu archivé
  await api("m", "POST", `/kris/${k3}/risks`, { riskIds: [rD] });
  const arch = await api("m", "POST", `/risks/${rD}/archive`, { reason: "Archive pour test QA" });
  check("3. préparation : risque D archivé (couvert par K3)", arch.status === 200, `status=${arch.status}`);
  // Session neuve : la liste des risques est chargee au montage de l'ecran (un rechargement deconnecte).
  M = await open("m");
  await M.detail("KRI Sans mesure QA");
  await M.btn("Risques couverts").click(); await sleep(500);
  await M.page.screenshot({ path: `${SHOTS}/03a-modale-k3.png`, fullPage: true });
  await M.page.locator("label.core-filter", { hasText: "Risque B1 QA" }).locator("input").check();
  await M.page.getByRole("button", { name: "Enregistrer", exact: true }).click(); await sleep(1200);
  const stillOpen = (await M.page.getByRole("heading", { name: "Risques couverts" }).count()) > 0;
  const banner = stillOpen ? norm(await M.page.locator("[class*=banner], [role=alert]").allInnerTexts().then((t) => t.join(" "))) : "";
  check("3. enregistrer un changement alors qu'un risque couvert est archivé aboutit", !stillOpen,
    stillOpen ? `DEFAUT : modale restée ouverte : ${banner.slice(0, 200)}` : "");
  // QA-F7S6-03 corrigé : plus aucun identifiant brut ; le risque archivé n'est plus listé, B1 l'est.
  const k3Text = norm(await M.page.locator("main").innerText());
  check("3. la fiche K3 n'affiche aucun identifiant brut ; B1 listé, risque archivé absent", !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(k3Text) && /Autres risques couverts : [^·]*Risque B1 QA/.test(k3Text) && !k3Text.includes("Risque D archive QA"), k3Text.slice(0, 160));
  await M.page.screenshot({ path: `${SHOTS}/03-couvert-archive.png`, fullPage: true });
  if (stillOpen) await M.page.getByRole("button", { name: "Annuler", exact: true }).click();

  // 4. désactivation K2
  await M.detail("KRI Rouge QA");
  await M.btn("Désactiver").click(); await sleep(400);
  check("4. avertissement « définitive » affiché", (await modalOf().getByText(/définitive/).count()) >= 1);
  await modalOf().getByLabel("Motif *").fill("   ");
  await modalOf().getByRole("button", { name: "Désactiver", exact: true }).click(); await sleep(800);
  check("4. motif espaces seuls refusé, KRI toujours listé", (await M.labels()).includes("KRI Rouge QA") && (await modalOf().count()) === 1 && D(await api("m", "GET", `/kris/${k2}`)).id === k2);
  await modalOf().getByLabel("Motif *").fill("Indicateur remplacé (QA)");
  await modalOf().getByRole("button", { name: "Désactiver", exact: true }).click(); await sleep(1200);
  check("4. K2 disparaît du tableau de bord, la fiche se ferme", !(await M.labels()).includes("KRI Rouge QA") && (await M.page.getByText("Formule :").count()) === 0);
  const g = await api("m", "GET", `/kris/${k2}`);
  check("4. GET /kris/K2 = 404", g.status === 404, `status=${g.status}`);
  check("4. base : deleted_at, deleted_by, deletion_reason renseignés ; ligne et mesures conservées",
    sql(`select (deleted_at is not null)::text||'|'||(deleted_by is not null)::text||'|'||deletion_reason from kris where id='${k2}'`) === "true|true|Indicateur remplacé (QA)"
    && sql(`select count(*) from kri_measures where kri_id='${k2}'`) === "1");
  const del = audits(k2).filter((e) => e.a === "DELETE");
  check("4. audit DELETE avec motif", del.length === 1 && del[0].r === "Indicateur remplacé (QA)" && del[0].n === null, JSON.stringify(del));
  const nm = await meas(k2, "2026-10-25", 1);
  check("4. mesure sur K2 désactivé refusée (4xx, pas 500)", nm.status >= 400 && nm.status < 500, `status=${nm.status}`);
  const again = await api("m", "PATCH", `/kris/${k2}/disable`, { reason: "bis" });
  check("4. seconde désactivation = 404 (pas 500)", again.status === 404, `status=${again.status}`);
  await M.page.screenshot({ path: `${SHOTS}/04-apres-desactivation.png`, fullPage: true });
  check("7. m : aucune erreur console / JS / 5xx", M.errors.length === 0 && M.bad.length === 0, [...M.errors, ...M.bad].join(" || "));

  // 5. boutons masqués
  const Lk = await open("l");
  await Lk.detail("KRI Vert QA");
  const present = async (S, names) => Promise.all(names.map(async (n) => (await S.page.getByRole("button", { name: n, exact: true }).count()) > 0));
  const ALL = ["Nouveau KRI", "Modifier", "Risques couverts", "Désactiver", "Saisir une mesure"];
  check("5. l (kri.read) : aucun bouton d'action", (await present(Lk, ALL)).every((x) => !x), JSON.stringify(await present(Lk, ALL)));
  check("5. l voit pourtant la fiche et les risques couverts en texte", (await Lk.page.getByText(/Autres risques couverts/).count()) === 1);
  await Lk.page.screenshot({ path: `${SHOTS}/05-lecteur.png`, fullPage: true });
  const U = await open("u");
  await U.detail("KRI Vert QA");
  const pu = await present(U, ALL);
  check("5. u (kri.update) : Modifier + Risques couverts, ni Désactiver ni Nouveau KRI ni Saisir une mesure", JSON.stringify(pu) === JSON.stringify([false, true, true, false, false]), JSON.stringify(pu));
  const ud = await api("u", "PATCH", `/kris/${k1}/disable`, { reason: "essai" });
  const ua = await api("u", "PUT", `/kris/${k1}`, { active: false });
  check("5. u : disable = 403", ud.status === 403, `disable=${ud.status}`);
  check("5. PUT {active:false} refusé en 4xx (et non accepté en silence)", ua.status >= 400 && ua.status < 500, `put=${ua.status} (schéma strict : clé active refusée)`);
  check("5. K1 toujours actif après PUT {active:false}", D(await api("m", "GET", `/kris/${k1}`)).active === true);
  check("7. l et u : aucune erreur console / JS / 5xx", [...Lk.errors, ...Lk.bad, ...U.errors, ...U.bad].length === 0, [...Lk.errors, ...U.errors].join(" || "));

  // 6. autre tenant
  const xd = await api("x", "PATCH", `/kris/${k1}/disable`, { reason: "essai x" });
  const xr = await api("m", "POST", `/kris/${k1}/risks`, { riskIds: [rX] });
  const xl = D(await api("x", "GET", "/kris/dashboard"));
  check("6. x : disable K1 = 404 ; rattacher un risque d'un autre tenant = 400 ; dashboard de x vide", xd.status === 404 && xr.status === 400 && xl.length === 0, `disable=${xd.status}; cover=${xr.status}; lignes=${xl.length}`);
} catch (e) {
  check("exécution sans exception", false, String(e?.stack ?? e).split("\n").slice(0, 4).join(" / "));
} finally {
  await browser.close();
}
console.log(`\nECHECS: ${failures()}`);
process.exit(failures() ? 1 : 0);
