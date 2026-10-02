import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), "../.github/workflows/ci.yml"),
  "utf8",
);

describe("SEC: GitHub Actions least privilege", () => {
  it("defaults the GITHUB_TOKEN to read-only repository contents", () => {
    expect(workflow).toMatch(/permissions:\s*\n\s+contents:\s+read/);
    expect(workflow).not.toContain("write-all");
    expect(workflow).not.toContain("read-all");
  });

  it("uses the Node 24-compatible action lines", () => {
    expect(workflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    );
    expect(workflow).toContain(
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
    );
    expect(workflow).toContain(
      "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0",
    );
    expect(workflow).toContain(
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
    );
  });

  it("does not grant pull request, issue, security-event, or id-token writes", () => {
    expect(workflow).not.toMatch(/pull-requests:\s*write/);
    expect(workflow).not.toMatch(/issues:\s*write/);
    expect(workflow).not.toMatch(/security-events:\s*write/);
    expect(workflow).not.toMatch(/id-token:\s*write/);
  });

  it("does not require Gitleaks PR write access", () => {
    expect(workflow).toMatch(/GITLEAKS_ENABLE_COMMENTS:\s*"false"/);
  });

  it("keeps production credentials out of CI", () => {
    expect(workflow).not.toContain("DATABASE_URL");
    expect(workflow).not.toContain("MIGRATION_DATABASE_URL");
    expect(workflow).not.toContain("GOOGLE_DRIVE_CREDENTIALS_PATH");
  });
});
