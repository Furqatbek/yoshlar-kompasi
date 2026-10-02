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
# Authorization runs through the bot, so the suites need one configured. The
# token is never used to reach Telegram: the drivers post webhook updates
# directly and the bot's outbound replies are expected to fail and be swallowed.
export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-test-bot-token}"
export TELEGRAM_BOT_USERNAME="${TELEGRAM_BOT_USERNAME:-kompas_test_bot}"
export TELEGRAM_WEBHOOK_SECRET="${TELEGRAM_WEBHOOK_SECRET:-test-webhook-secret}"
# Paid reports. The Payme integration is inbound (Payme calls us), so the
# suite plays Payme itself and no sandbox credentials are needed — the key
# below is simply the shared secret both sides check.
export PAYMENTS_ENABLED=true
export REPORT_PRICE_UZS="${REPORT_PRICE_UZS:-49000}"
export PAYME_MERCHANT_ID="${PAYME_MERCHANT_ID:-test-merchant}"
export PAYME_MERCHANT_KEY="${PAYME_MERCHANT_KEY:-test-payme-key}"
export RL_SESSIONS_PER_DAY=1000 RL_ADMIN_LOGIN_PER_MIN=1000 RL_MESSAGES_PER_MIN=1000
export BASE_URL="http://127.0.0.1:${PORT}"
# Reminder links ride on inline buttons, and Telegram rejects a relative URL on
# one — so a reminder with no absolute base is skipped rather than sent broken.
# Production requires PUBLIC_BASE_URL for the same reason; the suite sets it so
# the reminder path under test is the one that actually ships.
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-$BASE_URL}"

echo "==== unit: OpenRouter adapter + modelFor ===="
node test/unit/openrouter-adapter.test.js

echo "==== unit: funnel drop-off arithmetic ===="
node test/unit/funnel.test.js

echo "==== unit: paywall split + reminder rules ===="
node test/unit/paywall.test.js

echo "==== unit: what the bot says back ===="
node test/unit/bot-replies.test.js

echo "==== unit: compose passes every setting through ===="
node test/unit/compose-env.test.js

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

echo "==== api: Telegram authorization gate ===="
node test/api/auth-test.js

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
echo "==== api: paid reports + Payme Merchant API ===="
node test/api/payments-test.js
# Ages rows to force reminder timings, so it runs after the suites whose data
# it would otherwise disturb.
echo "==== api: Telegram reminders ===="
node test/api/reminders-test.js
# Last: it asserts on absolute funnel counts, so it wants the other suites'
# traffic already in the table rather than arriving underneath it.
echo "==== api: funnel tracking + drop-off ===="
node test/api/funnel-test.js

echo ""
echo "ALL API TESTS PASSED"
