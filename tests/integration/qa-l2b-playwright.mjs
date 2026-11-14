// QA conservation L2b : parcours navigateur (Chromium) contre le VRAI backend local (PostgreSQL 16 LOCAL, jamais Neon). Oracles ecrits AVANT l'execution.
//  1. Comptes : le champ Motif de la creation porte, dans son aide, le message q294 (constante GOVERNANCE_REASON_RETENTION_HINT).
//  2. IAM Roles : le paragraphe d'aide #assign-reason-help porte le message q294 et les champs motif le referencent (aria-describedby).
//  3. Processus : changement de parent d'un processus -> le champ « Motif du changement de parent » porte le message q294.
//  4. Reglages de gouvernance : le champ de duree des motifs existe ; une baisse de duree repond « en attente » avec un message juste.
//  5. Aucun message q294 sous le motif de visibilite d'un risque (RiskVisibility) : il n'est pas un motif de gouvernance.
//  6. Zero erreur JS.
// Prerequis : base grc_qa_l2bt et serveur 8137 (suite QA-L2b lancee), vite 127.0.0.1:5237. Variables : QA_API, QA_APP, QA_SHOTS.
import { checkNoErrors, finish, localApi, openSession, sleep, verdicts } from "./qa-helpers.mjs";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const API = process.env.QA_API ?? "http://127.0.0.1:8137";
const APP = process.env.QA_APP ?? "http://127.0.0.1:5237";
const SHOTS = process.env.QA_SHOTS ?? "qa-shots/l2b";
mkdirSync(SHOTS, { recursive: true });
const HINT = "N'écrivez pas d'information personnelle (santé, vie privée) : ce motif est conservé 10 ans comme preuve.";
const { check, failures } = verdicts();
const { login, api } = localApi(API, { adm: "adm@vv1.test", rm: "rm@vv1.test" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const sessions = [];
const attempt = async (name, fn) => { try { await fn(); } catch (e) { check(`${name} (exception)`, false, String(e).slice(0, 200)); } };
try {
  await login("adm"); await login("rm");
  const A = await openSession(browser, { app: APP, email: "adm@vv1.test", shots: SHOTS, who: "adm" });
  const R = await openSession(browser, { app: APP, email: "rm@vv1.test", shots: SHOTS, who: "rm" });
  sessions.push(A, R);

  await attempt("1", async () => {
    await A.go("Comptes");
    await A.page.getByRole("button", { name: /Nouveau|Créer|Ajouter/ }).first().click();
    await sleep(600);
    const field = A.page.locator("#user-reason");
    check("1.1 le champ Motif existe", (await field.count()) === 1);
    const help = await A.page.locator("form#user-form").innerText();
    check("1.2 le message q294 est affiche avec le champ", help.replace(/\s+/g, " ").includes(HINT), help.slice(-250));
    await A.shot("users");
    await A.page.keyboard.press("Escape");
  });

  await attempt("2", async () => {
    await A.go("IAM · Rôles");
    const p = A.page.locator("#assign-reason-help");
    check("2.1 le paragraphe d'aide porte le message q294", ((await p.innerText()).replace(/\s+/g, " ")).includes(HINT));
    const described = await A.page.locator("input[aria-describedby='assign-reason-help']").count();
    check("2.2 les champs motif referencent l'aide", described > 0, String(described));
    await A.shot("roles");
  });

  await attempt("3", async () => {
    await R.go("Processus");
    await R.page.getByRole("button", { name: /^Voir le détail de Sous-processus QA/ }).first().click();
    await sleep(500);
    await R.page.getByRole("button", { name: "Modifier" }).first().click();
    await sleep(500);
    const sel = R.page.locator("#proc-parent, select").filter({ has: R.page.locator("option") }).first();
    const opts = await R.page.locator("#proc-parent").locator("option").all();
    check("3.0 un select de parent existe", opts.length > 1, String(opts.length));
    const parent = R.page.locator("#proc-parent");
    const cur = await parent.inputValue();
    for (const o of opts) { const v = await o.getAttribute("value"); if (v !== cur) { await parent.selectOption(v); break; } }
    await sleep(400);
    const field = R.page.locator("#proc-move-reason");
    check("3.1 le champ Motif du changement de parent apparait", (await field.count()) === 1);
    const form = (await R.page.locator("form#process-form").innerText()).replace(/\s+/g, " ");
    check("3.2 le message q294 est affiche avec le champ", form.includes(HINT), form.slice(-250));
    await R.shot("process");
  });

  await attempt("4", async () => {
    await A.go("Réglages de gouvernance");
    const t = await A.text();
    check("4.1 la duree des motifs est affichee avec son libelle", t.includes("Conservation d'un motif de visibilité"), t.slice(0, 200));
    const btns = await A.page.getByRole("button", { name: "Modifier" }).all();
    let opened = false;
    for (const b of btns) {
      await b.click(); await sleep(400);
      if ((await A.page.locator("#gov-visibilityReasonRetentionDays").count()) === 1) { opened = true; break; }
      await A.page.keyboard.press("Escape"); await sleep(300);
    }
    await sleep(500);
    const input = A.page.locator("#gov-visibilityReasonRetentionDays");
    check("4.2 le formulaire de delais porte le champ", opened && (await input.count()) === 1, `opened=${opened}`);
    if ((await input.count()) === 1) {
      const help = (await A.page.locator("form").last().innerText()).replace(/\s+/g, " ");
      check("4.3 l'aide du champ ne se contredit pas (« vide = jamais effacé » vs « Laisser vide : non configuré »)", !(help.includes("vide = jamais effacé") && help.includes("Laisser vide : non configuré")), "double libelle present");
      await input.fill("500");
      await A.page.locator("#gov-reason, textarea, input[id*=reason]").last().fill("Test QA baisse de duree").catch(() => {});
      await A.shot("govsettings");
      await A.page.getByRole("button", { name: /Enregistrer|Confirmer|Envoyer/ }).last().click();
      await sleep(1200);
      const txt = await A.text();
      check("4.4 une modification de duree repond « en attente » (seconde personne)", /NON appliqué|en attente/i.test(txt), txt.slice(0, 250));
      check("4.5 le message d'attente ne parle pas seulement d'« allonger ou retirer » pour une BAISSE", !/Allonger ou retirer un délai est un assouplissement/.test(txt), "message inexact pour une baisse");
      await A.shot("govsettings-after");
    }
  });

  await attempt("5", async () => {
    await A.go("Ressources restreintes");
    const t = await A.text();
    check("5.1 aucun message q294 sur l'ecran des ressources restreintes", !t.includes("conservé 10 ans"));
  });

  checkNoErrors(check, sessions, "6");
} catch (e) { check(`parcours interrompu : ${String(e).slice(0, 300)}`, false); } finally { await finish(browser, failures); }
