#!/bin/bash
# OUTILLAGE DE TEST (QA F7-S3). Cluster PostgreSQL 16 LOCAL jetable (jamais Neon) pour qa-f7s3-front-playwright.mjs.
# Usage : qa-f7s3-front-setup.sh up   -> initdb (si absent) + start + base grc_qa_f7s3 (migrations 001..077 par psql) + comptes
#         qa-f7s3-front-setup.sh down -> arret du cluster et suppression du dossier.
# Root : initdb/pg_ctl via setpriv (utilisateur postgres). TCP 127.0.0.1:55437 seulement.
export PGHOST=127.0.0.1 PGPORT=55437 PGUSER=postgres
D=/var/tmp/qaf7s3
BIN=/usr/lib/postgresql/16/bin
R=$(cd "$(dirname "$0")/../.." && pwd)
as_pg() { setpriv --reuid=postgres --regid=postgres --init-groups "$@"; }

if [ "$1" = "down" ]; then
  [ -d "$D/data" ] && as_pg $BIN/pg_ctl -D "$D/data" -m fast stop
  rm -rf "$D"; echo "cluster supprime"; exit 0
fi

mkdir -p "$D" && chown postgres:postgres "$D" && chmod 755 "$D"
if [ ! -d "$D/data" ]; then as_pg $BIN/initdb -D "$D/data" -A trust -U postgres >/dev/null || exit 1; fi
$BIN/pg_isready -q -h 127.0.0.1 -p $PGPORT || as_pg $BIN/pg_ctl -D "$D/data" -l "$D/pg.log" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$D" -w start >/dev/null || exit 1

psql -Atq -d postgres -c "drop database if exists grc_qa_f7s3 with (force)" -c "create database grc_qa_f7s3" || exit 1
psql -Atq -d grc_qa_f7s3 -c "create role grc_app_runtime nologin" -c "create role grc_migrator nologin" \
  -c "create table schema_migrations (filename text primary key, applied_at timestamptz not null default now())" 2>/dev/null
for f in $(ls "$R"/database/postgresql/migrations/*.sql | grep -v '\.down\.sql$' | sort); do
  psql -q -v ON_ERROR_STOP=1 -1 -d grc_qa_f7s3 -f "$f" >/dev/null 2>"$D/err.txt" || { echo "migration en echec: $f"; cat "$D/err.txt"; exit 1; }
done

GROUPS_SQL=$(cd "$R/backend" && node_modules/.bin/tsx -e '
import { FIXED_GROUP_PERMISSIONS } from "./src/domain/fixedGroupPermissions.ts";
const names: Record<string, string> = { RISK_MANAGER: "Risk Manager", RISK_COMMITTEE: "Comité", AUDIT: "Audit" };
for (const [g, p] of Object.entries(FIXED_GROUP_PERMISSIONS)) console.log(`INSERT INTO roles (tenant_id, name, permissions, system_group) SELECT id, ${"\x27"}${names[g]}${"\x27"}, ${"\x27"}{${(p as string[]).join(",")}}${"\x27"}, ${"\x27"}${g}${"\x27"} FROM tenants;`);
')
P="psql -Atq -v ON_ERROR_STOP=1 -d grc_qa_f7s3"
T=$($P -c "insert into tenants (name) values ('Tenant principal QA') returning id" | head -1)
echo "$GROUPS_SQL" | $P
u() { $P -c "insert into users (tenant_id,email,display_name,roles) values ('$T','$1','$2','{$3}') returning id"; }
# Admin : role.read + annuaire. Sans droit : aucun. Cible : droit direct + role ordinaire + groupe fixe + role desactive.
A=$(u qa-f7s3-a@f7s3.test "Admin Droits QA" "role.read,user.read")
N=$(u qa-f7s3-n@f7s3.test "Sans Droit QA" "")
C=$(u qa-f7s3-c@f7s3.test "Cible Droits QA" "risk.read")
S=$(u qa-f7s3-s@f7s3.test "Suspendu Droits QA" "risk.read")
$P -c "update users set deleted_at=now() where id='$S'"
$P -c "insert into roles (tenant_id,name,permissions) values ('$T','Analyste QA','{risk.read,control.read}')"
$P -c "insert into roles (tenant_id,name,permissions,deleted_at) values ('$T','Role desactive QA','{audit.read}',now())"
$P -c "insert into user_roles (tenant_id,role_id,user_id,granted_by) select '$T', r.id, '$C', '$A' from roles r where r.tenant_id='$T' and (r.name in ('Analyste QA','Role desactive QA') or r.system_group='RISK_COMMITTEE')"
# Autre tenant : un compte que l'admin ne doit jamais atteindre.
T2=$($P -c "insert into tenants (name) values ('Autre tenant QA') returning id" | head -1)
O=$($P -c "insert into users (tenant_id,email,display_name,roles) values ('$T2','qa-f7s3-o@f7s3.test','Autre Tenant QA','{risk.read}') returning id")
printf 'tenant=%s\nA=%s\nN=%s\nC=%s\nS=%s\nT2=%s\nO=%s\n' "$T" "$A" "$N" "$C" "$S" "$T2" "$O"
