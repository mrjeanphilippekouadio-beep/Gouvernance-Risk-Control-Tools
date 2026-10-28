#!/bin/bash
# OUTILLAGE DE TEST (QA F7-S6). Reutilise le cluster PostgreSQL 16 LOCAL jetable de qa-f7s3-front-setup.sh (jamais Neon)
# et y ajoute les comptes KRI. Usage : qa-f7s6-front-setup.sh up | down  (down = arret + suppression du cluster).
D=$(cd "$(dirname "$0")" && pwd)
[[ "$1" = "down" ]] && exec bash "$D/qa-f7s3-front-setup.sh" down
bash "$D/qa-f7s3-front-setup.sh" up >/dev/null || exit 1
P="/usr/bin/psql -h 127.0.0.1 -p 55437 -U postgres -d grc_qa_f7s3 -Atq -v ON_ERROR_STOP=1"
T=$($P -c "select id from tenants where name='Tenant principal QA'")
T2=$($P -c "select id from tenants where name='Autre tenant QA'")
u() { $P -c "insert into users (tenant_id,email,display_name,roles) values ('$1','$2','$3','{$4}')"; }
# M : tous droits KRI + lecture/creation risques et departements. L : lecture seule. U : kri.update sans kri.delete. X : autre tenant.
u "$T" qa-f7s6-m@f7s6.test "Manager KRI QA" "kri.read,kri.create,kri.update,kri.delete,risk.read,risk.create,risk.delete,department.read,department.create"
u "$T" qa-f7s6-l@f7s6.test "Lecteur KRI QA" "kri.read,risk.read"
u "$T" qa-f7s6-u@f7s6.test "Editeur KRI QA" "kri.read,kri.update,risk.read"
u "$T2" qa-f7s6-x@f7s6.test "Autre tenant KRI" "kri.read,kri.create,kri.update,kri.delete,risk.read,risk.create"
echo "tenant=$T tenant2=$T2"
