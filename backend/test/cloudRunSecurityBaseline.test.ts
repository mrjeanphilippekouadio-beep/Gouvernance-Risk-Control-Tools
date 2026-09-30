import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "..");
const manifestPath = resolve(repoRoot, "infra/cloud-run/service.template.yaml");
const manifest = readFileSync(manifestPath, "utf8");

describe("SEC: Cloud Run production baseline", () => {
  it("uses a user-managed service identity", () => {
    expect(manifest).toMatch(/serviceAccountName:\s*grc-tools-runtime@PROJECT_ID\.iam\.gserviceaccount\.com/);
  });

  it("loads DATABASE_URL from Secret Manager", () => {
    expect(manifest).toMatch(/name:\s*DATABASE_URL[\s\S]*secretKeyRef:[\s\S]*name:\s*grc-database-url[\s\S]*key:\s*"1"/);
  });

  it("does not configure migration credentials for the runtime", () => {
    expect(manifest).not.toContain("MIGRATION_DATABASE_URL");
  });

  it("uses an immutable image digest placeholder", () => {
    expect(manifest).toMatch(/image:\s*REGION-docker\.pkg\.dev\/PROJECT_ID\/grc\/grc-backend@IMAGE_DIGEST/);
    expect(manifest).not.toMatch(/image:\s*[^\s]+:(latest|prod|production)\s*$/m);
  });

  it("defines readiness and liveness probes on the existing endpoints", () => {
    expect(manifest).toMatch(/path:\s*\/ready/);
    expect(manifest).toMatch(/path:\s*\/health/);
  });

  it("keeps the application non-secret configuration explicit", () => {
    expect(manifest).toContain("GOOGLE_OAUTH_CLIENT_ID");
    expect(manifest).toContain("CORS_ALLOWED_ORIGINS");
  });
});
