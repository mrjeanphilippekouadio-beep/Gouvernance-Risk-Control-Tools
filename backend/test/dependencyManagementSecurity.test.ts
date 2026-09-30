import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "..");
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8")) as {
  lockfileVersion: number;
  packages: Record<string, {
    version?: string;
    resolved?: string;
    integrity?: string;
    cpu?: string[];
    libc?: string[];
    os?: string[];
    optional?: boolean;
  }>;
};
const workflow = readFileSync(
  resolve(root, ".github/workflows/ci.yml"),
  "utf8",
);
const dependencyReview = readFileSync(
  resolve(root, ".github/workflows/dependency-review.yml"),
  "utf8",
);
const dependabot = readFileSync(
  resolve(root, ".github/dependabot.yml"),
  "utf8",
);
const semgrep = readFileSync(
  resolve(root, ".github/security-requirements.txt"),
  "utf8",
);

describe("SEC: dependency management", () => {
  it("keeps the committed lockfile complete for the Linux x64 CI runner", () => {
    expect(lock.lockfileVersion).toBe(3);

    const rolldown = lock.packages["frontend/node_modules/@rolldown/binding-linux-x64-gnu"];
    expect(rolldown).toMatchObject({
      version: "1.2.11",
      cpu: ["x64"],
      libc: ["glibc"],
      os: ["linux"],
      optional: true,
    });
    expect(rolldown?.resolved).toMatch(
      /registry\.npmjs\.org\/@rolldown\/binding-linux-x64-gnu\/-\/binding-linux-x64-gnu-1\.2\.11\.tgz$/,
    );
    expect(rolldown?.integrity).toMatch(/^sha512-/);

    const oxlint = lock.packages["frontend/node_modules/@oxlint/binding-linux-x64-gnu"];
    expect(oxlint).toMatchObject({
      version: "1.85.0",
      cpu: ["x64"],
      libc: ["glibc"],
      os: ["linux"],
      optional: true,
    });
    expect(oxlint?.resolved).toMatch(
      /registry\.npmjs\.org\/@oxlint\/binding-linux-x64-gnu\/-\/binding-linux-x64-gnu-1\.85\.0\.tgz$/,
    );
    expect(oxlint?.integrity).toMatch(/^sha512-/);
  });

  it("keeps vulnerability auditing blocking at high severity", () => {
    expect(workflow).toMatch(/npm audit --audit-level=high/);
    expect(workflow).toMatch(/permissions:\s*\n\s+contents:\s+read/);
  });

  it("keeps automatic update coverage for npm, Docker, Actions, and pip", () => {
    expect(dependabot).toContain('package-ecosystem: "npm"');
    expect(dependabot).toContain('package-ecosystem: "docker"');
    expect(dependabot).toContain('package-ecosystem: "github-actions"');
    expect(dependabot).toContain('package-ecosystem: "pip"');
  });

  it("pins the Semgrep scanner version instead of installing latest", () => {
    expect(semgrep.trim()).toBe("semgrep==1.178.0");
  });
});
