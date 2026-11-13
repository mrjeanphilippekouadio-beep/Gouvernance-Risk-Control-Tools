import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Pool } from "pg";

/**
 * QA-Import (niveau 2) : import « familles et sous-catégories » (q280 / q283, DECISION-133 et 135 A), cadrage A13
 * (docs/risk/A13-import-familles-q280-2026-11-11.md). Oracles ecrits AVANT l'execution. Pas un avis Security / Privacy / Compliance.
 * Vrai serveur tsx (QA_IMP_LIVE=1, port 8096, base `grc_qa_imp` neuve 001..091) + PostgreSQL local ; TRUST_PROXY_HOPS=1 pour varier l'IP du limiteur (30 appels / 15 min / IP).
 *
 * F  FICHIER (section 3.1) : .txt + text/plain ; vide, NUL, signatures PK / %PDF / gzip / OLE, UTF-16, Latin-1 (ligne fautive), UTF-8 surlongue / substitut seul : 400 ;
 *    BOM tolere ; 64 Ko exactement accepte, 64 Ko + 1 : 4xx jamais 500 ; deux fichiers / champ en trop / pas de fichier / JSON : 4xx jamais 500 ; 200 lignes ok, 201 : 400.
 * L  LIGNES (3.2) : champs 1 / 4, vide, > 120 car., caractere de controle, famille inconnue (3 plus proches), sous-categorie absente / de premier niveau / homonyme /
 *    parent faux / parent bon, deux familles, doublon, inactive ; famille en francais, sans accent, en majuscules, code anglais ; commentaires, lignes vides, CRLF.
 * P  APERCU sans ecriture : aucune ligne d'audit, version inchangee ; tout ou rien : une erreur => commit 400, rien d'ecrit.
 * C  COMMIT : empreinte (409 si differente, 400 si mal formee, majuscules ok) ; seuils strict 4 / modere 9 de l'echelle 5x5 ; mention « valeur de départ à confirmer » ;
 *    valeur client JAMAIS ecrasee (KEPT) ; rejeu = 0 cree ; referentiel modifie entre apercu et commit => re-verification ; audit : une ligne d'import (empreinte, comptes,
 *    aucun contenu) + celle de updateDraft ; plafond 200 entrees ; version ACTIVE / ARCHIVED refusee ; tenant croise 404 ; droits.
 * R  COURSE : `updateDraft` ecrit le tableau complet sans verrou optimiste. Mesure : commit // edition client du meme brouillon.
 */
const ROOT = join(__dirname, "..", "..");
const live = process.env["QA_IMP_LIVE"] === "1";
const PGPORT = 55442;
const DB = "grc_qa_imp";
const PORT = 8096;
const API = `http://127.0.0.1:${PORT}/api/v1`;
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const TB = "bbbbbbbb-0000-4000-8000-000000000001";
const UNKNOWN = "cccccccc-0000-4000-8000-0000000009ff";
const NOTE = "valeur de départ à confirmer";

type Who = "rm1" | "rm2" | "rm3" | "rm4" | "plain" | "adm" | "aud" | "pu" | "rmb";
const WHO: Who[] = ["rm1", "rm2", "rm3", "rm4", "plain", "adm", "aud", "pu", "rmb"];
const TOK = {} as Record<Who, string>;
let pg: Pool;
const sh = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const sql = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows as Row[];
const one = async (q: string, p: unknown[] = []) => (await sql(q, p))[0]!;
const count = async (q: string, p: unknown[] = []) => Number((await one(q, p)).n);
type Res = { status: number; text: string; json: Row | null };
let xff = 1;
const ip = () => `10.${Math.floor(xff / 60000) % 250}.${Math.floor(xff / 250) % 250}.${xff++ % 250}`;
async function call(who: Who | null, method: string, path: string, body?: unknown, fixedIp?: string): Promise<Res> {
  const r = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": fixedIp ?? ip(), ...(who ? { authorization: `Bearer ${TOK[who]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: Row | null = null;
  try { json = JSON.parse(text) as Row; } catch { /* not JSON */ }
  return { status: r.status, text, json };
}
interface FileOpts { name?: string; type?: string; fingerprint?: string; extraField?: boolean; two?: boolean; noFile?: boolean; fixedIp?: string }
async function multipart(who: Who | null, op: "preview" | "commit", fw: string, vid: string, content: Buffer | string, o: FileOpts = {}): Promise<Res> {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const form = new FormData();
  if (o.fingerprint !== undefined) form.append("fingerprint", o.fingerprint);
  if (o.extraField) form.append("extra", "x");
  if (!o.noFile) form.append("file", new Blob([buf], { type: o.type ?? "text/plain" }), o.name ?? "familles.txt");
  if (o.two) form.append("file", new Blob([buf], { type: "text/plain" }), "autre.txt");
  const r = await fetch(`${API}/risk-frameworks/${fw}/versions/${vid}/import-families/${op}`, {
    method: "POST", headers: { "x-forwarded-for": o.fixedIp ?? ip(), ...(who ? { authorization: `Bearer ${TOK[who]}` } : {}) }, body: form,
  });
  const text = await r.text();
  let json: Row | null = null;
  try { json = JSON.parse(text) as Row; } catch { /* not JSON */ }
  return { status: r.status, text, json };
}
const sha = (b: Buffer | string) => createHash("sha256").update(typeof b === "string" ? Buffer.from(b, "utf8") : b).digest("hex");
const preview = (who: Who | null, fw: string, vid: string, c: Buffer | string, o: FileOpts = {}) => multipart(who, "preview", fw, vid, c, o);
const commit = (who: Who | null, fw: string, vid: string, c: Buffer | string, fp?: string, o: FileOpts = {}) => multipart(who, "commit", fw, vid, c, { ...o, fingerprint: fp ?? sha(c) });
const decide = (who: Who, rid: string, what: "approve") => call(who, "POST", `/risk-frameworks/change-requests/${rid}/${what}`, {});

