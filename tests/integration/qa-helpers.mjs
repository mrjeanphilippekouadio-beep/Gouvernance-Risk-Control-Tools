// OUTILLAGE DE TEST (QA navigateur). Fonctions communes aux parcours Playwright : verdicts, connexion locale, appels API.
// Jamais charge par l'application.

/** Verdict PASS / FAIL compté ; `failures()` donne le nombre d'échecs pour le code de sortie. */
export function verdicts() {
  let count = 0;
  const check = (name, ok, detail = "") => {
    if (!ok) count++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
  };
  return { check, failures: () => count };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Connexion par le fournisseur d'identité local (AUTH_PROVIDER=local) et appels JSON authentifiés. */
export function localApi(apiBase, emails) {
  const TOK = {};
  async function login(who) {
    const r = await fetch(`${apiBase}/api/v1/auth/local`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: emails[who], password: "whatever" }),
    });
    TOK[who] = (await r.json()).accessToken;
  }
  async function api(who, method, path, body) {
    const r = await fetch(`${apiBase}/api/v1${path}`, {
      method, headers: { "content-type": "application/json", authorization: `Bearer ${TOK[who]}` }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  }
  return { TOK, login, api };
}

export const norm = (s) => s.replace(/\s+/g, " ").trim();

/**
 * Session navigateur des parcours QA visibilite (V2bis, V3) : connexion locale, entrees du menu en accordeon,
 * texte de <main>, captures. `browser` est un chromium Playwright deja lance.
 */
export async function openSession(browser, { app, email, shots, who }) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  const page = await context.newPage();
  const st = { page, context, consoleErrors: [], jsErrors: [] };
  page.on("pageerror", (e) => st.jsErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") st.consoleErrors.push(m.text()); });
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await page.goto(app);
  await page.getByLabel("Adresse e-mail QA").fill(email);
  await page.getByLabel("Mot de passe QA").fill("whatever");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await nav.waitFor();
  await sleep(800);
  // le menu est un accordeon : on ouvre les groupes un a un jusqu'a trouver l'entree
  const find = async (label) => {
    const entry = nav.getByRole("button", { name: new RegExp(`^${label}`) });
    if ((await entry.count()) > 0 && (await entry.first().isVisible())) return entry.first();
    for (const g of await nav.locator("button.sidebar-group-toggle").all()) {
      if ((await g.getAttribute("aria-expanded")) !== "true") await g.click();
      if ((await entry.count()) > 0 && (await entry.first().isVisible())) return entry.first();
    }
    return null;
  };
  st.hasEntry = async (label) => (await find(label)) !== null;
  st.go = async (label) => { const e = await find(label); await e.click(); await sleep(1500); };
  st.text = async () => norm(await page.locator("main").innerText());
  st.shot = (name) => page.screenshot({ path: `${shots}/${who}-${name}.png`, fullPage: true });
  return st;
}

/** Dernieres verifications d'un parcours : aucune erreur JS, aucune erreur console imprevue (hors 4xx attendus). */
export function checkNoErrors(check, sessions, prefix) {
  const js = sessions.flatMap((s) => s.jsErrors);
  check(`${prefix}.1 aucune erreur JS`, js.length === 0, js.join(" | ").slice(0, 200));
  const con = sessions.flatMap((s) => s.consoleErrors).filter((x) => !/40[0-9]|Failed to load resource/.test(x));
  check(`${prefix}.2 aucune erreur console imprevue`, con.length === 0, con.join(" | ").slice(0, 300));
}

/** Fin de parcours : ferme le navigateur, affiche le nombre d'echecs et sort avec le bon code. */
export async function finish(browser, failures) {
  await browser.close();
  console.log(`\nECHECS : ${failures()}`);
  process.exit(failures() ? 1 : 0);
}
