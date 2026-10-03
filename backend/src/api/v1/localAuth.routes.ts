import { Router } from "express";
import { z } from "zod";
import type { LocalIdentityProvider } from "../../infrastructure/identity/LocalIdentityProvider.js";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function localAuthRouter(identityProvider: LocalIdentityProvider) {
  const router = Router();

  router.post("/local", async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid credentials payload" });
      return;
    }

    try {
      const token = await identityProvider.authenticate(parsed.data.email, parsed.data.password);
      res.json({ accessToken: token, tokenType: "Bearer" });
    } catch {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  return router;
}
