import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (Neon Postgres connection string, sslmode=require)"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Google is the production/default provider. Staging QA may temporarily use
  // the local provider so browser automation can authenticate deterministically.
  AUTH_PROVIDER: z.enum(["google", "local"]).default("google"),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),

  // Required only when AUTH_PROVIDER=local. Store the password hash and token
  // secret in the deployment environment, never in Git.
  LOCAL_AUTH_EMAIL: z.string().email().optional(),
  LOCAL_AUTH_PASSWORD_HASH: z.string().optional(),
  LOCAL_AUTH_TOKEN_SECRET: z.string().min(32).optional(),
  LOCAL_AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // Optional local-development compatibility. Production Cloud Run uses
  // the assigned service identity (Application Default Credentials) instead.
  GOOGLE_DRIVE_CREDENTIALS_PATH: z.string().optional(),

  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim())),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

if (env.AUTH_PROVIDER === "google" && !env.GOOGLE_OAUTH_CLIENT_ID) {
  console.error("Invalid configuration: GOOGLE_OAUTH_CLIENT_ID is required when AUTH_PROVIDER=google.");
  process.exit(1);
}

if (env.AUTH_PROVIDER === "local") {
  if (env.APP_ENV === "production") {
    console.error("Invalid production configuration: AUTH_PROVIDER=local is staging/test-only.");
    process.exit(1);
  }
  if (!env.LOCAL_AUTH_EMAIL || !env.LOCAL_AUTH_PASSWORD_HASH || !env.LOCAL_AUTH_TOKEN_SECRET) {
    console.error(
      "Invalid local-auth configuration: LOCAL_AUTH_EMAIL, LOCAL_AUTH_PASSWORD_HASH and LOCAL_AUTH_TOKEN_SECRET are required.",
    );
    process.exit(1);
  }
}

if (process.env.NODE_ENV === "production" && process.env.GOOGLE_DRIVE_CREDENTIALS_PATH) {
  console.error(
    "Invalid production configuration: GOOGLE_DRIVE_CREDENTIALS_PATH must not be set; use the Cloud Run service identity.",
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && process.env.MIGRATION_DATABASE_URL) {
  console.error(
    "Invalid production configuration: MIGRATION_DATABASE_URL must not be present in the runtime environment.",
  );
  process.exit(1);
}
