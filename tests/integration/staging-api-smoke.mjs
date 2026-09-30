const baseUrl = process.env.GRC_STAGING_API_BASE_URL?.trim();
const token = process.env.GRC_STAGING_BEARER_TOKEN?.trim();
const controlId = process.env.GRC_STAGING_CONTROL_ID?.trim();
const evidenceId = process.env.GRC_STAGING_EVIDENCE_ID?.trim();

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

if (!baseUrl || !token) {
  console.error("Missing required GitHub Actions secrets: GRC_STAGING_API_BASE_URL and/or GRC_STAGING_BEARER_TOKEN.");
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(baseUrl);
} catch {
  console.error("GRC_STAGING_API_BASE_URL must be a valid absolute URL.");
  process.exit(2);
}
if (parsed.protocol !== "https:") {
  console.error("Refusing to send a bearer token to a non-HTTPS endpoint.");
  process.exit(2);
}
const base = parsed.toString().replace(/\/$/, "");

async function request(path, { authenticated = true } = {}) {
  const headers = { accept: "application/json" };
  if (authenticated) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method: "GET",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.text();
  return { status: response.status, body };
}

async function check(name, path, expectedStatuses, options = {}) {
  try {
    const result = await request(path, options);
    if (!expectedStatuses.includes(result.status)) {
      fail(`${name}: HTTP ${result.status}; expected ${expectedStatuses.join(" or ")}. Response body omitted to avoid leaking data.`);
      return;
    }
    if (options.requireDataEnvelope) {
      let payload;
      try { payload = JSON.parse(result.body); } catch {
        fail(`${name}: response was not valid JSON.`);
        return;
      }
      if (!payload || !Object.prototype.hasOwnProperty.call(payload, "data")) {
        fail(`${name}: expected JSON response with a top-level "data" property.`);
        return;
      }
    }
    console.log(`PASS: ${name} (HTTP ${result.status})`);
  } catch (error) {
    fail(`${name}: request failed (${error?.name ?? "unknown error"}).`);
  }
}

await check("Health endpoint", "/health", [200]);
await check("Readiness/database endpoint", "/ready", [200]);
await check("Action plans API (read-only list)", "/api/v1/actions", [200], { requireDataEnvelope: true });
await check("Controls API (read-only list)", "/api/v1/controls", [200], { requireDataEnvelope: true });
await check("Audit missions API (read-only list)", "/api/v1/audit-missions", [200], { requireDataEnvelope: true });
await check("Audit findings API (read-only list)", "/api/v1/findings", [200], { requireDataEnvelope: true });
await check("Control executions API (read-only list)", "/api/v1/executions", [200]);
await check("Control effectiveness API (read-only list)", "/api/v1/effectiveness", [200]);
await check("Evidence API (read-only list)", "/api/v1/evidences", [200]);

// Authentication negative test: must not expose the protected action-plan list without a token.
await check("Action plans reject missing authentication", "/api/v1/actions", [401, 403], { authenticated: false });

if (process.exitCode) {
  console.error("Staging API smoke checks failed. No write requests were sent.");
} else {
  console.log("All staging API smoke checks passed. No write requests were sent.");
}
