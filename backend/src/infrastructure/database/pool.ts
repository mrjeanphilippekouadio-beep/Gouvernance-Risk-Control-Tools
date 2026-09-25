import { Pool } from "pg";
import { env } from "../../config/env.js";

/**
 * Single shared connection pool to Neon Postgres. Neon requires SSL;
 * connection string comes only from the environment (never hard-coded).
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: env.DATABASE_POOL_MAX,
});

pool.on("error", (err) => {
  // A backend-level pool error must not crash the whole process silently.
  // eslint-disable-next-line no-console
  console.error("Unexpected error on idle Postgres client", err);
});
