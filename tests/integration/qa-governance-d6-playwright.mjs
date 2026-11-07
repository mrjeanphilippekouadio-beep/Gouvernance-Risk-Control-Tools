// QA gouvernance, lot D6 (R5 « Vos données ») : parcours navigateur court (Chromium) contre le VRAI backend (tsx, PostgreSQL 16 LOCAL, fournisseur local,
// jamais Neon). Jeu : qa-visibility-v2-setup.sh (12 comptes <nom>@vv1.test). Oracles ecrits AVANT l'execution.
//
// ORACLES
//  1. Tout compte connecte (rm, et out sans aucun droit) ouvre « Vos données » depuis le menu de session (en haut a droite) : titre « Vos données de compte »,
//     les six paragraphes du texte (Ce qui est enregistré, Pourquoi, Qui peut voir quoi, Durée, Base légale, Vos droits), sans accolade restante.
//  2. Duree par defaut (1826 jours) : « conservée 5 ans après la fin de votre compte ». Le contact DPO n'est jamais invente : « à renseigner par l'administrateur ».
//  3. La duree suit la configuration du client : 1000 => « 1000 jours », 730 => « 2 ans », 400 => « 400 jours » (plancher 365, DECISION-115), NULL => « sans limite de durée fixée par votre organisation » sans « puis effacée » (QA-D6-03).
//  4. L'API /privacy/notice rend la meme duree que l'ecran ; sans jeton elle refuse (401).
//  5. zero erreur JS, aucune erreur console imprevue.
//
// Prerequis : qa-visibility-v2-setup.sh up grc_qa_gd6p ; QA_PORT=8098 QA_DB=grc_qa_gd6p QA_CORS=http://127.0.0.1:5198 qa-visibility-v2-server.sh start ;
// vite 127.0.0.1:5198 (VITE_AUTH_PROVIDER=local, VITE_API_BASE_URL=http://127.0.0.1:8098). Variables : QA_API, QA_APP, QA_SHOTS, QA_DB.
import { checkNoErrors, finish, localApi, openSession, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8098";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5198";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/governance-d6";
mkdirSync(SHOTS, { recursive: true });
const PG = ["-h", "127.0.0.1", "-p", "55442", "-U", "postgres", "-d", process.env.QA_DB ?? "grc_qa_gd6p", "-Atq"];
const sql = (q) => execFileSync("/usr/bin/psql", [...PG, "-c", q], { encoding: "utf8" }).trim();
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const NAMES = ["rm", "out"];
const EMAIL = Object.fromEntries(NAMES.map((n) => [n, `${n}@vv1.test`]));
const { check, failures } = verdicts();
const { login, api } = localApi(API, EMAIL);
const setDays = (v) => sql(`insert into configs (tenant_id) values ('${T}') on conflict (tenant_id) do nothing; update configs set last_seen_retention_days = ${v} where tenant_id = '${T}'`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const open = (who) => openSession(browser, { app: APP, email: EMAIL[who], shots: SHOTS, who });
/** Ouvre « Vos données » par le menu de session ; l'ecran est recharge a chaque ouverture. */
async function myData(s) {
  if ((await s.text()).includes("Vos données de compte")) await s.go("Registre"); // quitter l'ecran : le menu ne recharge pas l'ecran deja ouvert
  await s.page.getByRole("button", { name: "Ouvrir les actions de session" }).click();
  await s.page.getByRole("menuitem", { name: /Vos données/ }).click();
  await sleep(1200);
  return s.text();
}

try {
  for (const w of NAMES) await login(w);
  setDays("1826");
  const R = await open("rm");
  const t1 = await myData(R);
  await R.shot("mydata-default");
  check("1.1 rm : titre « Vos données de compte »", t1.includes("Vos données de compte"), t1.slice(0, 120));
  for (const k of ["Ce qui est enregistré", "Pourquoi", "Qui peut voir quoi", "Durée", "Base légale", "Vos droits"]) check(`1.2 rm : paragraphe « ${k} »`, t1.includes(k));
  check("1.3 aucune accolade de variable restante", !/[{}]/.test(t1), t1.slice(0, 80));
  check("2.1 duree par defaut : « conservée 5 ans après la fin de votre compte »", t1.includes("conservée 5 ans après la fin de votre compte"));
  check("2.2 contact DPO non invente : « à renseigner par l'administrateur »", t1.includes("à renseigner par l'administrateur"));

  const O = await open("out");
  const t2 = await myData(O);
  check("1.4 out (aucun droit) ouvre aussi « Vos données » avec le meme texte", t2.includes("Vos données de compte") && t2.includes("conservée 5 ans"), t2.slice(0, 120));

  for (const [days, expected] of [[1000, "conservée 1000 jours après"], [730, "conservée 2 ans après"], [400, "conservée 400 jours après"], ["null", "conservée sans limite de durée fixée par votre organisation."]]) {
    setDays(days);
    const t = await myData(R);
    check(`3.${days} duree ${days} => « ${expected} »`, t.includes(expected), t.slice(t.indexOf("Durée"), t.indexOf("Durée") + 120));
    const api1 = (await api("rm", "GET", "/privacy/notice")).json?.data;
    check(`4.${days} l'API rend la meme duree (${api1?.lastSeenRetentionDays})`, (days === "null" ? api1?.lastSeenRetentionDays === null : api1?.lastSeenRetentionDays === days) && api1?.dpoContact === null);
  }
  await R.shot("mydata-null");
  const anon = await fetch(`${API}/api/v1/privacy/notice`);
  check("4.9 sans jeton : 401", anon.status === 401);

  checkNoErrors(check, [R, O], "5");
} catch (e) {
  check("exception du script", false, String(e).slice(0, 600));
} finally {
  await finish(browser, failures);
}
