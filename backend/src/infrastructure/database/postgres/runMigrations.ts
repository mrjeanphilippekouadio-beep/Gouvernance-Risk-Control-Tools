import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  assertDistinctDatabaseRoles,
  assertRuntimeRoleSafe,
  resolveMigrationDatabaseUrl,
  type DatabaseRoleSnapshot,
} from "./migrationDatabaseSecurity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// backend/src/infrastructure/database/postgres -> repo root -> database/postgresql/migrations
const MIGRATIONS_DIR = join(__dirname, "../../../../../database/postgresql/migrations");

const NODE_ENV = process.env.NODE_ENV ?? "development";
const RUNTIME_DATABASE_URL = process.env.DATABASE_URL;
const migrationDatabaseUrl = resolveMigrationDatabaseUrl(
  NODE_ENV,
  RUNTIME_DATABASE_URL,
  process.env.MIGRATION_DATABASE_URL,
);

const migrationPool = new Pool({
  connectionString: migrationDatabaseUrl,
  ssl: { rejectUnauthorized: true },
});

async function inspectCurrentRole(pool: Pick<Pool, "query">): Promise<DatabaseRoleSnapshot> {
  const { rows } = await pool.query<DatabaseRoleSnapshot>(`
    SELECT
      current_user AS role_name,
      r.rolsuper AS is_superuser,
      r.rolcreaterole AS can_create_role,
      r.rolcreatedb AS can_create_database,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public_schema
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);

  const role = rows[0];
  if (!role) {
    throw new Error("Production migration safety check failed: current database role could not be inspected.");
  }

  return role;
}

async function assertProductionMigrationSeparation(): Promise<void> {
  if (NODE_ENV !== "production") return;

  if (!RUNTIME_DATABASE_URL) {
    throw new Error("DATABASE_URL is required to verify the runtime role during production migrations.");
  }

  const migrationRole = await inspectCurrentRole(migrationPool);
  const runtimePool = new Pool({
    connectionString: RUNTIME_DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const runtimeRole = await inspectCurrentRole(runtimePool);
    assertDistinctDatabaseRoles(migrationRole, runtimeRole);
    assertRuntimeRoleSafe(runtimeRole);
  } finally {
    await runtimePool.end();
  }
}

async function ensureMigrationsTable(): Promise<void> {
  await migrationPool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function appliedMigrations(): Promise<Set<string>> {
  const { rows } = await migrationPool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  return new Set(rows.map((r) => r.filename));
}

async function main(): Promise<void> {
  await assertProductionMigrationSeparation();
  await ensureMigrationsTable();
  const applied = await appliedMigrations();

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const client = await migrationPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      // eslint-disable-next-line no-console
      console.log(`Applied migration: ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  await migrationPool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
