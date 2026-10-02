# Staging API integration checks

This workflow runs manually from GitHub Actions and performs **read-only** HTTP checks against a staging deployment. It does not create, update, escalate, close, or delete records.

## Required repository Actions secrets

Configure these under **Settings → Secrets and variables → Actions**:

- `GRC_STAGING_API_BASE_URL`: HTTPS base URL of the **staging API** (for example, the origin hosting the backend; do not include a route such as `/api/v1`).
- `GRC_STAGING_BEARER_TOKEN`: short-lived or dedicated test-user bearer token with read access to action plans, controls, audit missions, findings, executions, effectiveness, and evidence.
- `GRC_STAGING_CONTROL_ID`: ID of an existing control in the staging tenant, visible to the test user.
- `GRC_STAGING_EVIDENCE_ID`: ID of an existing evidence record in the staging tenant, visible to the test user.

Never commit the token or paste it into source files, issues, pull requests, or chat. Do not use a production URL or production token.

## Run

1. Add both secrets in the repository settings.
2. Open **Actions → Staging API integration smoke checks → Run workflow**.
3. Select the intended branch and run it.
4. Review the job summary/log for each endpoint result. Response bodies are intentionally not printed.

## What is checked

- `GET /health` returns HTTP 200.
- `GET /ready` returns HTTP 200 (database readiness).
- Authenticated read-only list requests return HTTP 200 and JSON with a top-level `data` property for:
  - `/api/v1/actions`
  - `/api/v1/controls`
  - `/api/v1/audit-missions`
  - `/api/v1/findings`
- Authenticated read-only list requests return HTTP 200 with a top-level `data` property for `/api/v1/executions?controlId=...` and `/api/v1/effectiveness?controlId=...`, using the configured staging control ID.
- Authenticated read-only evidence URL lookup returns HTTP 200 with a top-level `data` property for `/api/v1/evidences/{evidenceId}/url`, using the configured staging evidence ID.
- `GET /api/v1/actions` without a token returns HTTP 401 or 403.

## Limitations

These checks validate reachability, readiness, authentication enforcement, and basic response contracts. They do **not** prove create/update/close lifecycle behavior, role-specific authorization, tenant isolation, file upload, or frontend browser flows. Those require dedicated disposable staging fixtures and additional tests. A 403 on a feature route may indicate the test user lacks permission or the module is disabled; investigate rather than weakening the assertion.

The workflow refuses non-HTTPS URLs so it does not send the bearer token over plaintext HTTP.
