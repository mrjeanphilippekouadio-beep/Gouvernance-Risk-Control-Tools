import "dotenv/config";
import { z } from "zod";

const LocalAuthUserSchema = z.object({
  email: z.string().email(),
  passwordHash: z.string().min(1),
});

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
  LOCAL_AUTH_USERS_JSON: z.string().optional(),
  // Legacy single-account variables remain supported temporarily.
  LOCAL_AUTH_EMAIL: z.string().email().optional(),
  LOCAL_AUTH_PASSWORD_HASH: z.string().optional(),
  LOCAL_AUTH_TOKEN_SECRET: z.string().min(32).optional(),
  LOCAL_AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // Document storage. Only Google Drive is implemented; swap by adding a
  // case in server.ts, services stay untouched.
  DOCUMENT_STORAGE_PROVIDER: z.enum(["google_drive"]).default("google_drive"),
  // Shared Drive folders: active evidence / "deleted" evidence (moved, never trashed).
  DRIVE_ACTIVE_FOLDER_ID: z.string().min(1).optional(),
  DRIVE_DELETED_FOLDER_ID: z.string().min(1).optional(),
  // adc = Application Default Credentials (Cloud Run identity);
  // key_file = service-account JSON key (local dev, or Render secret file).
  GOOGLE_DRIVE_AUTH_MODE: z.enum(["adc", "key_file"]).default("adc"),
  GOOGLE_DRIVE_CREDENTIALS_PATH: z.string().min(1).optional(),

  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim())),

  // Reverse proxies between the client and the app, used to resolve the real
  // client IP (Express "trust proxy"). 0 = no proxy (local dev). Render =
  // Cloudflare + Render proxy + in-container proxy = 3.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export function getLocalAuthUsers(): Array<{ email: string; passwordHash: string }> {
  if (env.LOCAL_AUTH_USERS_JSON) {
    let raw: unknown;
    try {
      raw = JSON.parse(env.LOCAL_AUTH_USERS_JSON);
    } catch {
      throw new Error("Invalid local-auth configuration: LOCAL_AUTH_USERS_JSON must contain valid JSON.");
    }
    const parsedUsers = z.array(LocalAuthUserSchema).min(1).safeParse(raw);
    if (!parsedUsers.success) {
      throw new Error("Invalid local-auth configuration: LOCAL_AUTH_USERS_JSON must be a non-empty JSON array of {email,passwordHash}.");
    }
    return parsedUsers.data;
  }
  if (env.LOCAL_AUTH_EMAIL && env.LOCAL_AUTH_PASSWORD_HASH) {
    return [{ email: env.LOCAL_AUTH_EMAIL, passwordHash: env.LOCAL_AUTH_PASSWORD_HASH }];
  }
  throw new Error("Invalid local-auth configuration: configure LOCAL_AUTH_USERS_JSON or the legacy LOCAL_AUTH_EMAIL + LOCAL_AUTH_PASSWORD_HASH pair.");
}

if (env.AUTH_PROVIDER === "google" && !env.GOOGLE_OAUTH_CLIENT_ID) {
  console.error("Invalid configuration: GOOGLE_OAUTH_CLIENT_ID is required when AUTH_PROVIDER=google.");
  process.exit(1);
}

if (env.AUTH_PROVIDER === "local") {
  if (env.APP_ENV === "production") {
    console.error("Invalid production configuration: AUTH_PROVIDER=local is staging/test-only.");
    process.exit(1);
  }
  const hasMultiUserConfig = Boolean(env.LOCAL_AUTH_USERS_JSON);
  const hasLegacySingleUserConfig = Boolean(env.LOCAL_AUTH_EMAIL && env.LOCAL_AUTH_PASSWORD_HASH);

  if ((!hasMultiUserConfig && !hasLegacySingleUserConfig) || !env.LOCAL_AUTH_TOKEN_SECRET) {
    console.error(
      "Invalid local-auth configuration: configure LOCAL_AUTH_USERS_JSON or the legacy LOCAL_AUTH_EMAIL + LOCAL_AUTH_PASSWORD_HASH pair, plus LOCAL_AUTH_TOKEN_SECRET.",
    );
    process.exit(1);
  }
}

if (env.GOOGLE_DRIVE_AUTH_MODE === "key_file" && !env.GOOGLE_DRIVE_CREDENTIALS_PATH) {
  console.error("Invalid configuration: GOOGLE_DRIVE_CREDENTIALS_PATH is required when GOOGLE_DRIVE_AUTH_MODE=key_file.");
  process.exit(1);
}

if (
  process.env.NODE_ENV === "production" &&
  env.GOOGLE_DRIVE_AUTH_MODE === "adc" &&
  env.GOOGLE_DRIVE_CREDENTIALS_PATH
) {
  console.error(
    "Invalid production configuration: GOOGLE_DRIVE_CREDENTIALS_PATH must not be set with GOOGLE_DRIVE_AUTH_MODE=adc; set GOOGLE_DRIVE_AUTH_MODE=key_file to use a key file.",
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && process.env.MIGRATION_DATABASE_URL) {
  console.error(
    "Invalid production configuration: MIGRATION_DATABASE_URL must not be present in the runtime environment.",
  );
  process.exit(1);
}
