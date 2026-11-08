#!/bin/bash
# OUTILLAGE DE TEST (QA B-6c). Lance le VRAI backend (tsx) contre la base LOCALE (127.0.0.1:55442, jamais Neon), fournisseur local.
# Usage : qa-b6c-server.sh start | stop   (port QA_PORT defaut 8094, base QA_DB defaut grc_qa_b6c, PID dans /var/tmp/qab6c-server.pid)
R=$(cd "$(dirname "$0")/../.." && pwd)
if [[ "$1" = "stop" ]]; then
  [[ -f /var/tmp/qab6c-server.pid ]] && kill $(cat /var/tmp/qab6c-server.pid) 2>/dev/null
  : >/var/tmp/qab6c-server.pid
  exit 0
fi
cd "$R/backend" || exit 1
SALT=aabbccddeeff0011
HASH="scrypt\$$SALT\$$(node -e 'const c=require("crypto");process.stdout.write(c.scryptSync("whatever",process.argv[1],64).toString("hex"))' $SALT)"
USERS=$(node -e 'const h=process.argv[1];console.log(JSON.stringify(["rm1","rm2","rm3","rm4","plain","adm","aud","rmb","rmb2","pu"].map(n=>({email:n+"@b6c.test",passwordHash:h}))))' "$HASH")
env NODE_ENV=development APP_ENV=development PORT=${QA_PORT:-8094} DATABASE_URL="postgresql://postgres@127.0.0.1:55442/${QA_DB:-grc_qa_b6c}" \
  AUTH_PROVIDER=local LOCAL_AUTH_USERS_JSON="$USERS" LOCAL_AUTH_TOKEN_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')" \
  CORS_ALLOWED_ORIGINS="http://127.0.0.1:5198" \
  node_modules/.bin/tsx --import "$R/tests/integration/qa-f7s1-test-preload.mjs" src/server.ts >/var/tmp/qab6c-server.log 2>&1 &
echo $! >/var/tmp/qab6c-server.pid
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:${QA_PORT:-8094}/api/v1/auth/local -X POST && exit 0; sleep 1; done
echo "serveur non demarre"; tail -20 /var/tmp/qab6c-server.log; exit 1
