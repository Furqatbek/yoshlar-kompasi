#!/usr/bin/env bash
# API test runner: unit suite + all API drivers against a real app + Postgres.
#
#   DATABASE_URL=postgres://...  bash test/run-api-tests.sh
#
# DATABASE_URL must point to a THROWAWAY test database — the suites create and
# delete rows, and the count-sensitive assertions assume a fresh schema.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?set DATABASE_URL to a throwaway test database}"
export JWT_SECRET="${JWT_SECRET:-test-secret-at-least-16-chars}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@markaz.uz}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-secret123}"
export NODE_ENV=development PORT="${PORT:-8091}"
export LLM_PROVIDER=openrouter
export OPENROUTER_API_KEY=sk-or-test
export OPENROUTER_BASE_URL="http://127.0.0.1:5602/api/v1"
export OPENROUTER_MODEL="anthropic/claude-sonnet-4.6"
export DELIVERY_PROVIDER=console
export RL_SESSIONS_PER_DAY=1000 RL_ADMIN_LOGIN_PER_MIN=1000 RL_MESSAGES_PER_MIN=1000
export BASE_URL="http://127.0.0.1:${PORT}"

echo "==== unit: OpenRouter adapter + modelFor ===="
node test/unit/openrouter-adapter.test.js

echo "==== migrate + seed ===="
(cd server && npm run migrate && npm run seed)

echo "==== start stub + app ===="
node test/stubs/openrouter-stub.js &
STUB=$!
(cd server && node index.js) &
APP=$!
trap 'kill $STUB $APP 2>/dev/null || true' EXIT

for i in $(seq 1 40); do
  curl -sf "$BASE_URL/healthz" >/dev/null 2>&1 && break
  sleep 0.5
  [ "$i" = 40 ] && { echo "app never became healthy"; exit 1; }
done

echo "==== api: full flow (37 assertions) ===="
node test/api/e2e-driver.js
echo "==== api: idempotency + cross-device resume ===="
node test/api/e2e-extra.js
echo "==== api: right-to-erasure cascade ===="
node test/api/delete-test.js
echo "==== api: report engagement gate ===="
node test/api/gate-test.js
echo "==== api: stale cross-provider model resolution ===="
node test/api/stale-model-test.js

echo ""
echo "ALL API TESTS PASSED"
