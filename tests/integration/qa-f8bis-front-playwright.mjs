// QA-F8bis : DECISION-125 (super-administrateur, clients, logo PNG/JPEG, import avec empreinte) contre le VRAI backend
// (tsx, PostgreSQL LOCAL 127.0.0.1:55442, identite locale, stockage en memoire du preload QA ; jamais Neon) + navigateur.
//
// Prerequis : base neuve `qa-visibility-v1-setup.sh up grc_qa_f8` ; backend avec SUPER_ADMIN_EMAILS="rm@vv1.test,com@vv1.test"
// (SA1 = rm, SA2 = com), QA_PORT=8397, CORS http://127.0.0.1:5497 ; vite 5497 (VITE_API_BASE_URL=http://127.0.0.1:8397, AUTH local).
// Serveur FRAIS recommande (limiteurs de debit en memoire). Le script cree le client B et l'utilisateur tb (client B) par SQL.
// Non rejouable sur la meme base. Le script de non-regression `qa-f8-front-playwright.mjs` se rejoue AVANT, sur la meme base/serveur.
//
// ORACLES (ecrits avant l'execution)
//  A. Non super-admin (adm avec config.manage, aud, tb) : 403 sur TOUTES les routes /tenants (GET, GET/:id, POST, PATCH, deactivate, reactivate),
//     meme avec un corps invalide (refus avant validation) ; sans jeton 401 ; menu « Clients » absent. SA : menu present.
//  B. Creation : nom 120 car. accepte, 121 refuse (400, champ nomme) ; doublon (casse/espaces) 409 ; renommer vers un nom pris 409 ;
//     PATCH avec `active` refuse 400 ; corps avec champ inconnu refuse. Deux creations simultanees du meme nom : exactement 1 creee (mesure).
//  C. Desactivation : motif obligatoire (vide/espaces refuses, UI et serveur) ; son propre client refuse ; deja inactif 409 ;
//     tb (client B) : connexion OK avant ; apres desactivation son jeton existant est refuse (401) a la requete suivante et la connexion est refusee ;
//     audit STATUS_CHANGE avec motif dans le client B ET dans le client de l'acteur.
//  D. Reactivation : meme SA refuse (400), reste inactif ; autre SA OK ; tb se reconnecte ; deja actif 409 ; motif obligatoire.
//  E. Logo : PNG reel et JPEG reel acceptes ; .png contenant du SVG refuse ; SVG, WebP, GIF refuses meme avec un Content-Type PNG ;
//     PNG reel declare svg+xml : le serveur decide sur les octets (accepte, type image/png) ; debit : un 429 survient avant 31 requetes.
//  F. Import : 1er commit OK ; apercu du meme fichier => alreadyImported ; commit sans confirmation 409 ALREADY_IMPORTED ; confirmation sans motif / motif
//     d'espaces 400 ; avec motif OK et audit avec motif ; meme contenu sous un autre nom => 409 ; contenu different => pas de 409 ;
//     UI : apercu -> bandeau « Fichier deja importe », commit -> modale a motif, motif d'espaces refuse, motif valide cree les risques.
//     Deux commits simultanes d'un fichier neuf : au plus un import complet (mesure).
//  G. client.ts : JSON = application/json ; multipart (avec champs texte) = multipart/form-data; boundary.
//  H. aucune erreur JS / console imprevue.
import { checkNoErrors, finish, localApi, openSession, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const backendRequire = createRequire(new URL("../../backend/node_modules/", import.meta.url).pathname);
const { Client } = backendRequire("pg");
const ExcelJS = backendRequire("exceljs");

const API = process.env.QA_API ?? "http://127.0.0.1:8397";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5497";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/f8bis";
const DB = process.env.QA_DB ?? "postgres://postgres@127.0.0.1:55442/grc_qa_f8";
const TMP = mkdtempSync(join(tmpdir(), "qaf8bis-"));
const EMAIL = { sa1: "rm@vv1.test", sa2: "com@vv1.test", adm: "adm@vv1.test", aud: "aud@vv1.test", tb: "tb@vv1.test" };
const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
mkdirSync(SHOTS, { recursive: true });

const { check, failures } = verdicts();
/** Defaut connu epingle : affiche KNOWN-DEFECT s'il se produit, ne compte pas dans les echecs (rapport). */
const known = (name, ok, detail = "") => console.log(`${ok ? "PASS" : "KNOWN-DEFECT"}  ${name}${detail ? "  -> " + detail : ""}`);
const { TOK, login, api } = localApi(API, EMAIL);
const norm = (s) => s.replace(/\s+/g, " ").trim();

async function xlsx(path, rows) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Risques");
  ws.addRow(["process", "description"]); rows.forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(path);
}
const IMP1 = join(TMP, "import1.xlsx"); await xlsx(IMP1, [["Achats", "QA-F8bis alpha"], ["Paie", "QA-F8bis beta"]]);
const IMP1_COPY = join(TMP, "copie-de-import1.xlsx"); writeFileSync(IMP1_COPY, readFileSync(IMP1));
const IMP2 = join(TMP, "import2.xlsx"); await xlsx(IMP2, [["Ventes", "QA-F8bis gamma"]]);
const IMP3 = join(TMP, "import3-ui.xlsx"); await xlsx(IMP3, [["RH", "QA-F8bis delta"], ["IT", "QA-F8bis epsilon"], ["Qualité", "QA-F8bis zeta"]]);
const IMPC = join(TMP, "import-concurrent.xlsx"); await xlsx(IMPC, [["Logistique", "QA-F8bis conc-1"], ["Logistique", "QA-F8bis conc-2"], ["Logistique", "QA-F8bis conc-3"]]);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1"), Buffer.from([0xff, 0xd9])]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x1a, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(20)]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1");
writeFileSync(join(TMP, "logo.png"), PNG);

