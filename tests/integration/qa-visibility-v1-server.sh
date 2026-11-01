#!/bin/bash
# OUTILLAGE DE TEST (QA visibility V1). Lance le VRAI backend (tsx) contre la base locale grc_qa_vv1 (fournisseur local, pas de Drive).
# Usage : qa-visibility-v1-server.sh start | stop   (port 8097, PID dans /var/tmp/qavisv1-server.pid)
R=$(cd "$(dirname "$0")/../.." && pwd)
if [[ "$1" = "stop" ]]; then
  [[ -f /var/tmp/qavisv1-server.pid ]] && kill $(cat /var/tmp/qavisv1-server.pid) 2>/dev/null; rm -f /var/tmp/qavisv1-server.pid; exit 0
fi
cd "$R/backend" || exit 1
SALT=aabbccddeeff0011
HASH="scrypt\$$SALT\$$(node -e 'const c=require("crypto");process.stdout.write(c.scryptSync("whatever",process.argv[1],64).toString("hex"))' $SALT)"
USERS=$(node -e 'const h=process.argv[1];console.log(JSON.stringify(["own","n1","raci","pown","dept","named","out","out2","rm","com","aud","adm"].map(n=>({email:n+"@vv1.test",passwordHash:h}))))' "$HASH")
env NODE_ENV=development APP_ENV=development PORT=${QA_PORT:-8097} DATABASE_URL="postgresql://postgres@127.0.0.1:55442/${QA_DB:-grc_qa_vv1}" \
  AUTH_PROVIDER=local LOCAL_AUTH_USERS_JSON="$USERS" LOCAL_AUTH_TOKEN_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')" \
  CORS_ALLOWED_ORIGINS="http://127.0.0.1:5198" \
  node_modules/.bin/tsx --import "$R/tests/integration/qa-f7s1-test-preload.mjs" src/server.ts >/var/tmp/qavisv1-server.log 2>&1 &
echo $! >/var/tmp/qavisv1-server.pid
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:${QA_PORT:-8097}/api/v1/auth/local -X POST && exit 0; sleep 1; done
echo "serveur non demarre"; tail -20 /var/tmp/qavisv1-server.log; exit 1