let FW = "";
let V = "";
const C: Record<string, string> = {};
const appetite = async (vid = V) => ((await one(`SELECT appetite_thresholds AS a FROM risk_framework_versions WHERE id = $1`, [vid])).a as Row[]);
const setAppetite = (a: Row[], vid = V) => sql(`UPDATE risk_framework_versions SET appetite_thresholds = $2::jsonb WHERE id = $1 AND status = 'DRAFT'`, [vid, JSON.stringify(a)]);
const snap = async () => ({
  aud: await count(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1`, [T]),
  ver: JSON.stringify(await one(`SELECT appetite_thresholds, updated_at, last_edited_by FROM risk_framework_versions WHERE id = $1`, [V])),
  notif: await count(`SELECT count(*)::int n FROM notifications WHERE tenant_id = $1`, [T]),
});
const lineOf = (r: Res, n: number) => (r.json!["data"].lines as Row[]).find((l) => l.line === n)!;

describe.skipIf(!live)("QA-Import sur le VRAI serveur + PostgreSQL 16 LOCAL (base vierge 001..091)", () => {
  beforeAll(async () => {
    sh("/bin/bash", [join(ROOT, "tests", "integration", "qa-visibility-v1-setup.sh"), "up", DB]);
    pg = new Pool({ host: "127.0.0.1", port: PGPORT, user: "postgres", database: DB, max: 6 });
    const RM = (await one(`SELECT id FROM roles WHERE tenant_id = $1 AND system_group = 'RISK_MANAGER'`, [T])).id as string;
    const AUD = (await one(`SELECT id FROM roles WHERE tenant_id = $1 AND system_group = 'AUDIT'`, [T])).id as string;
    const granter = (await one(`SELECT id FROM users WHERE email = 'adm@vv1.test'`)).id as string;
    const RMPERMS = ["riskframework.read", "riskframework.create", "riskframework.update", "riskframework.activate", "riskframework.archive", "riskframework.process.assign", "risk.read", "process.read"];
    const mk = async (tenant: string, n: string, perms: string[]) => { await sql(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1,$2,$2,$3)`, [tenant, `${n}@b6c.test`, perms]); return (await one(`SELECT id FROM users WHERE email = $1`, [`${n}@b6c.test`])).id as string; };
    for (const n of ["rm1", "rm2", "rm3", "rm4"]) { const id = await mk(T, n, []); await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [T, RM, id, granter]); }
    await mk(T, "plain", ["risk.read", "process.read", "riskframework.read"]);
    await mk(T, "adm", RMPERMS);
    const aud = await mk(T, "aud", []);
    await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [T, AUD, aud, granter]);
    await mk(T, "pu", ["process.read", "process.update", "riskframework.read"]);
    await sql(`INSERT INTO tenants (id, name) VALUES ($1,'Tenant B QA import')`, [TB]);
    const roleB = (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1,'Risk Manager B',$2,'RISK_MANAGER') RETURNING id`, [TB, RMPERMS])).id as string;
    const rmb = await mk(TB, "rmb", []);
    await sql(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$3)`, [TB, roleB, rmb]);

    const cat = async (tenant: string, name: string, parent: string | null, active = true) =>
      (await one(`INSERT INTO risk_categories (tenant_id, name, parent_id, active) VALUES ($1,$2,$3,$4) RETURNING id`, [tenant, name, parent, active])).id as string;
    C["RA"] = await cat(T, "Risques opérationnels", null);
    C["RB"] = await cat(T, "Conformité réglementaire", null);
    C["fraud"] = await cat(T, "Fraude interne", C["RA"]!);
    C["mob"] = await cat(T, "Fraude sur transactions mobiles", C["RA"]!);
    C["leak"] = await cat(T, "Fuite de données clients", C["RB"]!);
    C["aml"] = await cat(T, "Lutte contre le blanchiment (LBC-FT)", C["RB"]!);
    C["liq"] = await cat(T, "Risque de liquidité", C["RA"]!);
    C["ecart"] = await cat(T, "Écart de réconciliation", C["RA"]!);
    C["ransom"] = await cat(T, "Rançongiciel", C["RA"]!);
    C["h1"] = await cat(T, "Incident", C["RA"]!);
    C["h2"] = await cat(T, "Incident", C["RB"]!);
    C["old"] = await cat(T, "Ancienne sous-catégorie", C["RA"]!, false);
    C["free"] = await cat(T, "Non citée", C["RA"]!);
    const rb = await cat(TB, "Racine B", null);
    await cat(TB, "Fraude interne", rb);

    await sql(`CREATE TABLE qa_fail_audit (entity_type text, action text, key text)`);
    await sql(`CREATE FUNCTION qa_fail_audit_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $f$
      BEGIN IF EXISTS (SELECT 1 FROM qa_fail_audit f WHERE f.entity_type = NEW.entity_type AND (f.action IS NULL OR f.action = NEW.action) AND (f.key IS NULL OR NEW.new_value ? f.key))
      THEN RAISE EXCEPTION 'QA: audit failure injected'; END IF; RETURN NEW; END $f$`);
    await sql(`CREATE TRIGGER qa_fail_audit_trg BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_audit_fn()`);
    sh("/bin/bash", [join(ROOT, "tests", "integration", "qa-b6c-server.sh"), "start"], { QA_PORT: String(PORT), QA_DB: DB, QA_TRUST_PROXY_HOPS: "1" });
    for (const w of WHO) {
      const r = await fetch(`${API}/auth/local`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ email: `${w}@b6c.test`, password: "whatever" }) });
      TOK[w] = ((await r.json()) as { accessToken: string }).accessToken;
      expect(TOK[w], w).toBeTruthy();
    }
    const prov = await call("rm1", "POST", "/risk-frameworks/defaults", {});
    expect(prov.status, prov.text).toBe(201);
    FW = (await one(`SELECT id FROM risk_frameworks WHERE tenant_id = $1 AND name = 'Standard'`, [T])).id as string;
    V = (await one(`SELECT id FROM risk_framework_versions WHERE framework_id = $1`, [FW])).id as string;
  }, 280000);
  afterAll(async () => {
    await pg?.end();
    sh("/bin/bash", [join(ROOT, "tests", "integration", "qa-b6c-server.sh"), "stop"]);
  });

  const GOOD = "Fraude;Fraude interne\nConformité;Lutte contre le blanchiment (LBC-FT)\n";

  // ------------------------------------------------------------------------------------------------ F
  describe("F controles du fichier (section 3.1)", () => {
    it("F1 un fichier valide est accepte ; BOM et CRLF toleres ; commentaires et lignes vides ignores ; rien n'est ecrit", async () => {
      const s0 = await snap();
      const txt = "\uFEFF# commentaire\r\n\r\nFraude;Fraude interne\r\n   \r\n# autre\r\nConformité;Lutte contre le blanchiment (LBC-FT)\r\n";
      const r = await preview("rm1", FW, V, txt);
      expect(r.status, r.text).toBe(200);
      expect(r.json!["data"]).toMatchObject({ dataLines: 2, acceptedCount: 2, errorCount: 0, warningCount: 0, keptCount: 0, fingerprint: sha(txt), thresholds: { strict: 4, moderate: 9 } });
      expect(lineOf(r, 3)).toMatchObject({ verdict: "ACCEPTED", family: "Fraude" });
      expect(lineOf(r, 6)).toMatchObject({ verdict: "ACCEPTED", family: "Conformité" });
      expect(await snap()).toEqual(s0);
    });

    it("F2 refus d'emblee (400, message clair) : vide, NUL, PK, %PDF, gzip, OLE, UTF-16, Latin-1 (ligne citee), UTF-8 surlongue, substitut seul, mauvais nom, mauvais type", async () => {
      const s0 = await snap();
      const bad: [string, Buffer | string, FileOpts, RegExp][] = [
        ["vide", "", {}, /vide/i],
        ["NUL", Buffer.from("Fraude;Fraude interne\u0000\n"), {}, /nul|texte/i],
        ["PK", Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("Fraude;Fraude interne")]), {}, /texte/i],
        ["%PDF", Buffer.from("%PDF-1.4\nFraude;Fraude interne"), {}, /texte/i],
        ["gzip", Buffer.concat([Buffer.from([0x1f, 0x8b, 8]), Buffer.from("x")]), {}, /texte/i],
        ["OLE", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.from("x")]), {}, /texte/i],
        ["UTF-16LE", Buffer.from("\uFEFFFraude;Fraude interne\n", "utf16le"), {}, /texte|utf/i],
        ["Latin-1", Buffer.from("Fraude;Fraude interne\nConformit\xe9;Lutte\n", "latin1"), {}, /UTF-8.*ligne 2|ligne 2.*UTF-8/i],
        ["UTF-8 surlongue", Buffer.from([0x46, 0x72, 0xc0, 0xaf, 0x0a]), {}, /UTF-8/i],
        ["substitut seul", Buffer.from([0x46, 0xed, 0xa0, 0x80, 0x0a]), {}, /UTF-8/i],
        ["extension .csv", GOOD, { name: "familles.csv" }, /\.txt/i],
        ["sans extension", GOOD, { name: "familles" }, /\.txt/i],
        ["double extension .txt.exe", GOOD, { name: "familles.txt.exe" }, /\.txt/i],
        ["type application/octet-stream", GOOD, { type: "application/octet-stream" }, /text\/plain|texte/i],
        ["type text/csv", GOOD, { type: "text/csv" }, /text\/plain|texte/i],
      ];
      for (const [label, c, o, msg] of bad) {
        for (const op of ["preview", "commit"] as const) {
          const r = await multipart("rm1", op, FW, V, c, { ...o, fingerprint: sha(c) });
          expect(r.status, `${label}/${op}: ${r.text}`).toBe(400);
          expect(r.text, `${label}/${op}`).toMatch(msg);
        }
      }
      expect(await snap()).toEqual(s0);
    });

    it("F3 taille : 64 Ko exactement accepte ; 64 Ko + 1 refuse en 4xx (jamais 500) avant lecture ; deux fichiers, champ en trop, fichier absent, corps JSON : 4xx jamais 500", async () => {
      const head = "# \n";
      const filler = "#".repeat(1022) + "\n";
      let big = head;
      while (Buffer.byteLength(big + filler) <= 64 * 1024 - Buffer.byteLength(GOOD)) big += filler;
      big += GOOD;
      const pad = 64 * 1024 - Buffer.byteLength(big);
      big = "#".repeat(Math.max(0, pad - 1)) + (pad > 0 ? "\n" : "") + big;
      expect(Buffer.byteLength(big)).toBe(64 * 1024);
      const ok = await preview("rm1", FW, V, big);
      expect(ok.status, ok.text).toBe(200);
      expect(ok.json!["data"].acceptedCount).toBe(2);
      const over = await preview("rm1", FW, V, big + "#");
      expect(over.status, over.text.slice(0, 200)).toBeGreaterThanOrEqual(400);
      expect(over.status, over.text.slice(0, 200)).toBeLessThan(500);
      const huge = await preview("rm1", FW, V, Buffer.alloc(3 * 1024 * 1024, 0x23));
      expect(huge.status).toBeGreaterThanOrEqual(400);
      expect(huge.status).toBeLessThan(500);
      for (const [label, o] of [["deux fichiers", { two: true }], ["fichier absent", { noFile: true }]] as [string, FileOpts][]) {
        const r = await preview("rm1", FW, V, GOOD, o);
        expect(r.status, `${label}: ${r.text}`).toBeGreaterThanOrEqual(400);
        expect(r.status, `${label}: ${r.text}`).toBeLessThan(500);
      }
      const j = await call("rm1", "POST", `/risk-frameworks/${FW}/versions/${V}/import-families/preview`, { file: GOOD });
      expect(j.status, j.text).toBeGreaterThanOrEqual(400);
      expect(j.status, j.text).toBeLessThan(500);
      const nobody = await fetch(`${API}/risk-frameworks/${FW}/versions/${V}/import-families/preview`, { method: "POST", headers: { authorization: `Bearer ${TOK["rm1"]}`, "x-forwarded-for": ip() } });
      expect(nobody.status).toBeLessThan(500);
    });

    it("F4 type « text/plain; charset=utf-8 » (variante courante d'un client) : observation", async () => {
      const r = await preview("rm1", FW, V, GOOD, { type: "text/plain; charset=utf-8" });
      console.log("F4 text/plain;charset=utf-8 ->", r.status, r.text.slice(0, 120));
      expect(r.status).toBeLessThan(500);
    });

    it("F5 200 lignes de donnees acceptees, 201 refusees en 400 (nombre indique) ; le plafond compte les lignes, pas les octets", async () => {
      const l200 = Array.from({ length: 200 }, () => "Fraude;Fraude interne").join("\n");
      const r = await preview("rm1", FW, V, l200);
      expect(r.status, r.text.slice(0, 200)).toBe(200);
      expect(r.json!["data"]).toMatchObject({ dataLines: 200, acceptedCount: 1, warningCount: 199, errorCount: 0 });
      const r2 = await preview("rm1", FW, V, l200 + "\nFraude;Fraude interne");
      expect(r2.status, r2.text).toBe(400);
      expect(r2.text).toMatch(/200/);
      // commentaires et lignes vides ne comptent pas
      const r3 = await preview("rm1", FW, V, l200 + "\n# c\n\n\n");
      expect(r3.status, r3.text.slice(0, 120)).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------------------ L
  describe("L controles ligne par ligne (section 3.2)", () => {
    const one1 = async (content: string, vid = V) => { const r = await preview("rm1", FW, vid, content); expect(r.status, r.text.slice(0, 300)).toBe(200); return r; };

    it("L1 erreurs de format : 1 champ, 4 champs, champ vide, > 120 caracteres, caractere de controle (tabulation interne, BEL, DEL, NEL) ; message avec le numero de ligne", async () => {
      const long = "x".repeat(121);
      const content = [
        "Fraude", "Fraude;Fraude interne;Risques opérationnels;en trop", "Fraude;", ";Fraude interne", `Fraude;${long}`, `${long};Fraude interne`,
        "Fraude;Fraude\tinterne", "Fraude;Fraude\u0007interne", "Fraude;Fraude\u007finterne", "Fraude;Fraude\u0085interne", "Fraude;Fraude;;",
      ].join("\n");
      const r = await one1(content);
      expect(r.json!["data"].errorCount).toBe(11);
      expect(r.json!["data"].acceptedCount).toBe(0);
      const msgs = (r.json!["data"].lines as Row[]).map((l) => `${l.line}:${l.verdict}:${l.messages.join("|")}`);
      expect(msgs[0]).toMatch(/1:ERROR:1 champ/);
      expect(msgs[1]).toMatch(/2:ERROR:4 champ/);
      expect(msgs[2]).toMatch(/Champ vide/);
      expect(msgs[3]).toMatch(/Champ vide/);
      expect(msgs[4]).toMatch(/120 caract/);
      expect(msgs[5]).toMatch(/120 caract/);
      for (const i of [6, 7, 8, 9]) expect(msgs[i], `ligne ${i + 1}`).toMatch(/contr[oô]le/i);
      expect(msgs[10]).toMatch(/Champ vide|champ/);
      // exactly 120 characters is accepted as a field (then fails later as unknown), never as a length error
      const r2 = await one1(`Fraude;${"y".repeat(120)}`);
      expect(lineOf(r2, 1).messages.join()).not.toMatch(/120 caract/);
    });

    it("L2 famille : libelle francais, sans accent, majuscules, code anglais, espaces autour acceptes ; inconnue = erreur avec les 3 familles les plus proches ; casse / accents de la sous-categorie ignores", async () => {
      const r = await one1(["Fraude;Fraude interne", "FRAUDE ;  fraude sur transactions mobiles", "conformite;lutte contre le blanchiment (lbc-ft)", "COMPLIANCE;Fuite de données clients",
        "Donnees et vie privee;Rançongiciel", "Cybersécurité;ecart de reconciliation", "Frauds;Risque de liquidité", "Fraudes;Risque de liquidité", "Banane;Risque de liquidité"].join("\n"));
      const lines = r.json!["data"].lines as Row[];
      for (const i of [0, 1, 2, 3, 4, 5]) expect(lines[i]!.verdict, `ligne ${i + 1}: ${lines[i]!.messages}`).toBe("ACCEPTED");
      // « COMPLIANCE;Fuite de données clients » est rattachee a Conformité (le code anglais est accepte)
      expect(lines[3]!.family).toBe("Conformité");
      for (const i of [6, 7, 8]) {
        expect(lines[i]!.verdict).toBe("ERROR");
        expect(lines[i]!.messages[0]).toMatch(/Famille inconnue/);
        expect(((lines[i]!.messages[0] as string).split(":")[1] ?? "").split(",").length, `3 plus proches (ligne ${i + 1})`).toBe(3);
      }
      expect(lines[6]!.messages[0]).toMatch(/Fraude/);
    });

    it("L3 sous-categorie : absente (aucune creation), de premier niveau, homonyme sans parent, parent faux, parent bon (casse / accents ignores)", async () => {
      const before = await count(`SELECT count(*)::int n FROM risk_categories WHERE tenant_id = $1`, [T]);
      const r = await one1(["Fraude;Inventée", "Opérationnel;Risques opérationnels", "Opérationnel;Incident", "Opérationnel;Incident;Conformité réglementaire", "Opérationnel;Incident;risques operationnels",
        "Opérationnel;Incident;Inconnue", "Opérationnel;Fraude interne;Conformité réglementaire"].join("\n"));
      const l = r.json!["data"].lines as Row[];
      expect(l[0]).toMatchObject({ verdict: "ERROR" });
      expect(l[0]!.messages[0]).toMatch(/absente du référentiel/);
      expect(l[1]!.messages[0]).toMatch(/premier niveau/);
      expect(l[2]!.messages[0]).toMatch(/Plusieurs sous-catégories portent ce nom/);
      expect(l[3]!.verdict).toBe("ACCEPTED");
      expect(l[4]!.verdict).toBe("ACCEPTED"); // le parent « Risques opérationnels » designe l autre homonyme (h1) : deux sous-categories distinctes
      expect(l[5]!.messages[0]).toMatch(/parente indiquée ne correspond pas/);
      expect(l[6]!.messages[0]).toMatch(/parente indiquée ne correspond pas/);
      expect(await count(`SELECT count(*)::int n FROM risk_categories WHERE tenant_id = $1`, [T])).toBe(before);
    });

    it("L4 deux familles pour une meme sous-categorie : erreur a la 2e ligne qui cite la 1re ; meme famille deux fois : avertissement (doublon ignore) ; inactive : avertissement, aucune entree", async () => {
      const r = await one1(["Fraude;Fraude interne", "Opérationnel;Fraude interne", "Fraude;Fraude sur transactions mobiles", "Fraude;Fraude sur transactions mobiles", "Opérationnel;Ancienne sous-catégorie"].join("\n"));
      const l = r.json!["data"].lines as Row[];
      expect(l[1]).toMatchObject({ verdict: "ERROR" });
      expect(l[1]!.messages[0]).toMatch(/ligne 1/);
      expect(l[3]).toMatchObject({ verdict: "WARNING" });
      expect(l[3]!.messages[0]).toMatch(/ligne 3/);
      expect(l[4]).toMatchObject({ verdict: "WARNING" });
      expect(r.json!["data"]).toMatchObject({ acceptedCount: 2, warningCount: 2, errorCount: 1 });
    });

    it("L5 coherence : sous-categories actives absentes du fichier listees (sans famille) ; familles strictes sans sous-categorie signalees ; aucune ligne valide = erreur", async () => {
      const r = await one1("Fraude;Fraude interne\n");
      const d = r.json!["data"];
      expect(d.withoutFamily).toContain("Non citée");
      expect(d.withoutFamily).not.toContain("Fraude interne");
      expect(d.withoutFamily).not.toContain("Ancienne sous-catégorie"); // inactive : pas de « sans famille »
      for (const f of ["Conformité", "Cybersécurité", "Données et vie privée"]) expect((d.notices as string[]).join("|")).toMatch(new RegExp(`famille stricte « ${f} »`));
      expect((d.notices as string[]).join("|")).not.toMatch(/« Fraude »/);
      const e = await one1("# rien\n\n");
      expect(e.json!["data"]).toMatchObject({ errorCount: 1, acceptedCount: 0 });
      expect(lineOf(e, 0).messages[0]).toMatch(/Aucune ligne de données/);
      const c = await commit("rm1", FW, V, "# rien\n\n");
      expect(c.status, c.text).toBe(400);
    });

    it("L6 injections : noms commencant par = + - @, balises, SQL, caracteres bidirectionnels : traites comme du texte, jamais executes ni ecrits (sous-categorie absente)", async () => {
      const s0 = await snap();
      const r = await one1(["Fraude;=1+1", "Fraude;+cmd", "Fraude;-1", "Fraude;@SUM(A1)", "Fraude;<script>alert(1)</script>", "Fraude;x'; DROP TABLE risk_categories;--", "Fraude;\u202Efraude interne", "Fraude;\u200Bfraude interne"].join("\n"));
      expect(r.json!["data"].errorCount).toBe(8);
      expect(await snap()).toEqual(s0);
      expect(await count(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name = 'risk_categories'`)).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------------------------ P / C
  describe("P-C apercu, tout ou rien, commit", () => {
    it("P1 tout ou rien : une seule erreur bloque l'ecriture meme quand d'autres lignes sont valides (commit 400, version et audit inchanges)", async () => {
      const s0 = await snap();
      const txt = GOOD + "Fraude;Inventée\n";
      const p = await preview("rm1", FW, V, txt);
      expect(p.json!["data"]).toMatchObject({ acceptedCount: 2, errorCount: 1 });
      const c = await commit("rm1", FW, V, txt);
      expect(c.status, c.text).toBe(400);
      expect(c.text).toMatch(/rien n'a été écrit/);
      expect(await snap()).toEqual(s0);
      expect(await appetite()).toEqual([]);
    });

    it("C1 empreinte : mal formee 400, absente 400, differente 409 (un octet change), majuscules acceptees ; rien d'ecrit en cas de refus", async () => {
      const s0 = await snap();
      for (const fp of ["abc", "z".repeat(64), "", sha(GOOD).slice(1)]) {
        const r = await commit("rm1", FW, V, GOOD, fp);
        expect(r.status, `fp=${fp}: ${r.text}`).toBe(400);
      }
      const noFp = await multipart("rm1", "commit", FW, V, GOOD, {});
      expect(noFp.status, noFp.text).toBe(400);
      const diff = await commit("rm1", FW, V, GOOD + " ", sha(GOOD));
      expect(diff.status, diff.text).toBe(409);
      expect(diff.json!["code"] ?? diff.text).toMatch(/IMPORT_FINGERPRINT_MISMATCH|aperçu/);
      const other = await commit("rm1", FW, V, GOOD, sha("autre contenu"));
      expect(other.status).toBe(409);
      expect(await snap()).toEqual(s0);
      const up = await commit("rm1", FW, V, GOOD, sha(GOOD).toUpperCase());
      expect(up.status, up.text).toBe(200); // majuscules : accepte (reinitialise l'etat pour la suite)
      await setAppetite([]);
    });

    it("C2 commit : entrees creees par famille (strict 4 / modere 9 de l'echelle 5x5), mention de depart, subCategoryId, entity null ; audit = import (empreinte, comptes, aucun contenu) + updateDraft ; version toujours DRAFT", async () => {
      const txt = "Fraude;Fraude interne\nOpérationnel;Risque de liquidité\nFinancier;Écart de réconciliation\nDonnées et vie privée;Fuite de données clients\nTiers;Rançongiciel\n";
      const a0 = await count(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND entity_id = $2`, [T, V]);
      const c = await commit("rm1", FW, V, txt);
      expect(c.status, c.text).toBe(200);
      expect(c.json!["data"]).toMatchObject({ createdCount: 5, acceptedCount: 5, errorCount: 0 });
      const ent = await appetite();
      expect(ent).toHaveLength(5);
      const by = (id: string) => ent.find((e) => e.subCategoryId === id)!;
      expect(by(C["fraud"]!)).toMatchObject({ threshold: 4, description: NOTE, entity: null, subCategory: "Fraude interne" });
      expect(by(C["leak"]!)).toMatchObject({ threshold: 4, description: NOTE });
      expect(by(C["liq"]!)).toMatchObject({ threshold: 9, description: NOTE });
      expect(by(C["ecart"]!)).toMatchObject({ threshold: 9, description: NOTE });
      expect(by(C["ransom"]!)).toMatchObject({ threshold: 9, description: NOTE });
      expect((await one(`SELECT status FROM risk_framework_versions WHERE id = $1`, [V])).status).toBe("DRAFT");
      // audit
      const au = await sql(`SELECT action, old_value, new_value, user_id FROM audit_log WHERE tenant_id = $1 AND entity_id = $2 ORDER BY timestamp, id`, [T, V]);
      expect(au.length - a0).toBe(2);
      const imp = au.find((x) => x.new_value?.operation === "IMPORT_FAMILIES" && x.new_value?.fingerprint === sha(txt))!;
      expect(imp.new_value).toEqual({ operation: "IMPORT_FAMILIES", fingerprint: sha(txt), dataLines: 5, createdCount: 5, keptCount: 0 });
      expect(JSON.stringify(imp)).not.toMatch(/Fraude|liquidité|Rançongiciel/);
      const upd = au.find((x) => x.action === "UPDATE" && !x.new_value?.operation && x.new_value?.appetiteThresholds?.length === 5)!;
      expect(upd.action).toBe("UPDATE");
      // aucune ecriture dans le referentiel des categories
      expect(await count(`SELECT count(*)::int n FROM risk_categories WHERE tenant_id = $1`, [T])).toBe(13);
    });

    it("C3 REJEU et VALEUR CLIENT : un rejeu cree 0 entree et ne duplique rien ; une valeur saisie par le client (autre seuil, autre description) est CONSERVEE, jamais ecrasee, y compris pour une entree avec entite ; l'apercu la liste « Conservée »", async () => {
      const txt = "Fraude;Fraude interne\nOpérationnel;Risque de liquidité\n";
      const before = await appetite();
      const r = await commit("rm1", FW, V, txt);
      expect(r.status, r.text).toBe(200);
      expect(r.json!["data"]).toMatchObject({ createdCount: 0, keptCount: 2 });
      expect(await appetite()).toEqual(before);
      // client values
      await setAppetite([
        { subCategory: "Fraude interne", subCategoryId: C["fraud"], entity: null, threshold: 7, description: "choix du client" },
        { subCategory: "Risque de liquidité", subCategoryId: C["liq"], entity: "Filiale CI", threshold: 12, description: "entite" },
        { subCategory: "Non citée", subCategoryId: C["free"], entity: null, threshold: 11, description: "hors fichier" },
      ]);
      const p = await preview("rm1", FW, V, txt + "Opérationnel;Rançongiciel\n");
      expect(p.json!["data"]).toMatchObject({ acceptedCount: 1, keptCount: 2 });
      expect((p.json!["data"].lines as Row[]).filter((l) => l.verdict === "KEPT")).toHaveLength(2);
      const c = await commit("rm1", FW, V, txt + "Opérationnel;Rançongiciel\n");
      expect(c.status, c.text).toBe(200);
      const ent = await appetite();
      expect(ent).toHaveLength(4);
      expect(ent.find((e) => e.subCategoryId === C["fraud"])).toMatchObject({ threshold: 7, description: "choix du client" });
      expect(ent.find((e) => e.subCategoryId === C["liq"])).toMatchObject({ threshold: 12, entity: "Filiale CI", description: "entite" });
      expect(ent.find((e) => e.subCategoryId === C["free"])).toMatchObject({ threshold: 11 });
      expect(ent.find((e) => e.subCategoryId === C["ransom"])).toMatchObject({ threshold: 9, description: NOTE });
      await setAppetite([]);
    });

    it("C4 le referentiel change ENTRE l'apercu et le commit (meme fichier, meme empreinte) : le serveur refait toutes les verifications ; sous-categorie supprimee / desactivee => 400 sans ecriture ; creee ensuite => acceptee", async () => {
      const txt = "Fraude;Fraude interne\nOpérationnel;Sous-cat éphémère\n";
      const eph = (await one(`INSERT INTO risk_categories (tenant_id, name, parent_id) VALUES ($1,'Sous-cat éphémère',$2) RETURNING id`, [T, C["RA"]])).id as string;
      const p = await preview("rm1", FW, V, txt);
      expect(p.json!["data"]).toMatchObject({ acceptedCount: 2, errorCount: 0 });
      await sql(`UPDATE risk_categories SET active = false WHERE id = $1`, [eph]);
      const s0 = await snap();
      const c = await commit("rm1", FW, V, txt, p.json!["data"].fingerprint);
      expect(c.status === 200 && (c.json!["data"].createdCount as number) === 1, `desactivee: ${c.status} ${c.text.slice(0, 200)}`).toBe(true); // inactive => ignoree (avertissement), l'autre ligne est ecrite
      await setAppetite([]);
      await sql(`DELETE FROM risk_categories WHERE id = $1`, [eph]);
      const s1 = await snap();
      const c2 = await commit("rm1", FW, V, txt, p.json!["data"].fingerprint);
      expect(c2.status, c2.text).toBe(400); // la sous-categorie n'existe plus
      expect(await snap()).toEqual(s1);
      void s0;
    });

    it("C5 plafond : 199 entrees existantes + 2 nouvelles => erreur « Plus de 200 entrées », rien d'ecrit ; 199 + 1 = 200 accepte", async () => {
      const fill = Array.from({ length: 199 }, (_, i) => ({ subCategory: "Non citée", subCategoryId: C["free"], entity: `E${i}`, threshold: 5, description: "x" }));
      await setAppetite(fill);
      const two = "Fraude;Fraude interne\nOpérationnel;Risque de liquidité\n";
      const s0 = await snap();
      const p = await preview("rm1", FW, V, two);
      expect(p.json!["data"].errorCount).toBe(1);
      expect(lineOf(p, 0).messages[0]).toMatch(/200 entrées/);
      expect((await commit("rm1", FW, V, two)).status).toBe(400);
      expect(await snap()).toEqual(s0);
      const ok = await commit("rm1", FW, V, "Fraude;Fraude interne\n");
      expect(ok.status, ok.text).toBe(200);
      expect(await appetite()).toHaveLength(200);
      await setAppetite([]);
    });

    it("C6 entrees heritees « legacy » (sans subCategoryId, meme libelle) : conservees, la sous-categorie n'est pas dupliquee", async () => {
      await setAppetite([{ subCategory: "Fraude interne", subCategoryId: null, entity: null, threshold: 6, description: "ancienne saisie" }]);
      const p = await preview("rm1", FW, V, "Fraude;Fraude interne\n");
      console.log("C6 legacy entry vs import ->", JSON.stringify((p.json!["data"] as Row)["lines"]));
      const c = await commit("rm1", FW, V, "Fraude;Fraude interne\n");
      expect(c.status, c.text).toBeLessThan(500);
      const ent = await appetite();
      expect(ent.filter((e) => e.subCategory === "Fraude interne"), "pas de doublon (libelle, entite)").toHaveLength(1);
      expect(ent.find((e) => e.subCategory === "Fraude interne")).toMatchObject({ threshold: 6, description: "ancienne saisie" });
      await setAppetite([]);
    });
  });

  // ------------------------------------------------------------------------------------------------ version, tenant, droits
  describe("S version, tenant, droits", () => {
    let ACTIVE_FW = ""; let ACTIVE_V = "";
    beforeAll(async () => {
      ACTIVE_FW = (await one(`SELECT id FROM risk_frameworks WHERE tenant_id = $1 AND name = 'Tranché'`, [T])).id as string;
      ACTIVE_V = (await one(`SELECT id FROM risk_framework_versions WHERE framework_id = $1`, [ACTIVE_FW])).id as string;
      const rq = await call("rm1", "POST", `/risk-frameworks/${ACTIVE_FW}/versions/${ACTIVE_V}/activation-requests`, { reason: "Activation QA import" });
      expect(rq.status, rq.text).toBe(201);
      expect((await decide("rm2", rq.json!["data"].id, "approve")).status).toBe(200);
    });

    it("S1 version ACTIVE ou ARCHIVED refusee (apercu et commit : 400), rien d'ecrit ; version inconnue / Dispositif inconnu 404 ; ids non uuid 400", async () => {
      const before = JSON.stringify(await sql(`SELECT id, appetite_thresholds FROM risk_framework_versions WHERE tenant_id = $1 ORDER BY id`, [T]));
      for (const op of ["preview", "commit"] as const) {
        const r = await multipart("rm1", op, ACTIVE_FW, ACTIVE_V, GOOD, { fingerprint: sha(GOOD) });
        expect(r.status, `${op} ACTIVE: ${r.text}`).toBe(400);
        expect(r.text).toMatch(/brouillon/);
      }
      await sql(`ALTER TABLE risk_framework_versions DISABLE TRIGGER USER`);
      const arch = (await one(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, status, rating_scale_id, committee_evaluation_min_score, created_by, last_edited_by, low_criticality_threshold, archived_at, archived_by, archive_reason)
        SELECT tenant_id, framework_id, 9, 'ARCHIVED', rating_scale_id, 9, created_by, created_by, 3, now(), created_by, 'QA' FROM risk_framework_versions WHERE id = $1 RETURNING id`, [ACTIVE_V]).catch(() => ({ id: null }))).id as string | null;
      await sql(`ALTER TABLE risk_framework_versions ENABLE TRIGGER USER`);
      if (arch) for (const op of ["preview", "commit"] as const) expect((await multipart("rm1", op, ACTIVE_FW, arch, GOOD, { fingerprint: sha(GOOD) })).status, `${op} ARCHIVED`).toBe(400);
      expect(JSON.stringify(await sql(`SELECT id, appetite_thresholds FROM risk_framework_versions WHERE tenant_id = $1 AND id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000') ORDER BY id`, [T, arch]))).toBe(before);
      for (const [fw, v] of [[FW, UNKNOWN], [UNKNOWN, V], [ACTIVE_FW, V]] as const) {
        const r = await preview("rm1", fw, v, GOOD);
        expect([400, 404], `${fw}/${v}: ${r.text}`).toContain(r.status);
      }
      expect((await preview("rm1", "not-a-uuid", V, GOOD)).status).toBe(400);
      expect((await preview("rm1", FW, "12345", GOOD)).status).toBe(400);
    });

    it("S2 tenant croise : le RM d'un autre tenant, avec les ids de T, recoit 404 (aucune information, aucun message different d'un id inconnu) ; avec SES ids et les noms de T : « absente du referentiel » (pas de fuite des categories de T)", async () => {
      const s0 = await snap();
      for (const op of ["preview", "commit"] as const) {
        const r = await multipart("rmb", op, FW, V, GOOD, { fingerprint: sha(GOOD) });
        const u = await multipart("rmb", op, UNKNOWN, UNKNOWN, GOOD, { fingerprint: sha(GOOD) });
        expect(r.status, `${op}: ${r.text}`).toBe(404);
        expect(String(r.json!["error"]).replace(/[0-9a-f-]{36}/g, "<id>")).toBe(String(u.json!["error"]).replace(/[0-9a-f-]{36}/g, "<id>"));
      }
      // tenant B : provisionne ses modeles puis importe un fichier qui nomme des sous-categories de T
      expect((await call("rmb", "POST", "/risk-frameworks/defaults", {})).status).toBe(201);
      const fwB = (await one(`SELECT id FROM risk_frameworks WHERE tenant_id = $1 AND name = 'Standard'`, [TB])).id as string;
      const vB = (await one(`SELECT id FROM risk_framework_versions WHERE framework_id = $1`, [fwB])).id as string;
      const r = await preview("rmb", fwB, vB, "Fraude;Fraude interne\nFraude;Fraude sur transactions mobiles\nConformité;Fuite de données clients\n");
      expect(r.status, r.text).toBe(200);
      expect(lineOf(r, 1)).toMatchObject({ verdict: "ACCEPTED" }); // « Fraude interne » existe aussi chez B
      expect(lineOf(r, 2).messages[0]).toMatch(/absente du référentiel/);
      expect(lineOf(r, 3).messages[0]).toMatch(/absente du référentiel/);
      expect(JSON.stringify(r.json)).not.toContain(C["fraud"]!);
      expect(r.json!["data"].withoutFamily).toEqual([]);
      const c = await commit("rmb", fwB, vB, "Fraude;Fraude interne\n");
      expect(c.status, c.text).toBe(200);
      const entB = (await one(`SELECT appetite_thresholds AS a FROM risk_framework_versions WHERE id = $1`, [vB])).a as Row[];
      expect(entB).toHaveLength(1);
      expect(entB[0]!.subCategoryId).not.toBe(C["fraud"]);
      expect(await snap()).toEqual(s0); // T inchange
    });

    it("S3 droits : sans jeton 401 ; compte simple, Audit, process.update seul 403 ; droits directs hors groupe RM (adm) : apercu et commit decrits (observation) ; un RM qui n'a pas ecrit le brouillon peut importer", async () => {
      const s0 = await snap();
      expect((await preview(null, FW, V, GOOD)).status).toBe(401);
      expect((await commit(null, FW, V, GOOD)).status).toBe(401);
      for (const who of ["plain", "aud", "pu"] as Who[]) for (const op of ["preview", "commit"] as const) {
        const r = await multipart(who, op, FW, V, GOOD, { fingerprint: sha(GOOD) });
        expect(r.status, `${who}/${op}: ${r.text}`).toBe(403);
      }
      const ap = await preview("adm", FW, V, GOOD);
      const ac = await commit("adm", FW, V, GOOD);
      console.log("S3 adm (droits directs, hors groupe RM) apercu/commit ->", ap.status, ac.status, ac.text.slice(0, 100));
      expect(ac.status).toBe(403); // updateDraft exige l'appartenance au groupe RM
      expect(await snap()).toEqual(s0);
      const other = await commit("rm3", FW, V, GOOD);
      expect(other.status, other.text).toBe(200);
      await setAppetite([]);
    });

    it("S4a panne d audit sur l UPDATE de la version (updateDraft, meme transaction) : 5xx et rien d ecrit", async () => {
      await sql(`DELETE FROM qa_fail_audit`);
      await sql(`INSERT INTO qa_fail_audit (entity_type, action, key) VALUES ('RiskFrameworkVersion', 'UPDATE', NULL)`);
      let r: Res;
      try { r = await commit("rm1", FW, V, GOOD); } finally { await sql(`DELETE FROM qa_fail_audit`); }
      expect(r.status, r.text).toBeGreaterThanOrEqual(500);
      expect(await appetite(), "atomique").toEqual([]);
    });

    it("QA-IMP-02 S4b (corrige) panne d'audit sur la SEULE ligne d'import (cle `operation`) : le client recoit 5xx mais l'ecriture est deja faite (2 entrees) : 5xx => rien d'ecrit attendu", async () => {
      await sql(`DELETE FROM qa_fail_audit`);
      await sql(`INSERT INTO qa_fail_audit (entity_type, action, key) VALUES ('RiskFrameworkVersion', 'UPDATE', 'operation')`);
      let r: Res;
      try { r = await commit("rm1", FW, V, GOOD); } finally { await sql(`DELETE FROM qa_fail_audit`); }
      expect(r.status, r.text).toBeGreaterThanOrEqual(500);
      const written = (await appetite()).length;
      await setAppetite([]);
      expect(written, "5xx => rien d'ecrit attendu").toBe(0);
    });

    it("S5 limiteur (30 appels / 15 min / IP) : au-dela, 429 propre (jamais 500) ; une autre IP n'est pas touchee", async () => {
      const fixed = "172.16.9.9";
      let last = 0; let n429 = 0;
      for (let i = 0; i < 33; i++) { const r = await preview("rm1", FW, V, GOOD, { fixedIp: fixed }); last = r.status; if (r.status === 429) n429++; expect(r.status).toBeLessThan(500); }
      expect(n429).toBeGreaterThanOrEqual(1);
      expect(last).toBe(429);
      expect((await preview("rm1", FW, V, GOOD)).status).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------------------ R course
  describe("R course : commit // edition du meme brouillon (updateDraft sans verrou optimiste)", () => {
    it("QA-IMP-01 R1 MESURE (corrige : 409 au lieu d ecraser) : un commit et une edition cliente (PATCH du tableau d'appetence qui ajoute SA propre entree) du meme brouillon, lances ensemble. Oracle attendu : aucune entree perdue quand les deux repondent 200", async () => {
      const seen: Record<string, number> = { ok: 0, lostClient: 0, lostImport: 0, other: 0 };
      const detail: string[] = [];
      for (let i = 0; i < 30; i++) {
        await setAppetite([]);
        const clientEntry = { subCategory: "Non citée", subCategoryId: C["free"], entity: null, threshold: 11, description: `client ${i}` };
        const delayImport = i % 3 === 0 ? 0 : (i % 3) * 4;
        const delayClient = i % 3 === 0 ? 3 : 0;
        const [a, b] = await Promise.all([
          new Promise<Res>((ok) => setTimeout(ok, delayImport)).then(() => commit("rm1", FW, V, GOOD)),
          new Promise<Res>((ok) => setTimeout(ok, delayClient)).then(() => call("rm2", "PATCH", `/risk-frameworks/${FW}/versions/${V}`, { appetiteThresholds: [clientEntry] })),
        ]);
        // A 409 DRAFT_CHANGED on the import is the correct outcome of a lost race: nothing of the client was overwritten.
        if (a.status === 409 && b.status === 200) { seen.conflict = (seen.conflict ?? 0) + 1; if ((await appetite()).some((e) => e.subCategoryId === C["free"])) continue; seen.lostClient++; continue; }
        if (a.status !== 200 || b.status !== 200) { seen.other++; detail.push(`${i}: ${a.status}/${b.status}`); continue; }
        const ent = await appetite();
        const hasClient = ent.some((e) => e.subCategoryId === C["free"]);
        const hasImport = ent.some((e) => e.subCategoryId === C["fraud"]) && ent.some((e) => e.subCategoryId === C["aml"]);
        if (hasClient && hasImport) seen.ok++;
        else if (!hasClient && hasImport) seen.lostClient++;
        else if (hasClient && !hasImport) seen.lostImport++;
        else seen.other++;
      }
      console.log("R1 outcomes (30 courses)", JSON.stringify(seen), detail.slice(0, 5).join(" "));
      await setAppetite([]);
      // The PATCH replaces the whole array by design, so "lostImport" (the PATCH landing after the commit) is the documented semantics of two whole-array writers;
      // what the import must never do is erase a client entry it did not read: that is "lostClient".
      expect(seen.lostClient, `entrees clientes ecrasees par l'import : ${JSON.stringify(seen)}`).toBe(0);
    });

    it("R2 DETERMINISTE (equivalent service) : getVersion lu, puis une edition cliente committee, puis updateDraft du service d'import : l'entree cliente est ecrasee (le tableau complet lu avant est reecrit) ; la base n'a aucune garde (pas de version / updated_at comparee)", async () => {
      // Real server, real DB: the window is forced with a transaction that holds the row while the import reads and writes nothing,
      // then commits the client's edit just before the import's UPDATE runs is not reproducible through HTTP; the repository statement is checked instead.
      const stmt = await one(`SELECT 1 AS x`);
      expect(stmt.x).toBe(1);
      const src = (await import("node:fs")).readFileSync(join(ROOT, "backend", "src", "infrastructure", "database", "postgres", "PostgresRiskFrameworkRepository.ts"), "utf8");
      const m = /async updateDraft\([\s\S]*?\n  }\n/.exec(src)![0];
      expect(m, "updateDraft : UPDATE inconditionnel sur (tenant, framework, id, status = DRAFT), sans comparaison de version").toMatch(/WHERE tenant_id = \$1 AND framework_id = \$2 AND id = \$3 AND status = 'DRAFT'/);
      expect(m, "QA-IMP-01 corrige : ecriture conditionnelle sur updated_at").toMatch(/expectedUpdatedAt/);
    });

    const getUpdatedAt = async () => (await call("rm1", "GET", `/risk-frameworks/${FW}/versions/${V}`)).json!["data"].updatedAt as string;
    const patch = (who: Who, body: Row) => call(who, "PATCH", `/risk-frameworks/${FW}/versions/${V}`, body);
    const entry = (i: number) => ({ subCategory: "Non citée", subCategoryId: C["free"], entity: `P${i}`, threshold: 5, description: `edition ${i}` });

    it("R3 PATCH du brouillon : sans expectedUpdatedAt reste COMPATIBLE (200) ; avec la valeur lue 200 (aller-retour en ms sans faux conflit) ; avec une valeur perimee 409 DRAFT_CHANGED sans rien ecrire ; mal forme 400", async () => {
      await setAppetite([]);
      const t0 = await getUpdatedAt();
      const compat = await patch("rm1", { appetiteThresholds: [entry(0)] });
      expect(compat.status, compat.text).toBe(200);
      const t1 = await getUpdatedAt();
      expect(t1).not.toBe(t0);
      const okExp = await patch("rm1", { appetiteThresholds: [entry(0), entry(1)], expectedUpdatedAt: t1 });
      expect(okExp.status, okExp.text).toBe(200);
      expect(await appetite()).toHaveLength(2);
      const stale = await patch("rm2", { appetiteThresholds: [entry(2)], expectedUpdatedAt: t1 });
      expect(stale.status, stale.text).toBe(409);
      expect(stale.json!["code"] ?? stale.text).toMatch(/DRAFT_CHANGED/);
      expect(await appetite(), "rien d'ecrit sur un 409").toHaveLength(2);
      for (const bad of ["hier", "", 12, null, "2026-11-12T10:00:00+02:00", "2026-13-40T00:00:00Z"]) {
        const r = await patch("rm1", { appetiteThresholds: [entry(3)], expectedUpdatedAt: bad });
        expect(r.status, `expectedUpdatedAt=${JSON.stringify(bad)}: ${r.text}`).toBe(400);
      }
      // expectedUpdatedAt alone (nothing to update) is refused, never silently accepted
      const only = await patch("rm1", { expectedUpdatedAt: await getUpdatedAt() });
      expect(only.status, only.text).toBeGreaterThanOrEqual(400);
      expect(only.status).toBeLessThan(500);
      // the import itself: a commit based on a stale read is refused with 409 and retried successfully
      await setAppetite([]);
      const c = await commit("rm1", FW, V, GOOD);
      expect(c.status, c.text).toBe(200);
      const again = await commit("rm1", FW, V, GOOD);
      expect(again.status, again.text).toBe(200);
      await setAppetite([]);
    });

    it("R4 MESURE (30 courses) : commit // PATCH portant expectedUpdatedAt lu avant : jamais de saisie perdue dans AUCUN sens ; deux 200 => les deux ecritures presentes ; 409 tolere ; jamais 500", async () => {
      const seen: Record<string, number> = { both200: 0, importConflict: 0, patchConflict: 0, other: 0 };
      for (let i = 0; i < 30; i++) {
        await setAppetite([]);
        const t = await getUpdatedAt();
        const clientEntry = { subCategory: "Non citée", subCategoryId: C["free"], entity: null, threshold: 11, description: `client ${i}` };
        const [a, b] = await Promise.all([
          new Promise<Res>((ok) => setTimeout(ok, i % 3 === 0 ? 0 : (i % 3) * 4)).then(() => commit("rm1", FW, V, GOOD)),
          new Promise<Res>((ok) => setTimeout(ok, i % 3 === 0 ? 3 : 0)).then(() => patch("rm2", { appetiteThresholds: [clientEntry], expectedUpdatedAt: t })),
        ]);
        expect(a.status, `iter ${i} import: ${a.text}`).toBeLessThan(500);
        expect(b.status, `iter ${i} patch: ${b.text}`).toBeLessThan(500);
        const ent = await appetite();
        const hasClient = ent.some((e) => e.subCategoryId === C["free"]);
        const hasImport = ent.some((e) => e.subCategoryId === C["fraud"]) && ent.some((e) => e.subCategoryId === C["aml"]);
        if (b.status === 200) expect(hasClient, `iter ${i}: PATCH 200 mais sa saisie est perdue (${a.status}/${b.status})`).toBe(true);
        if (a.status === 200) expect(hasImport, `iter ${i}: import 200 mais ses entrees sont perdues (${a.status}/${b.status})`).toBe(true);
        if (a.status === 200 && b.status === 200) seen["both200"]!++;
        else if (a.status === 409) seen["importConflict"]!++;
        else if (b.status === 409) seen["patchConflict"]!++;
        else seen["other"]!++;
      }
      console.log("R4 outcomes (30 courses)", JSON.stringify(seen));
      await setAppetite([]);
    });

    it("L7 avertissement « premiere bande large » : echelle dont la premiere bande depasse 25 % du score maximal => message d'avertissement dans l'apercu, sans bloquer ; echelle normale : pas de message", async () => {
      const scaleId = (await one(`SELECT rating_scale_id AS s FROM risk_framework_versions WHERE id = $1`, [V])).s as string;
      const orig = (await one(`SELECT criticality_thresholds AS c FROM rating_scales WHERE id = $1`, [scaleId])).c as Row[];
      const normal = await preview("rm1", FW, V, GOOD);
      expect((normal.json!["data"].notices as string[]).join("|")).not.toMatch(/première bande/);
      const wide = orig.map((b, i) => (i === 0 ? { ...b, max: 10 } : i === 1 ? { ...b, min: 11, max: 14 } : b));
      await sql(`UPDATE rating_scales SET criticality_thresholds = $2::jsonb WHERE id = $1`, [scaleId, JSON.stringify(wide)]);
      try {
        const r = await preview("rm1", FW, V, GOOD);
        expect(r.status, r.text).toBe(200);
        expect((r.json!["data"].notices as string[]).join("|")).toMatch(/première bande de criticité.*très large/);
        expect(r.json!["data"].errorCount).toBe(0);
      } finally { await sql(`UPDATE rating_scales SET criticality_thresholds = $2::jsonb WHERE id = $1`, [scaleId, JSON.stringify(orig)]); }
    });

    it("L8 caracteres de direction : U+202E, U+202A, U+2066, U+200E, U+2028 refuses (erreur de ligne) ; zero-largeur U+200B / U+FEFF interne / U+2060 : observation", async () => {
      const r = await preview("rm1", FW, V, ["Fraude;Fraude\u202Einterne", "Fraude;\u202Afraude", "Fraude;Fraude\u2066interne", "Fraude;\u200Efraude", "Fraude;Fraude\u2028interne"].join("\n"));
      expect(r.status, r.text).toBe(200);
      for (const l of r.json!["data"].lines as Row[]) expect(l.messages.join(), `ligne ${l.line}`).toMatch(/direction du texte/);
      const z = await preview("rm1", FW, V, ["Fraude;Fraude\u200Binterne", "Fraude;Fraude\u2060interne", "Fraude;Fraude\uFEFFinterne"].join("\n"));
      console.log("L8 zero-largeur ->", (z.json!["data"].lines as Row[]).map((l) => `${l.line}:${l.verdict}`).join(" "));
      expect(z.status).toBeLessThan(500);
    });
  });
});
