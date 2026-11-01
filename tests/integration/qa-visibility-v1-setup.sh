#!/bin/bash
# OUTILLAGE DE TEST (QA visibility V1). Cluster PostgreSQL 16 LOCAL jetable (jamais Neon), TCP 127.0.0.1:55442 seulement.
# Usage : qa-visibility-v1-setup.sh up [base]  -> cluster + base (defaut grc_qa_vv1) : migrations 001..082 + groupes fixes + jeu qa-visibility-v1-seed.sql
#         qa-visibility-v1-setup.sh down       -> arret du cluster et suppression du dossier.
export PGHOST=127.0.0.1 PGPORT=55442 PGUSER=postgres
D=/var/tmp/qavisv1
BIN=/usr/lib/postgresql/16/bin
R=$(cd "$(dirname "$0")/../.." && pwd)
DB=${2:-grc_qa_vv1}
as_pg() { setpriv --reuid=postgres --regid=postgres --init-groups "$@"; }
if [[ "$1" = "down" ]]; then
  [[ -d "$D/data" ]] && as_pg $BIN/pg_ctl -D "$D/data" -m fast stop
  rm -rf "$D"; echo "cluster supprime"; exit 0
fi
mkdir -p "$D/sock" && chown -R postgres:postgres "$D" && chmod 755 "$D"
[[ -d "$D/data" ]] || as_pg $BIN/initdb -D "$D/data" -A trust -U postgres >/dev/null || exit 1
$BIN/pg_isready -q -h 127.0.0.1 -p $PGPORT || as_pg $BIN/pg_ctl -D "$D/data" -l "$D/pg.log" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$D/sock" -w start >/dev/null || exit 1
P="/usr/bin/psql -X -q -v ON_ERROR_STOP=1"
$P -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" || exit 1
$P -d $DB -c "create role grc_app_runtime nologin" 2>/dev/null
$P -d $DB -c "create role grc_migrator nologin" 2>/dev/null
$P -d $DB -c "create table schema_migrations (filename text primary key, applied_at timestamptz not null default now())" || exit 1
for f in $(ls "$R"/database/postgresql/migrations/*.sql | grep -v '\.down\.sql$' | sort); do
  $P -1 -d $DB -f "$f" >/dev/null 2>"$D/err.txt" || { echo "migration en echec: $f"; cat "$D/err.txt"; exit 1; }
done
$P -d $DB -c "insert into tenants (id, name) values ('aaaaaaaa-0000-4000-8000-000000000001','Tenant QA V1')"
(cd "$R/backend" && node_modules/.bin/tsx -e '
import { FIXED_GROUP_PERMISSIONS } from "./src/domain/fixedGroupPermissions.ts";
const names: Record<string, string> = { RISK_MANAGER: "Risk Manager", RISK_COMMITTEE: "Comité", AUDIT: "Audit" };
const q = String.fromCharCode(39);
for (const [g, p] of Object.entries(FIXED_GROUP_PERMISSIONS)) console.log("INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES (" + q + "aaaaaaaa-0000-4000-8000-000000000001" + q + ", " + q + names[g] + q + ", " + q + "{" + (p as string[]).join(",") + "}" + q + ", " + q + g + q + ");");
') | $P -d $DB || exit 1
$P -d $DB -f "$R/tests/integration/qa-visibility-v1-seed.sql" || exit 1
echo "base $DB prete"
