import { describe, expect, it } from "vitest";
import { hashLocalPassword, LocalIdentityProvider } from "../src/infrastructure/identity/LocalIdentityProvider.js";

const user = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "qagrctest@gmail.com",
  displayName: "GRC QA",
  roles: ["risk.read"],
  dashboardScopeMode: "GLOBAL" as const,
};

describe("LocalIdentityProvider", () => {
  it("authenticates the configured QA user and issues a verifiable token", async () => {
    const provider = new LocalIdentityProvider(
      user.email,
      hashLocalPassword("correct-password", "qa-salt"),
      "a".repeat(32),
      3600,
      async (email) => (email === user.email ? user : null),
    );

    const token = await provider.authenticate(user.email, "correct-password");
    await expect(provider.verifyToken(token)).resolves.toEqual(user);
  });

  it("rejects an invalid password", async () => {
    const provider = new LocalIdentityProvider(
      user.email,
      hashLocalPassword("correct-password", "qa-salt"),
      "a".repeat(32),
      3600,
      async () => user,
    );

    await expect(provider.authenticate(user.email, "wrong-password")).rejects.toThrow("Invalid local credentials");
  });

  it("rejects a token after its signature is changed", async () => {
    const provider = new LocalIdentityProvider(
      user.email,
      hashLocalPassword("correct-password", "qa-salt"),
      "a".repeat(32),
      3600,
      async () => user,
    );

    const token = await provider.authenticate(user.email, "correct-password");
    const tampered = `${token.slice(0, -1)}x`;
    await expect(provider.verifyToken(tampered)).rejects.toThrow("Invalid local token signature");
  });

  it("re-checks membership when a token is used", async () => {
    let active = true;
    const provider = new LocalIdentityProvider(
      user.email,
      hashLocalPassword("correct-password", "qa-salt"),
      "a".repeat(32),
      3600,
      async () => (active ? user : null),
    );

    const token = await provider.authenticate(user.email, "correct-password");
    active = false;

    await expect(provider.verifyToken(token)).rejects.toThrow("Local user is no longer authorized");
  });
});
