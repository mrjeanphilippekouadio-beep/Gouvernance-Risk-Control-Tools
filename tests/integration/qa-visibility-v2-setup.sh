#!/bin/bash
# OUTILLAGE DE TEST (QA visibility V2). PostgreSQL 16 LOCAL jetable (jamais Neon) : reutilise le cluster 127.0.0.1:55442 du setup V1.
# Usage : qa-visibility-v2-setup.sh up [base]  -> base (defaut grc_qa_vv2) : setup V1 (migrations 001..083 + groupes fixes + jeu V1) puis jeu V2.
#         qa-visibility-v2-setup.sh down       -> arret du cluster (comme V1).
D=$(cd "$(dirname "$0")" && pwd)
if [[ "$1" = "down" ]]; then exec bash "$D/qa-visibility-v1-setup.sh" down; fi
DB=${2:-grc_qa_vv2}
bash "$D/qa-visibility-v1-setup.sh" up "$DB" || exit 1
/usr/bin/psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55442 -U postgres -d "$DB" -f "$D/qa-visibility-v2-seed.sql" || exit 1
echo "base $DB prete (V2)"
