// What an operator sees when DATABASE_URL cannot be parsed.
//
// This is written as a real process launch rather than a direct call, because
// the thing being tested is the first thing a crash-looping container prints.
// On the careerkids.uz launch that was nine identical lines of
//
//   [migrate] Invalid URL
//
// and nothing else — no mention of a URL, a password, or Postgres. The cause
// was a POSTGRES_PASSWORD from `openssl rand -base64 24` that happened to
// contain a "/", which compose interpolated into DATABASE_URL, which then
// parsed as host "yik" and port "ab". Diagnosing it from that message alone is
// not reasonable, so the message changed.

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVER = path.join(__dirname, '..', '..', 'server');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

// Load the pool the way every entry point does, and return whatever the
// process said on the way down.
function loadPool(databaseUrl) {
  try {
    execFileSync(process.execPath, ['-e', 'require("./db/pool")'], {
      cwd: SERVER,
      env: { ...process.env, DATABASE_URL: databaseUrl, JWT_SECRET: 'x'.repeat(20) },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, output: '' };
  } catch (err) {
    return { ok: false, output: String(err.stderr || '') + String(err.stdout || '') };
  }
}

test('a password with "/" is refused, and the message says so', () => {
  const { ok, output } = loadPool('postgres://yik:ab/cd+ef=@db:5432/yik');
  assert.ok(!ok, 'a URL that cannot be parsed must not be accepted');
  assert.match(output, /DATABASE_URL is not a parsable URL/);
  assert.match(output, /contains "\/"/, 'the offending character must be named');
  assert.match(output, /%2F/, 'the percent-encoding must be spelled out');
  assert.ok(!/Invalid URL\b/.test(output.split('\n')[0] || ''),
    'the bare "Invalid URL" is what this replaces');
});

test('the password itself is never printed', () => {
  const secret = 'Tp9xQ/vZ4mKs';
  const { output } = loadPool('postgres://yik:' + secret + '@db:5432/yik');
  assert.ok(!output.includes(secret), 'the message must not echo the credentials');
  // Not even the part before the slash.
  assert.ok(!output.includes('Tp9xQ'), 'nor any fragment of them');
});

test('"?" and "#" are caught too, and named', () => {
  for (const c of ['?', '#']) {
    const { ok, output } = loadPool('postgres://yik:ab' + c + 'cd@db:5432/yik');
    assert.ok(!ok, c + ' must be refused');
    assert.match(output, new RegExp('contains "\\' + c + '"'), c + ' must be named');
  }
});

// Everything else in a password is survivable, and refusing it would be worse
// than the bug: a deployment with a working "+" or "=" password must not start
// failing because of this check. (":", "@" and "=" all parse — userinfo runs to
// the LAST "@" — so only the three above are real.)
test('passwords that do parse are left alone', () => {
  for (const p of ['abcd+ef==', 'ab:cd', 'ab@cd', 'plainpassword', '9f2c4ab1d0e7']) {
    const { ok, output } = loadPool('postgres://yik:' + p + '@db:5432/yik');
    assert.ok(ok, 'should have loaded with password shape ' + JSON.stringify(p) + ':\n' + output);
  }
});

test('a missing DATABASE_URL is left to config.js, which words it better', () => {
  const { ok } = loadPool('');
  assert.ok(ok, 'pool.js must not pre-empt the missing-config message');
});

test('the advice is actionable, not just descriptive', () => {
  const { output } = loadPool('postgres://yik:ab/cd@db:5432/yik');
  assert.match(output, /openssl rand -hex 32/, 'say how to generate a safe one');
  assert.match(output, /down -v/, 'say that the volume has to be recreated');
  assert.match(output, /deletes the database/, 'and warn what that costs');
});

console.log('\n' + pass + ' passed, 0 failed');
