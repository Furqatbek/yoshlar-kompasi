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
  'DOMAIN', 'DOMAIN_ALIASES', 'LETSENCRYPT_DIR', // nginx/certbot wiring, checked below
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
function blockOf(service) {
  const lines = compose.split('\n');
  const start = lines.findIndex((l) => l === '  ' + service + ':');
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) || /^  [a-z_-]+:/.test(line)) break; // next service or top level
    out.push(line);
  }
  return out;
}

function envOf(service) {
  const out = {};
  for (const line of blockOf(service)) {
    const m = /^      ([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const APP = envOf('app');
const CRON = envOf('cron');
const NGINX = envOf('nginx');

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

// ---- nginx: the same failure mode, one layer out -------------------------
//
// The reverse proxy's real config is a template. It is rendered by the official
// image's entrypoint, which runs its /docker-entrypoint.d/ scripts ONLY when
// its first argument is `nginx`. Give the service a `command:` of its own and
// the whole step is skipped without a word — nginx then starts on the stock
// default.conf that ships in the image, which is the "Welcome to nginx!" page
// on port 80 and no TLS listener at all, while every container reports healthy
// and `docker compose ps` looks perfect.
//
// This is not hypothetical. The nginx service carried a `command:` override for
// a 6-hourly reload loop, and the first time the prod profile was actually
// started the domain served the nginx welcome page over plain HTTP.

const NGINX_BLOCK = blockOf('nginx').join('\n');
const template = fs.readFileSync(
  path.join(ROOT, 'deploy', 'nginx', 'default.conf.template'), 'utf8');
const CHECK = 'deploy/nginx/entrypoint.d/99-reload-and-verify.sh';

test('the nginx block parses', () => {
  assert.ok(/image:\s*nginx:/.test(NGINX_BLOCK), 'nginx service block not found');
});

test('the nginx service leaves the image entrypoint alone', () => {
  const command = /^\s{4}command:\s*(.*)$/m.exec(NGINX_BLOCK);
  // If a command is ever needed again, it has to start with `nginx` for the
  // template step to run at all.
  if (command) {
    assert.ok(/^\[?\s*"?nginx/.test(command[1].trim()),
      'nginx `command:` must start with nginx, or the config template is never\n'
      + 'rendered and the site becomes the stock welcome page: ' + command[1]);
  }
});

test('every placeholder in the nginx template reaches the nginx container', () => {
  // envsubst only substitutes variables that exist in the environment; it
  // leaves an undefined ${VAR} as literal text, and nginx then refuses to
  // parse it. An empty value is fine — being absent is not.
  const directives = template.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const used = [...new Set([...directives.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]))];
  assert.ok(used.includes('DOMAIN'), 'template no longer uses ${DOMAIN}: check this test');
  const missing = used.filter((n) => !(n in NGINX));
  assert.deepStrictEqual(missing, [],
    'used in deploy/nginx/default.conf.template but not in the nginx service '
    + 'environment:\n  ' + missing.join('\n  '));
});

test('the rendered config is checked before nginx serves it', () => {
  // Checked before the mount itself, because mounting the directory is the
  // tempting way to do this and the worse one: it hides the image's own
  // entrypoint scripts, including the one that renders the template.
  assert.ok(!/entrypoint\.d:\/docker-entrypoint\.d/.test(NGINX_BLOCK),
    'mount the check script as a file; mounting the directory hides the '
    + 'image\'s own entrypoint scripts, and rendering is one of them');
  assert.ok(NGINX_BLOCK.includes(CHECK + ':/docker-entrypoint.d/'),
    CHECK + ' must be mounted into /docker-entrypoint.d/ — it is what turns a '
    + 'silently unrendered config into a refusal to start');
  const mode = fs.statSync(path.join(ROOT, CHECK)).mode;
  assert.ok(mode & 0o111,
    CHECK + ' is not executable, and the entrypoint silently ignores a '
    + 'non-executable script — chmod +x it and commit the mode');
});

console.log('\n' + pass + ' passed, 0 failed  (' + documented.length + ' settings checked)');
