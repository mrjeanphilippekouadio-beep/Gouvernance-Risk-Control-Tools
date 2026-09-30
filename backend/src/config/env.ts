import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (Neon Postgres connection string, sslmode=require)"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1, "GOOGLE_OAUTH_CLIENT_ID is required for auth"),

  GOOGLE_DRIVE_CREDENTIALS_PATH: z
    .string()
    .min(1, "GOOGLE_DRIVE_CREDENTIALS_PATH is required (service account JSON key path)"),

  // Comma-separated list of origins the frontend is served from. The
  // browser sends a CORS preflight (OPTIONS, no Authorization header)
  // before every cross-origin GET/POST — without this, authMiddleware
  // rejects the preflight itself and the real request never fires.
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim())),

  // Optional: Telegram bot notifications (Phase A). Both unset = no-op
  // notifier, nothing breaks — this is a nice-to-have side channel, not
  // a required piece of the app.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (process.env.NODE_ENV === "production" && process.env.MIGRATION_DATABASE_URL) {
  // Migration credentials must never be injected into the long-running
  // Cloud Run runtime. They belong only to the short-lived migration job.
  console.error(
    "Invalid production configuration: MIGRATION_DATABASE_URL must not be present in the runtime environment.",
  );
  process.exit(1);
}

if (!parsed.success) {
  // Fail fast and loudly — never start the server with a half-valid config.
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
