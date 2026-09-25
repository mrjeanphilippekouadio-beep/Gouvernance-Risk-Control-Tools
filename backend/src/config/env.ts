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
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loudly — never start the server with a half-valid config.
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
