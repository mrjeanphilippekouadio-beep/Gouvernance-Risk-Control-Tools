#!/bin/bash
# OUTILLAGE DE TEST (QA suites2). Base jetable LOCALE pour qa-suites2-front-playwright.mjs. Jamais Neon.
# Prerequis : cluster PG16 local (port 55434) avec le modele `grc_qa_f5a_tpl` (migrations 001..075, voir docs/qa/qa-f5a-front-2026-10-27.md).
# Recree `grc_qa_s2f` : modele + migrations 076 et 077, groupes fixes Risk Manager / Comite / Audit (droits de FIXED_GROUP_PERMISSIONS), 6 comptes.
# q186 (077) : les droits de decision ne passent JAMAIS par users.roles ; A et B les tiennent comme membres du Comite (Risk Manager reste vacant, q178).
export PGHOST=${PGHOST:-127.0.0.1} PGPORT=${PGPORT:-55434} PGUSER=${PGUSER:-postgres}
R=$(cd "$(dirname "$0")/../.." && pwd)
GROUPS_SQL=$(cd "$R/backend" && node_modules/.bin/tsx -e '
import { FIXED_GROUP_PERMISSIONS } from "./src/domain/fixedGroupPermissions.ts";
const names: Record<string, string> = { RISK_MANAGER: "Risk Manager", RISK_COMMITTEE: "Comité", AUDIT: "Audit" };
for (const [g, p] of Object.entries(FIXED_GROUP_PERMISSIONS)) console.log(`INSERT INTO roles (tenant_id, name, permissions, system_group) SELECT id, ${"\x27"}${names[g]}${"\x27"}, ${"\x27"}{${(p as string[]).join(",")}}${"\x27"}, ${"\x27"}${g}${"\x27"} FROM tenants;`);
')
psql -Atq -c "drop database if exists grc_qa_s2f with (force)" -c "create database grc_qa_s2f template grc_qa_f5a_tpl" || exit 1
for m in 076_governance_delay_requests 077_governance_rights_ordinary_cleanup; do
  psql -q -v ON_ERROR_STOP=1 -d grc_qa_s2f -f "$R/database/postgresql/migrations/$m.sql" 2>&1 | grep -v NOTICE
done
psql -q -d grc_qa_s2f -c "set session_replication_role=replica; delete from users;"
echo "$GROUPS_SQL" | psql -q -d grc_qa_s2f
T=$(psql -Atq -d grc_qa_s2f -c "select id from tenants limit 1")
u() { psql -Atq -d grc_qa_s2f -c "insert into users (tenant_id,email,display_name,roles) values ('$T','$1','$2','{$3}')"; }
u qa-s2-a@s2.test "Admin Gouv QA" "config.read,config.governancedelays.set,role.read,role.update,rolegroup.audit.update"
u qa-s2-b@s2.test "Approbateur QA" "config.read"
u qa-s2-e@s2.test "Lecteur Droits QA" "config.read,role.read"
u qa-s2-c@s2.test "Missions QA" "audit.mission.read,audit.mission.create"
u qa-s2-d@s2.test "Autre Compte QA" "audit.mission.read"
u qa-s2-f@s2.test "Designations QA" "designation.manage"
# Membres du Comite (droits de decision, dont config.selfvalidation.approve) : A et B.
psql -Atq -d grc_qa_s2f -c "insert into user_roles (tenant_id,role_id,user_id,granted_by) select '$T', r.id, u.id, u.id from roles r, users u where r.tenant_id='$T' and r.system_group='RISK_COMMITTEE' and u.email in ('qa-s2-a@s2.test','qa-s2-b@s2.test')"
# q178 (Codex PR #199) : Risk Manager vacant depuis 70 jours (> 60 par defaut) -> bandeau « depassee » sur Designations.
psql -Atq -d grc_qa_s2f -c "insert into audit_log (tenant_id,user_id,entity_type,entity_id,action,request_id,governance_exception,\"timestamp\") select '$T',id,'Role',gen_random_uuid(),'ROLE_CHANGE','qa-s2-vac','riskManager.vacancy',now() - interval '70 days' from users where email='qa-s2-a@s2.test'"
echo "tenant=$T"
