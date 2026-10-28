#!/bin/bash
# OUTILLAGE DE TEST (QA droits par ligne de defense, q188/q189/q200). Cluster PostgreSQL 16 LOCAL jetable (jamais Neon).
# Usage : qa-rights-lines-setup.sh up   -> initdb (si absent) + start + base grc_qa_rl (migrations 001..079 par psql) + comptes
#         qa-rights-lines-setup.sh down -> arret du cluster et suppression du dossier.
# Root : initdb/pg_ctl via setpriv. TCP 127.0.0.1:55438 seulement. Sortie : identifiants (cle=valeur).
export PGHOST=127.0.0.1 PGPORT=55438 PGUSER=postgres
D=/var/tmp/qarl
BIN=/usr/lib/postgresql/16/bin
PSQL=/usr/bin/psql
R=$(cd "$(dirname "$0")/../.." && pwd)
as_pg() { setpriv --reuid=postgres --regid=postgres --init-groups "$@"; }

if [[ "$1" == "down" ]]; then
  [[ -d "$D/data" ]] && as_pg $BIN/pg_ctl -D "$D/data" -m fast stop
  rm -rf "$D"; echo "cluster supprime"; exit 0
fi

mkdir -p "$D" && chown postgres:postgres "$D" && chmod 755 "$D"
if [[ ! -d "$D/data" ]]; then as_pg $BIN/initdb -D "$D/data" -A trust -U postgres >/dev/null || exit 1; fi
$BIN/pg_isready -q -h 127.0.0.1 -p $PGPORT || as_pg $BIN/pg_ctl -D "$D/data" -l "$D/pg.log" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$D" -w start >/dev/null || exit 1

$PSQL -Atq -d postgres -c "drop database if exists grc_qa_rl with (force)" -c "create database grc_qa_rl" || exit 1
$PSQL -Atq -d grc_qa_rl -c "create role grc_app_runtime nologin" -c "create role grc_migrator nologin" \
  -c "create table schema_migrations (filename text primary key, applied_at timestamptz not null default now())" 2>/dev/null
for f in $(ls "$R"/database/postgresql/migrations/*.sql | grep -v '\.down\.sql$' | sort); do
  $PSQL -q -v ON_ERROR_STOP=1 -1 -d grc_qa_rl -f "$f" >/dev/null 2>"$D/err.txt" || { echo "migration en echec: $f"; cat "$D/err.txt"; exit 1; }
done

GROUPS_SQL=$(cd "$R/backend" && node_modules/.bin/tsx -e '
import { FIXED_GROUP_PERMISSIONS } from "./src/domain/fixedGroupPermissions.ts";
const names: Record<string, string> = { RISK_MANAGER: "Risk Manager", RISK_COMMITTEE: "Comité", AUDIT: "Audit" };
for (const [g, p] of Object.entries(FIXED_GROUP_PERMISSIONS)) console.log(`INSERT INTO roles (tenant_id, name, permissions, system_group) SELECT id, ${"\x27"}${names[g]}${"\x27"}, ${"\x27"}{${(p as string[]).join(",")}}${"\x27"}, ${"\x27"}${g}${"\x27"} FROM tenants;`);
')
P="$PSQL -Atq -v ON_ERROR_STOP=1 -d grc_qa_rl"
T=$($P -c "insert into tenants (name) values ('Tenant principal QA') returning id" | head -1)
T2=$($P -c "insert into tenants (name) values ('Autre tenant QA') returning id" | head -1)
echo "$GROUPS_SQL" | $P
u() { $P -c "insert into users (tenant_id,email,display_name,roles) values ('$T','$1@rl.test','$2','{$3}') returning id" | head -1; }
seat() { $P -c "insert into user_roles (tenant_id,role_id,user_id,granted_by) select '$T', r.id, '$2', '$3' from roles r where r.tenant_id='$T' and $1"; }
ADM=$(u adm "Admin Droits" "role.read,role.assign")
RM1=$(u rm1 "Manager Un" "");   seat "r.system_group='RISK_MANAGER'" "$RM1" "$ADM"
RM2=$(u rm2 "Manager Deux" ""); seat "r.system_group='RISK_MANAGER'" "$RM2" "$ADM"
COM=$(u com "Comite Membre" "role.read"); seat "r.system_group='RISK_COMMITTEE'" "$COM" "$ADM"
COM0=$(u com0 "Comite Sans Lecture" ""); seat "r.system_group='RISK_COMMITTEE'" "$COM0" "$ADM"
AUD=$(u aud "Auditeur Interne" "role.read"); seat "r.system_group='AUDIT'" "$AUD" "$ADM"
STF=$(u stf "Agent Premiere Ligne" "")
$P -c "insert into roles (tenant_id,name,permissions) values ('$T','Analyste QA','{risk.read}'),('$T','Administrateurs QA','{role.update,role.read}')"
seat "r.name='Analyste QA'" "$STF" "$ADM"
ROA=$(u roa "Admin Par Role" ""); seat "r.name='Administrateurs QA'" "$ROA" "$ADM"
# Autre tenant : un Risk Manager et un auditeur que personne du premier tenant ne doit atteindre.
O=$($P -c "insert into users (tenant_id,email,display_name,roles) values ('$T2','oth@rl.test','Autre Tenant','{role.read,role.assign}') returning id" | head -1)
printf 'tenant=%s\nADM=%s\nRM1=%s\nRM2=%s\nCOM=%s\nCOM0=%s\nAUD=%s\nSTF=%s\nROA=%s\nT2=%s\nO=%s\n' "$T" "$ADM" "$RM1" "$RM2" "$COM" "$COM0" "$AUD" "$STF" "$ROA" "$T2" "$O"
