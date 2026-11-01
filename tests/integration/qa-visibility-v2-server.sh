#!/bin/bash
# OUTILLAGE DE TEST (QA visibility V2). VRAI backend (tsx) contre une base locale (fournisseur local, pas de Drive, pas de Neon).
# Comptes <nom>@vv1.test (jeu V1), secret de jeton genere a l'execution. PID/log propres a V2 (pas de collision avec le serveur V1).
# Usage : QA_PORT=8096 QA_DB=grc_qa_vv2 qa-visibility-v2-server.sh start | stop
R=$(cd "$(dirname "$0")/../.." && pwd)
PIDF=/var/tmp/qavisv2-server-${QA_PORT:-8097}.pid
if [[ "$1" = "stop" ]]; then
  [[ -f $PIDF ]] && kill $(cat $PIDF) 2>/dev/null; rm -f $PIDF; exit 0
fi
cd "$R/backend" || exit 1
SALT=aabbccddeeff0011
HASH="scrypt\$$SALT\$$(node -e 'const c=require("crypto");process.stdout.write(c.scryptSync("whatever",process.argv[1],64).toString("hex"))' $SALT)"
USERS=$(node -e 'const h=process.argv[1];console.log(JSON.stringify(["own","n1","raci","pown","dept","named","out","out2","rm","com","aud","adm"].map(n=>({email:n+"@vv1.test",passwordHash:h}))))' "$HASH")
env NODE_ENV=development APP_ENV=development PORT=${QA_PORT:-8097} DATABASE_URL="postgresql://postgres@127.0.0.1:55442/${QA_DB:-grc_qa_vv2}" \
  AUTH_PROVIDER=local LOCAL_AUTH_USERS_JSON="$USERS" LOCAL_AUTH_TOKEN_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')" \
  CORS_ALLOWED_ORIGINS="${QA_CORS:-http://127.0.0.1:5199}" \
  node_modules/.bin/tsx --import "$R/tests/integration/qa-f7s1-test-preload.mjs" src/server.ts >/var/tmp/qavisv2-server-${QA_PORT:-8097}.log 2>&1 &
echo $! >$PIDF
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:${QA_PORT:-8097}/api/v1/auth/local -X POST && exit 0; sleep 1; done
echo "serveur non demarre"; tail -20 /var/tmp/qavisv2-server-${QA_PORT:-8097}.log; exit 1