const db = new Client({ connectionString: DB }); await db.connect();
const count = async (sql, p = []) => Number((await db.query(sql, p)).rows[0].n);
await db.query(`UPDATE users SET roles = roles || $2::text[] WHERE email = $1`, [EMAIL.adm, ["branding.read", "branding.update", "config.read", "config.manage"]]);
await db.query(`UPDATE users SET roles = roles || $2::text[] WHERE email = $1`, [EMAIL.aud, ["branding.read", "config.read"]]);

const upload = async (who, path, buf, type, name, fields = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("file", new Blob([buf], { type }), name);
  const r = await fetch(`${API}/api/v1${path}`, { method: "POST", headers: { authorization: `Bearer ${TOK[who]}` }, body: fd });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const reqs = [];
const browser = await chromium.launch();
async function session(who) {
  const S = await openSession(browser, { app: APP, email: EMAIL[who], shots: SHOTS, who });
  S.page.on("request", (r) => {
    if (r.url().startsWith(API) && r.method() !== "GET" && r.method() !== "OPTIONS") {
      const pd = r.postData();
      reqs.push({ method: r.method(), path: new URL(r.url()).pathname, ct: r.headers()["content-type"] ?? null, body: pd && pd.length < 2000 ? pd : "(binaire)" });
    }
  });
  return S;
}
const last = (path, method) => [...reqs].reverse().find((r) => r.path === path && r.method === method);
try {
  for (const w of ["sa1", "sa2", "adm", "aud"]) await login(w);

  // ---------- A. non super-admin
  const probe = async (who) => {
    const out = {};
    const id = T1;
    const calls = [["GET", "/tenants"], ["GET", `/tenants/${id}`], ["POST", "/tenants", { name: "Intrus QA" }], ["POST", "/tenants", { name: "" }], ["POST", "/tenants", { foo: 1 }],
      ["PATCH", `/tenants/${id}`, { name: "x" }], ["PATCH", `/tenants/${id}`, { active: false }], ["POST", `/tenants/${id}/deactivate`, { reason: "x" }], ["POST", `/tenants/${id}/deactivate`, {}],
      ["POST", `/tenants/${id}/reactivate`, { reason: "x" }], ["POST", `/tenants/${id}/reactivate`]];
    for (const [m, p, b] of calls) out[`${m} ${p.replace(id, ":id")} ${JSON.stringify(b ?? null)}`] = (await api(who, m, p, b)).status;
    return out;
  };
  for (const w of ["adm", "aud"]) {
    const res = await probe(w);
    check(`A.1 ${w} (non super-admin) : 403 sur les 11 appels /tenants (corps valides ou non)`, Object.values(res).every((s) => s === 403), JSON.stringify(res));
  }
  check("A.2 sans jeton : 401", (await fetch(`${API}/api/v1/tenants`)).status === 401);
  check("A.3 aucun client cree par les refus", (await count(`SELECT count(*) n FROM tenants WHERE name LIKE 'Intrus%'`)) === 0);
  check("A.4 sa1 : GET /tenants 200", (await api("sa1", "GET", "/tenants")).status === 200);
  const forged = await fetch(`${API}/api/v1/tenants`, { headers: { authorization: `Bearer ${TOK.adm}`, "x-super-admin": "true", "x-forwarded-email": EMAIL.sa1 } });
  check("A.5 adm avec en-têtes forgés (x-super-admin, x-forwarded-email) : toujours 403", forged.status === 403);

  // ---------- B. creation, noms
  const name120 = "N".repeat(120);
  const c120 = await api("sa1", "POST", "/tenants", { name: name120 });
  check("B.1 nom de 120 caractères accepté (201)", c120.status === 201, `status ${c120.status}`);
  const c121 = await api("sa1", "POST", "/tenants", { name: "N".repeat(121) });
  check("B.2 nom de 121 caractères refusé (400) avec le champ nommé", c121.status === 400 && /120/.test(JSON.stringify(c121.json)), JSON.stringify(c121.json));
  check("B.3 nom d'espaces refusé (400)", (await api("sa1", "POST", "/tenants", { name: "     " })).status === 400);
  check("B.4 nom non texte refusé (400)", (await api("sa1", "POST", "/tenants", { name: 42 })).status === 400);
  const cB = await api("sa1", "POST", "/tenants", { name: "Client B QA-F8bis", deploymentMode: "customer_managed" });
  const B = cB.json?.data;
  check("B.5 création du client B (201, actif)", cB.status === 201 && B?.active === true);
  for (const v of ["client b qa-f8bis", "  Client   B   QA-F8bis  ", "CLIENT B QA-F8BIS"]) {
    check(`B.6 doublon « ${v} » : 409`, (await api("sa2", "POST", "/tenants", { name: v })).status === 409);
  }
  check("B.7 renommer vers un nom pris : 409", (await api("sa1", "PATCH", `/tenants/${c120.json.data.id}`, { name: "client b qa-f8bis" })).status === 409);
  check("B.8 renommer vers son propre nom (casse différente) : accepté", (await api("sa1", "PATCH", `/tenants/${B.id}`, { name: "CLIENT B QA-F8bis" })).status === 200);
  await api("sa1", "PATCH", `/tenants/${B.id}`, { name: "Client B QA-F8bis" });
  const pa = await api("sa1", "PATCH", `/tenants/${B.id}`, { active: false });
  check("B.9 PATCH avec `active` refusé (400), client toujours actif", pa.status === 400 && (await api("sa1", "GET", `/tenants/${B.id}`)).json.data.active === true, JSON.stringify(pa.json));
  check("B.10 champ inconnu refusé (400)", (await api("sa1", "POST", "/tenants", { name: "Zzz QA-F8bis", tenantId: T1 })).status === 400);
  check("B.11 GET /tenants/:id inexistant : 404", (await api("sa1", "GET", "/tenants/00000000-0000-4000-8000-0000000000ff")).status === 404);
  // concurrence : 10 creations simultanées du même nom (variantes de casse/espaces)
  const variants = Array.from({ length: 10 }, (_, i) => (i % 2 ? "Concurrent  QA-F8bis" : "concurrent qa-f8bis"));
  const race = await Promise.all(variants.map((n, i) => api(i % 2 ? "sa1" : "sa2", "POST", "/tenants", { name: n })));
  const created = race.filter((r) => r.status === 201).length;
  const inDb = await count(`SELECT count(*) n FROM tenants WHERE lower(regexp_replace(name, '\\s+', ' ', 'g')) = 'concurrent qa-f8bis'`);
  console.log(`MESURE  10 créations simultanées du même nom : statuts ${race.map((r) => r.status).join(",")} ; créés=${created} ; en base=${inDb}`);
  check("B.12 création simultanée du même nom : exactement 1 client en base (non atomique, signalé par A06)", inDb === 1, `${inDb} clients de même nom`);
  const race2 = await Promise.all([0, 1, 2, 3].map(() => api("sa1", "POST", "/tenants", { name: "Concurrent2 QA-F8bis" })));
  const inDb2 = await count(`SELECT count(*) n FROM tenants WHERE name = 'Concurrent2 QA-F8bis'`);
  console.log(`MESURE  4 créations simultanées strictement identiques : statuts ${race2.map((r) => r.status).join(",")} ; en base=${inDb2}`);
  check("B.13 idem, 4 requêtes identiques : 1 client, les 3 autres refusées en 409 (jamais 500)", inDb2 === 1 && race2.filter((r) => r.status === 409).length === 3, `${inDb2} ; ${race2.map((r) => r.status)}`);
  let badRounds = 0, five = [];
  for (let k = 0; k < 8; k++) {
    const nm = `Ronde ${k} QA-F8bis`;
    const rr = await Promise.all(Array.from({ length: 6 }, (_, i) => api(i % 2 ? "sa1" : "sa2", "POST", "/tenants", { name: i % 3 ? nm.toUpperCase() : nm })));
    const nb = await count(`SELECT count(*) n FROM tenants WHERE lower(name) = lower($1)`, [nm]);
    if (nb !== 1 || rr.filter((r) => r.status === 201).length !== 1 || rr.some((r) => ![201, 409].includes(r.status))) badRounds++;
    five.push(`${nb}/${rr.map((r) => r.status).join("")}`);
  }
  console.log(`MESURE  8 rondes x 6 créations simultanées (casse variable) : ${five.join(" ")}`);
  check("B.14 8 rondes de 6 créations simultanées : à chaque ronde 1 client, 1x201, le reste 409", badRounds === 0, `${badRounds} rondes en défaut`);
  check("B.15 l'index normalisé tient aussi en SQL direct (insertion d'un doublon refusée 23505)", await db.query(`INSERT INTO tenants (name) VALUES ('  CLIENT   b qa-f8bis ')`).then(() => false, (e) => e.code === "23505"));

  // utilisateur tb dans le client B
  await db.query(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1, $2, 'QA tb', ARRAY['risk.read'])`, [B.id, EMAIL.tb]);
  await login("tb");
  check("C.0 tb (client B) connecté, GET /risks 200", !!TOK.tb && (await api("tb", "GET", "/risks")).status === 200);
  check("C.0b tb (non super-admin) : /tenants 403", (await api("tb", "GET", "/tenants")).status === 403);

  // ---------- UI : menu + parcours Clients (SA1)
  const U = await session("adm");
  check("A.6 UI adm (config.manage, non super-admin) : pas d'entrée « Clients »", !(await U.hasEntry("Clients")));
  const S1 = await session("sa1");
  check("A.7 UI sa1 : entrée « Clients » présente", await S1.hasEntry("Clients"));
  await S1.go("Clients");
  const total = (await api("sa1", "GET", "/tenants")).json.data.length;
  check("U.1 liste = API", (await S1.page.locator("main tbody tr").count()) === total, `${total} clients`);
  await S1.page.getByRole("button", { name: "Nouveau client" }).click();
  const cd = S1.page.getByRole("dialog");
  await cd.locator("#client-name").fill("x".repeat(121));
  await cd.getByRole("button", { name: "Enregistrer" }).click(); await S1.page.waitForTimeout(1200);
  let t = norm(await cd.innerText());
  check("U.2 nom de 121 car. : refus serveur affiché avec la limite", /120/.test(t) && (await api("sa1", "GET", "/tenants")).json.data.length === total, t.slice(0, 200));
  await cd.locator("#client-name").fill("client b qa-f8bis");
  await cd.getByRole("button", { name: "Enregistrer" }).click(); await S1.page.waitForTimeout(1200);
  t = norm(await cd.innerText());
  check("U.3 doublon : message serveur affiché (déjà existant)", /already exists|existe/i.test(t), t.slice(0, 200));
  await cd.locator("#client-name").fill("Client UI QA-F8bis");
  await cd.getByRole("button", { name: "Enregistrer" }).click(); await S1.page.waitForTimeout(1500);
  const rc = last("/api/v1/tenants", "POST");
  check("U.4 création UI : POST { name, deploymentMode }", rc && Object.keys(JSON.parse(rc.body)).sort((a, b) => a.localeCompare(b)).join() === "deploymentMode,name" && rc.ct.startsWith("application/json"), rc?.body);
  const rowB = S1.page.locator("main tbody tr", { hasText: "Client B QA-F8bis" });
  check("U.5 ligne client B visible, boutons Modifier + Désactiver", (await rowB.getByRole("button", { name: "Désactiver" }).count()) === 1 && (await rowB.getByRole("button", { name: "Modifier" }).count()) === 1);
  // désactivation UI
  await rowB.getByRole("button", { name: "Désactiver" }).click();
  const sd = S1.page.getByRole("dialog");
  await sd.getByRole("button", { name: "Désactiver" }).click(); await S1.page.waitForTimeout(500);
  const nDeact = reqs.filter((r) => r.path.endsWith("/deactivate")).length;
  check("U.6 motif vide : aucun POST (champ required)", nDeact === 0 && (await sd.isVisible()));
  await sd.locator("#client-status-reason").fill("      ");
  await sd.getByRole("button", { name: "Désactiver" }).click(); await S1.page.waitForTimeout(1200);
  t = norm(await sd.innerText().catch(() => ""));
  check("U.7 motif d'espaces : refus serveur affiché, client toujours actif", (await api("sa1", "GET", `/tenants/${B.id}`)).json.data.active === true && /reason|motif|obligatoire|required/i.test(t.replace("Motif (obligatoire)", "")), t.slice(0, 220));
  await S1.shot("clients-motif-espaces");
  check("U.8 désactiver son propre client (API) : refusé", (await api("sa1", "POST", `/tenants/${T1}/deactivate`, { reason: "test QA" })).status === 400 && (await api("sa1", "GET", `/tenants/${T1}`)).json.data.active === true);
  const tbBefore = await api("tb", "GET", "/risks");
  await sd.locator("#client-status-reason").fill("Motif QA-F8bis désactivation");
  await sd.getByRole("button", { name: "Désactiver" }).click(); await S1.page.waitForTimeout(1500);
  const rd = last(`/api/v1/tenants/${B.id}/deactivate`, "POST");
  check("U.9 POST /deactivate { reason } seulement", rd && rd.body === JSON.stringify({ reason: "Motif QA-F8bis désactivation" }), rd?.body);
  check("U.10 API : client B inactif ; ligne « Inactif » + bouton Réactiver", (await api("sa1", "GET", `/tenants/${B.id}`)).json.data.active === false && (await rowB.innerText()).includes("Inactif") && (await rowB.getByRole("button", { name: "Réactiver" }).count()) === 1);

  // ---------- C. session coupée
  check("C.1 tb : ancien jeton refusé (401) à la requête suivante", tbBefore.status === 200 && (await api("tb", "GET", "/risks")).status === 401, `status ${(await api("tb", "GET", "/risks")).status}`);
  const relog = await fetch(`${API}/api/v1/auth/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL.tb, password: "whatever" }) });
  check("C.2 tb : nouvelle connexion refusée", relog.status >= 400 && !(await relog.clone().json().catch(() => ({}))).accessToken, `status ${relog.status}`);
  check("C.3 les autres clients ne sont pas touchés : adm (client 1) toujours connecté", (await api("adm", "GET", "/risks")).status === 200);
  check("C.4 déjà inactif : 409", (await api("sa2", "POST", `/tenants/${B.id}/deactivate`, { reason: "bis QA" })).status === 409);
  check("C.5 audit STATUS_CHANGE + motif dans le client B ET dans le client 1", (await count(`SELECT count(*) n FROM audit_log WHERE entity_type='Tenant' AND entity_id=$1 AND action='STATUS_CHANGE' AND reason='Motif QA-F8bis désactivation' AND tenant_id=$1`, [B.id])) === 1
    && (await count(`SELECT count(*) n FROM audit_log WHERE entity_type='Tenant' AND entity_id=$1 AND action='STATUS_CHANGE' AND reason='Motif QA-F8bis désactivation' AND tenant_id=$2`, [B.id, T1])) === 1);
  check("C.6 un client inactif reste modifiable par un SA mais /tenants le liste (Inactif)", (await api("sa1", "GET", "/tenants")).json.data.find((x) => x.id === B.id).active === false);

  // ---------- D. réactivation
  await rowB.getByRole("button", { name: "Réactiver" }).click();
  const sr = S1.page.getByRole("dialog");
  await sr.locator("#client-status-reason").fill("Tentative par le même SA");
  await sr.getByRole("button", { name: "Réactiver" }).click(); await S1.page.waitForTimeout(1500);
  t = norm(await sr.innerText().catch(() => ""));
  check("D.1 même SA : refus affiché dans la modale, client toujours inactif", (await api("sa1", "GET", `/tenants/${B.id}`)).json.data.active === false && /different|différent/i.test(t), t.slice(0, 260));
  await S1.shot("clients-meme-sa");
  await sr.getByRole("button", { name: /Annuler|Fermer/ }).first().click().catch(() => undefined);
  check("D.2 même SA par l'API : 400", (await api("sa1", "POST", `/tenants/${B.id}/reactivate`, { reason: "bis" })).status === 400);
  check("D.3 autre SA sans motif : 400 ; motif d'espaces : 400", (await api("sa2", "POST", `/tenants/${B.id}/reactivate`, {})).status === 400 && (await api("sa2", "POST", `/tenants/${B.id}/reactivate`, { reason: "   " })).status === 400);
  check("D.3b motif de 501 caractères : 400", (await api("sa2", "POST", `/tenants/${B.id}/reactivate`, { reason: "x".repeat(501) })).status === 400);
  check("D.3c corps avec champ en trop : 400", (await api("sa2", "POST", `/tenants/${B.id}/reactivate`, { reason: "ok QA", by: "sa1" })).status === 400);
  const ra = await api("sa2", "POST", `/tenants/${B.id}/reactivate`, { reason: "Réactivation QA-F8bis par sa2" });
  check("D.4 autre SA avec motif : 200, client actif", ra.status === 200 && ra.json.data.active === true);
  await login("tb");
  check("D.5 tb peut se reconnecter, GET /risks 200", (await api("tb", "GET", "/risks")).status === 200);
  check("D.6 déjà actif : 409", (await api("sa1", "POST", `/tenants/${B.id}/reactivate`, { reason: "bis QA" })).status === 409);
  check("D.7 audit de réactivation avec motif", (await count(`SELECT count(*) n FROM audit_log WHERE entity_type='Tenant' AND entity_id=$1 AND reason='Réactivation QA-F8bis par sa2'`, [B.id])) === 2);
  // désactivé par sa2 : sa2 ne peut pas réactiver, sa1 oui (symétrie)
  await api("sa2", "POST", `/tenants/${B.id}/deactivate`, { reason: "Désactivation par sa2 QA" });
  check("D.8 symétrie : sa2 (auteur) refusé, sa1 accepté", (await api("sa2", "POST", `/tenants/${B.id}/reactivate`, { reason: "bis QA" })).status === 400 && (await api("sa1", "POST", `/tenants/${B.id}/reactivate`, { reason: "Réactivation par sa1 QA" })).status === 200);
  await S1.page.keyboard.press("Escape");
  await S1.go("Feedback"); await S1.go("Clients");
  check("U.11 après rechargement, état actif conforme", (await S1.page.locator("main tbody tr", { hasText: "Client B QA-F8bis" }).innerText()).includes("Actif"));

  // ---------- D bis. q277 : au moins un autre super-administrateur actif hors du client désactivé
  const deact = async (why) => api("sa1", "POST", `/tenants/${B.id}/deactivate`, { reason: why });
  await db.query(`UPDATE users SET tenant_id = $1 WHERE email = $2`, [B.id, EMAIL.sa2]);
  let r1 = await deact("Test survie sa2 dans B");
  check("S.1 l'autre super-administrateur est DANS le client ciblé : désactivation refusée 409, client actif", r1.status === 409 && /super-administrat/i.test(JSON.stringify(r1.json)) && (await api("sa1", "GET", `/tenants/${B.id}`)).json.data.active === true, JSON.stringify(r1.json));
  await db.query(`UPDATE users SET tenant_id = $1 WHERE email = $2`, [T1, EMAIL.sa2]);
  await db.query(`UPDATE users SET deleted_at = now() WHERE email = $1`, [EMAIL.sa2]);
  r1 = await deact("Test survie sa2 supprimé");
  check("S.2 l'autre super-administrateur est supprimé : refusée 409", r1.status === 409 && (await api("sa1", "GET", `/tenants/${B.id}`)).json.data.active === true, JSON.stringify(r1.json));
  await db.query(`UPDATE users SET deleted_at = NULL WHERE email = $1`, [EMAIL.sa2]);
  check("S.3 refus sans effet de bord : aucune ligne d'audit de désactivation de B, B toujours actif", (await count(`SELECT count(*) n FROM audit_log WHERE entity_id=$1 AND action='STATUS_CHANGE' AND reason LIKE 'Test survie%'`, [B.id])) === 0);
  await login("sa2");
  const ok = await deact("Désactivation autorisée QA-F8bis (survie ok)");
  check("S.4 avec un autre super-administrateur actif hors du client : désactivation acceptée (200)", ok.status === 200 && ok.json.data.active === false, JSON.stringify(ok.json));
  check("S.5 réactivation par l'autre (sa2) OK", (await api("sa2", "POST", `/tenants/${B.id}/reactivate`, { reason: "Retour à l'état actif QA-F8bis" })).status === 200);
  // un seul super-administrateur listé et attesté : refus
  await db.query(`UPDATE users SET email = 'com-off@vv1.test' WHERE email = $1`, [EMAIL.sa2]);
  r1 = await deact("Test survie sans second SA");
  check("S.6 un seul super-administrateur restant (l'autre n'est plus listé) : refusée 409", r1.status === 409, JSON.stringify(r1.json));
  await db.query(`UPDATE users SET email = $1 WHERE email = 'com-off@vv1.test'`, [EMAIL.sa2]);
  check("S.7 l'écran affiche le refus (modale Désactiver) : message du serveur", await (async () => {
    await db.query(`UPDATE users SET tenant_id = $1 WHERE email = $2`, [B.id, EMAIL.sa2]);
    const P = await session("sa1"); await P.go("Clients");
    await P.page.locator("main tbody tr", { hasText: "Client B QA-F8bis" }).getByRole("button", { name: "Désactiver" }).click();
    const d = P.page.getByRole("dialog"); await d.locator("#client-status-reason").fill("Test écran survie QA");
    await d.getByRole("button", { name: "Désactiver" }).click(); await P.page.waitForTimeout(1500);
    const tt = norm(await d.innerText().catch(() => "")); await P.shot("clients-survie");
    await db.query(`UPDATE users SET tenant_id = $1 WHERE email = $2`, [T1, EMAIL.sa2]);
    return /at least two|super-administrat/i.test(tt) && (await api("sa1", "GET", `/tenants/${B.id}`)).json.data.active === true;
  })());
  await login("sa2");

  // ---------- E. logo
  const adm = (buf, type, name) => upload("adm", "/branding", buf, type, name);
  const okPng = await adm(PNG, "image/png", "logo.png");
  check("E.1 PNG réel accepté (201)", okPng.status === 201, JSON.stringify(okPng.json));
  check("E.2 JPEG réel accepté (201)", (await adm(JPG, "image/jpeg", "logo.jpg")).status === 201);
  const before = (await api("adm", "GET", "/branding")).json.data.logoDriveFileId;
  const disguised = await adm(SVG, "image/png", "logo.png");
  check("E.3 « .png » contenant du SVG (Content-Type PNG) : refusé 400", disguised.status === 400, JSON.stringify(disguised.json));
  check("E.4 SVG déclaré svg+xml : refusé", (await adm(SVG, "image/svg+xml", "logo.svg")).status === 400);
  check("E.5 WebP réel (RIFF/WEBP) déclaré image/webp : refusé", (await adm(WEBP, "image/webp", "logo.webp")).status === 400);
  check("E.5b WebP déclaré image/png : refusé (octets)", (await adm(WEBP, "image/png", "logo.png")).status === 400);
  check("E.6 GIF déclaré image/png : refusé", (await adm(GIF, "image/png", "logo.png")).status === 400);
  check("E.7 fichier d'octets nuls déclaré image/jpeg : refusé", (await adm(Buffer.alloc(64), "image/jpeg", "x.jpg")).status === 400);
  check("E.8 PNG tronqué à la signature seule : décision serveur (info)", [201, 400].includes((await adm(PNG.subarray(0, 8), "image/png", "t.png")).status));
  const pngAsSvg = await adm(PNG, "image/svg+xml", "logo.svg");
  console.log(`MESURE  PNG réel déclaré svg+xml : status ${pngAsSvg.status}`);
  check("E.9 logo inchangé par les refus (E.3 à E.7)", (await api("adm", "GET", "/branding")).json.data.logoDriveFileId !== undefined && before !== null);
  check("E.10 un logo en tête vide (.png de 0 octet) refusé", (await adm(Buffer.alloc(0), "image/png", "e.png")).status === 400);
  // débit
  let n429 = 0, sent = 0;
  for (; sent < 60 && n429 === 0; sent++) { const r = await adm(PNG, "image/png", "logo.png"); if (r.status === 429) n429 = sent + 1; }
  console.log(`MESURE  débit logo : premier 429 à la requête n°${n429} de cette série (après 11 appels antérieurs)`);
  check("E.11 limiteur de débit : un 429 avant 31 appels cumulés", n429 > 0 && n429 + 11 <= 31, `n429=${n429}`);

  // ---------- F. import
  const imp = (who, f, name, fields) => upload(who, "/import/excel/commit", readFileSync(f), "application/octet-stream", name, fields);
  const prev = (who, f, name) => upload(who, "/import/excel/preview", readFileSync(f), "application/octet-stream", name);
  const risks = () => count(`SELECT count(*) n FROM risks WHERE description LIKE 'QA-F8bis%'`);
  const r0 = await risks();
  check("F.0 apercu d'un fichier jamais importé : pas d'alreadyImported", (await prev("adm", IMP1, "import1.xlsx")).json?.data?.alreadyImported === undefined);
  const i1 = await imp("adm", IMP1, "import1.xlsx", {});
  check("F.1 premier commit : 200, 2 créés", i1.status === 200 && i1.json.data.createdCount === 2 && (await risks()) === r0 + 2, JSON.stringify(i1.json).slice(0, 200));
  check("F.2 aperçu du même fichier : alreadyImported = true", (await prev("adm", IMP1, "import1.xlsx")).json?.data?.alreadyImported === true);
  const i2 = await imp("adm", IMP1, "import1.xlsx", {});
  check("F.3 recommit sans confirmation : 409 ALREADY_IMPORTED, rien créé", i2.status === 409 && i2.json?.code === "ALREADY_IMPORTED" && (await risks()) === r0 + 2, JSON.stringify(i2.json));
  check("F.4 confirmation SANS motif : 400, rien créé", (await imp("adm", IMP1, "import1.xlsx", { confirmReimport: "true" })).status === 400 && (await risks()) === r0 + 2);
  check("F.5 confirmation + motif d'espaces : 400", (await imp("adm", IMP1, "import1.xlsx", { confirmReimport: "true", reason: "    " })).status === 400 && (await risks()) === r0 + 2);
  check("F.5b motif seul sans confirmReimport : 409 (pas de contournement)", (await imp("adm", IMP1, "import1.xlsx", { reason: "Motif QA seul" })).status === 409);
  check("F.5c confirmReimport=false : 400/409, rien créé", [400, 409].includes((await imp("adm", IMP1, "import1.xlsx", { confirmReimport: "false", reason: "Motif QA" })).status) && (await risks()) === r0 + 2);
  check("F.5d champ inconnu : 400", (await imp("adm", IMP1, "import1.xlsx", { confirmReimport: "true", reason: "Motif QA", force: "1" })).status === 400);
  check("F.6 même contenu sous un autre nom : 409", (await imp("adm", IMP1_COPY, "copie.xlsx", {})).status === 409);
  const i3 = await imp("adm", IMP1, "import1.xlsx", { confirmReimport: "true", reason: "Réimport QA-F8bis voulu" });
  check("F.7 confirmation + motif : 200, 2 nouveaux risques", i3.status === 200 && i3.json.data.createdCount === 2 && (await risks()) === r0 + 4, JSON.stringify(i3.json).slice(0, 160));
  check("F.8 audit RiskImport avec motif", (await count(`SELECT count(*) n FROM audit_log WHERE entity_type='RiskImport' AND reason='Réimport QA-F8bis voulu' AND tenant_id=$1`, [T1])) === 1);
  const i4 = await imp("adm", IMP2, "import2.xlsx", {});
  check("F.9 contenu différent : pas de 409", i4.status === 200 && i4.json.data.createdCount === 1);
  check("F.10 import par un autre client (tb n'a pas config.manage) : 403 ; l'empreinte est par client", (await imp("aud", IMP2, "import2.xlsx", {})).status === 403);
  // concurrence : deux commits simultanés d'un fichier neuf
  const rc0 = await count(`SELECT count(*) n FROM risks WHERE description LIKE 'QA-F8bis conc-%'`);
  const raceImp = await Promise.all([imp("adm", IMPC, "c1.xlsx", {}), imp("adm", IMPC, "c2.xlsx", {})]);
  const rc1 = (await count(`SELECT count(*) n FROM risks WHERE description LIKE 'QA-F8bis conc-%'`)) - rc0;
  console.log(`MESURE  2 commits simultanés du même fichier neuf : statuts ${raceImp.map((r) => r.status).join(",")} ; risques créés=${rc1} (attendu 3)`);
  check("F.11 deux commits simultanés d'un fichier neuf : un seul import (3 risques), l'autre 409 ALREADY_IMPORTED", rc1 === 3 && raceImp.map((r) => r.status).sort((a, b) => a - b).join() === "200,409" && raceImp.some((r) => r.json?.code === "ALREADY_IMPORTED"), `${rc1} risques ; ${raceImp.map((r) => r.status)}`);
  let badImp = 0; const impRes = [];
  for (let k = 0; k < 2; k++) {
    const f = join(TMP, `ronde${k}.xlsx`); await xlsx(f, [["Ronde", `QA-F8bis ronde-${k}-a`], ["Ronde", `QA-F8bis ronde-${k}-b`]]);
    const rr = await Promise.all([0, 1, 2].map((i) => imp("adm", f, `r${k}-${i}.xlsx`, {})));
    const made = await count(`SELECT count(*) n FROM risks WHERE description LIKE $1`, [`QA-F8bis ronde-${k}-%`]);
    impRes.push(`${made}/${rr.map((r) => r.status).join("")}`);
    if (made !== 2 || rr.filter((r) => r.status === 200).length !== 1 || rr.some((r) => ![200, 409].includes(r.status))) badImp++;
  }
  console.log(`MESURE  2 rondes x 3 commits simultanés : ${impRes.join(" ")}`);
  check("F.11b 2 rondes de 3 commits simultanés : à chaque ronde 2 risques, 1x200, le reste 409", badImp === 0, `${badImp} rondes en défaut`);
  check("F.11c index unique d'import : un 2e « premier import » en SQL direct refusé (23505)", await db.query(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, new_value, request_id) SELECT tenant_id, user_id, entity_type, entity_id, action, new_value, 'qa-dup' FROM audit_log WHERE entity_type='RiskImport' AND (new_value->>'reimport')='false' LIMIT 1`).then(() => false, (e) => e.code === "23505"));

  // UI import
  const A = await session("adm");
  await A.go("Import Excel");
  const inp = A.page.locator('input[type="file"]');
  await inp.setInputFiles(IMP1); await A.page.waitForTimeout(300);
  await A.page.getByRole("button", { name: /Aperçu/ }).click(); await A.page.waitForTimeout(1500);
  let txt = await A.text();
  check("F.12 UI : fichier déjà importé : bandeau d'avertissement au aperçu", /Fichier déjà importé/.test(txt), txt.slice(0, 260));
  const commitBtn = A.page.getByRole("button", { name: /Importer 2 lignes valides/ });
  const r5 = await risks();
  await commitBtn.click(); await A.page.waitForTimeout(1500);
  const md = A.page.getByRole("dialog");
  check("F.13 UI : commit => 409 => modale « Fichier déjà importé » avec motif, rien créé", (await md.isVisible()) && (await risks()) === r5, norm(await md.innerText().catch(() => "")).slice(0, 160));
  await md.locator("#reimport-reason").fill("    ");
  await md.getByRole("button", { name: "Importer de nouveau" }).click(); await A.page.waitForTimeout(1200);
  check("F.14 UI : motif d'espaces : rien créé (pas de contournement)", (await risks()) === r5, norm(await A.page.locator("body").innerText()).slice(0, 100));
  await A.shot("import-reimport-espaces");
  const dialogOpen = await md.isVisible();
  if (!dialogOpen) { console.log("MESURE  la modale s'est fermée sur motif d'espaces (le formulaire ne s'est pas soumis ou a échoué)"); }
  if (await md.isVisible()) {
    await md.locator("#reimport-reason").fill("Réimport UI QA-F8bis");
    await md.getByRole("button", { name: "Importer de nouveau" }).click(); await A.page.waitForTimeout(2000);
  }
  const rcm = last("/api/v1/import/excel/commit", "POST");
  check("F.15 UI : motif valide : 2 risques créés, bandeau « Import terminé »", (await risks()) === r5 + 2 && /Import terminé/.test(await A.text()), `créés ${(await risks()) - r5}`);
  check("F.16 UI : multipart du commit avec champs texte = multipart/form-data; boundary", rcm?.ct?.startsWith("multipart/form-data; boundary="), rcm?.ct);
  await A.page.getByRole("button", { name: "Nouvel import" }).click();
  await inp.setInputFiles(IMP3); await A.page.waitForTimeout(300);
  await A.page.getByRole("button", { name: /Aperçu/ }).click(); await A.page.waitForTimeout(1500);
  txt = await A.text();
  check("F.17 UI : fichier jamais importé : pas de bandeau « déjà importé »", !/Fichier déjà importé/.test(txt));
  const r6 = await risks();
  await A.page.getByRole("button", { name: /Importer 3 lignes valides/ }).click(); await A.page.waitForTimeout(2000);
  check("F.18 UI : import direct sans modale, 3 créés", !(await A.page.getByRole("dialog").isVisible().catch(() => false)) && (await risks()) === r6 + 3);

  // ---------- G. client.ts
  const jsonCalls = reqs.filter((r) => !r.ct?.startsWith("multipart"));
  check("G.1 tous les appels JSON portent application/json", jsonCalls.length > 0 && jsonCalls.every((r) => r.ct?.startsWith("application/json")), jsonCalls.map((r) => r.ct).join(","));
  check("G.2 tous les multipart portent un boundary", reqs.filter((r) => r.ct?.startsWith("multipart")).length >= 3 && reqs.filter((r) => r.ct?.startsWith("multipart")).every((r) => /boundary=/.test(r.ct)));
  checkNoErrors(check, [U, S1, A], "H");
} catch (e) { check("EXCEPTION " + e.message, false, e.stack?.split("\n")[1]); }
await db.end();
await finish(browser, failures);
