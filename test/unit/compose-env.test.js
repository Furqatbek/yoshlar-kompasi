// Every documented setting actually reaches a container.
//
// This exists because it already went wrong once: four commits' worth of new
// settings (PAYMENTS_ENABLED, REMINDERS_ENABLED, AUTH_*, PAYME_*, REMIND_*)
// were added to config.js and .env.example but never to docker-compose.yml.
// Nothing failed. The app read its .env, found nothing passed through, and
// quietly fell back to defaults — which for the two feature switches means
// OFF, so a deployment configured for paid reports served free ones and the
// reminder job skipped every hour without a word.
//
// That failure is invisible by construction: a missing variable is
// indistinguishable from an unset one. So the wiring gets a test.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

// Names documented in .env.example, whether set or commented out as optional.
const documented = [...new Set(
  [...envExample.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1])
)].sort();

// Settings consumed only by the host or by compose itself, never by code
// inside a container — they have no business in a service's environment.
const HOST_ONLY = new Set([
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', // compose builds DATABASE_URL from these
  'DATABASE_URL',        // assembled per service, pointing at the db service
  'APP_PORT',            // a port mapping, not an app setting
  'DOMAIN', 'LETSENCRYPT_DIR', // nginx/certbot wiring
  'NODE_ENV',            // pinned to production in the image
]);

// Which service must carry which setting. Anything not listed only has to
// reach *some* service.
const SERVICE_OF = {
  // Reminders run in the cron container, not the app: the hourly job is what
  // sends them, so that is where the bot token and the link base must be.
  REMINDERS_ENABLED: 'cron',
  REMIND_ABANDONED_HOURS: 'cron',
  REMIND_UNPAID_HOURS: 'cron',
  REMIND_NEVER_STARTED_HOURS: 'cron',
  REMIND_GIVE_UP_DAYS: 'cron',
  REMIND_MAX_PER_WEEK: 'cron',
  REMIND_QUIET_FROM: 'cron',
  REMIND_QUIET_TO: 'cron',
  REMIND_TZ_OFFSET: 'cron',
  REMIND_MAX_PER_RUN: 'cron',
  ANALYTICS_RETENTION_DAYS: 'cron', // pruned by the retention job
  RETENTION_MONTHS: 'cron',
  BACKUP_KEEP_DAYS: 'cron',
  BILLING_ALERT_MIN_USD: 'cron',
  // The paywall and the login gate are enforced by the app.
  PAYMENTS_ENABLED: 'app',
  REPORT_PRICE_UZS: 'app',
  PAYME_MERCHANT_ID: 'app',
  PAYME_MERCHANT_KEY: 'app',
  PAYME_CHECKOUT_URL: 'app',
  AUTH_REQUIRED: 'app',
  AUTH_REQUIRE_PHONE: 'app',
  AUTH_NONCE_TTL_MINUTES: 'app',
  AUTH_TOKEN_TTL_DAYS: 'app',
};

// Walk the file by indentation rather than pattern-matching YAML: a service
// starts at two spaces, and its environment entries are the SCREAMING_CASE
// keys nested under it. Regex-slicing a block structure is how this test
// failed the first time it was written.
function envOf(service) {
  const lines = compose.split('\n');
  const start = lines.findIndex((l) => l === '  ' + service + ':');
  if (start < 0) return {};
  const out = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) || /^  [a-z_-]+:/.test(line)) break; // next service or top level
    const m = /^      ([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const APP = envOf('app');
const CRON = envOf('cron');

test('the compose file parses into app and cron environment blocks', () => {
  assert.ok(APP.DATABASE_URL, 'app env block not found');
  assert.ok(CRON.DATABASE_URL, 'cron env block not found');
  assert.ok(Object.keys(APP).length > 20, 'app env looks truncated: ' + Object.keys(APP).length);
});

test('every documented setting is passed through to a container', () => {
  const missing = documented
    .filter((n) => !HOST_ONLY.has(n))
    .filter((n) => !(n in APP) && !(n in CRON));
  assert.deepStrictEqual(missing, [],
    'documented in .env.example but never reaches a container:\n  ' + missing.join('\n  '));
});

test('each setting reaches the service that actually reads it', () => {
  const wrong = Object.entries(SERVICE_OF)
    .filter(([name, service]) => !(name in (service === 'app' ? APP : CRON)))
    .map(([name, service]) => name + ' -> ' + service);
  assert.deepStrictEqual(wrong, [], 'missing from the service that reads them:\n  ' + wrong.join('\n  '));
});

// Without these the reminder job runs, finds people, and sends nothing —
// silently, every hour.
test('the cron container can actually send a reminder', () => {
  assert.ok('TELEGRAM_BOT_TOKEN' in CRON, 'no bot token: nothing can be sent');
  assert.ok('PUBLIC_BASE_URL' in CRON, 'no base url: reminder links would have no host');
});

// A deployment that has not set up a merchant must give reports away rather
// than lock them behind a payment nobody can complete.
test('the risky switches default to off', () => {
  assert.strictEqual(APP.PAYMENTS_ENABLED, '${PAYMENTS_ENABLED:-false}');
  assert.strictEqual(CRON.REMINDERS_ENABLED, '${REMINDERS_ENABLED:-false}');
});

// Every passthrough should read from the same-named variable, so what you set
// in .env is what the container gets. A typo here is silent.
test('no setting is wired to a differently-named variable', () => {
  const mismatched = [];
  for (const block of [APP, CRON]) {
    for (const [name, value] of Object.entries(block)) {
      const refs = [...value.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
      if (refs.length === 1 && refs[0] !== name) mismatched.push(name + ' <- ' + refs[0]);
    }
  }
  // DATABASE_URL is assembled from the POSTGRES_* parts, so it has several.
  assert.deepStrictEqual(mismatched, [], mismatched.join('\n  '));
});

console.log('\n' + pass + ' passed, 0 failed  (' + documented.length + ' settings checked)');
