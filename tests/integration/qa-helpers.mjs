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
