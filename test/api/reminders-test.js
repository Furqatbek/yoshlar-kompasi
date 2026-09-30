// Telegram reminders: who gets chased, who does not, and never twice.
//
// The bot cannot actually deliver here (no real token), so sends fail and the
// claim is released — which is itself worth proving. The selection rules are
// what matter, and those are exercised against real rows: sessions abandoned
// at a real timestamp, orders left pending, parents who never started.
//
// Timings are forced by ageing rows in the database rather than by waiting.

// pg lives in server/node_modules, which is where the app's deps are installed.
const { Client } = require(require.resolve('pg', { paths: [require('path').join(__dirname, '..', '..', 'server')] }));

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8091';
const DB = process.env.DATABASE_URL;

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? '  ok  - ' : '  FAIL- ') + n + (x ? '   ' + x : '')); };

const j = async (method, path, body, headers) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
};

const { authorize } = require('./auth-helper');

(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();

  // The service reads config at require time; force reminders on for this run.
  process.env.REMINDERS_ENABLED = 'true';
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-bot-token';
  // Daytime, so quiet hours never make this suite flaky.
  process.env.REMIND_QUIET_FROM = '23';
  process.env.REMIND_QUIET_TO = '0';
  delete require.cache[require.resolve('../../server/config')];
  delete require.cache[require.resolve('../../server/services/reminders')];
  delete require.cache[require.resolve('../../server/db/repo')];
  const reminders = require('../../server/services/reminders');
  const repo = require('../../server/db/repo');
  const { config } = require('../../server/config');

  const age = (sql, params) => db.query(sql, params);

  // Ask the queues directly and look for ONE parent, rather than counting
  // candidates: every earlier suite leaves reports and sessions behind, so a
  // global count says nothing about the rule under test.
  const R = config.reminders;
  const common = { giveUpDays: R.giveUpAfterDays, weeklyCap: R.maxPerParentPerWeek, limit: R.maxPerRun };
  const QUEUE = {
    abandoned: () => repo.remindersAbandoned({ ...common, afterHours: R.abandonedAfterHours }),
    unpaid: () => repo.remindersUnpaid({ ...common, afterHours: R.unpaidAfterHours }),
    never_started: () => repo.remindersNeverStarted({ ...common, afterHours: R.neverStartedAfterHours }),
  };
  const queued = async (kind, chatId) =>
    (await QUEUE[kind]()).some((r) => String(r.telegram_chat_id) === String(chatId));

  // ---- a parent who logged in and never started anything ------------------
  await authorize(BASE, { chatId: 855000111, phone: '+998901110011', firstName: 'Hech', lastName: 'Boshlamagan' });
  ok('a fresh login is not chased immediately', (await queued('never_started', 855000111)) === false);

  await age(`UPDATE parents SET telegram_linked_at = now() - interval '30 hours' WHERE telegram_chat_id = 855000111`);
  ok('after a day, a login that never started is chased', (await queued('never_started', 855000111)) === true);

  // ---- a parent who abandoned mid-test ------------------------------------
  const tokA = await authorize(BASE, { chatId: 855000222, phone: '+998901110022', firstName: 'Yarim', lastName: 'Qoldirgan' });
  const sessA = await j('POST', '/api/sessions', { consent: true, nickname: 'Bekzod', grade: 2 },
    { 'x-parent-token': tokA });
  ok('an assessment is started', sessA.status === 201);

  ok('a session started just now is not chased', (await queued('abandoned', 855000222)) === false);
  // Starting an assessment takes them out of the other queue, and must not be
  // left behind in it — that would be two reminders for one person.
  await age(`UPDATE parents SET telegram_linked_at = now() - interval '30 hours' WHERE telegram_chat_id = 855000222`);
  ok('  and starting one removes them from "never started"',
    (await queued('never_started', 855000222)) === false);

  const ageBekzod = (iv) => age(
    `UPDATE sessions SET started_at = now() - ($1)::interval
      WHERE child_id IN (SELECT id FROM children WHERE nickname = 'Bekzod')`, [iv]);

  await ageBekzod('30 hours');
  ok('an assessment abandoned yesterday is chased', (await queued('abandoned', 855000222)) === true);

  // Old enough that mentioning it would be odd rather than helpful.
  await ageBekzod('40 days');
  ok('  but not one abandoned weeks ago', (await queued('abandoned', 855000222)) === false);
  await ageBekzod('30 hours');

  // ---- a parent who finished but never paid -------------------------------
  const tokB = await authorize(BASE, { chatId: 855000333, phone: '+998901110033', firstName: 'Tolamagan', lastName: 'Ota' });
  const sessB = await j('POST', '/api/sessions', { consent: true, nickname: 'Malika', grade: 4 },
    { 'x-parent-token': tokB });
  const stokB = sessB.data.session_token;
  await j('POST', '/api/sessions/' + stokB + '/messages', { content: 'Malika: javob' },
    { 'x-session-token': stokB });
  const repB = await j('POST', '/api/sessions/' + stokB + '/report', {}, { 'x-session-token': stokB });
  ok('a report is produced and left unpaid', repB.status === 200 && !!repB.data.share_token);

  ok('a report from a minute ago is not chased', (await queued('unpaid', 855000333)) === false);
  // A finished assessment is not an abandoned one, even though both have a
  // session older than the threshold.
  ok('  and a finished assessment is never "abandoned"',
    (await queued('abandoned', 855000333)) === false);

  // Scoped to this test's report: ageing every report would make the whole
  // suite's leftovers eligible and prove nothing about this rule.
  const ageMalika = (sql) => age(sql + ` WHERE child_id IN (SELECT id FROM children WHERE nickname = 'Malika')`);
  await ageMalika(`UPDATE reports SET created_at = now() - interval '30 hours'`);
  ok('an unpaid report from yesterday is chased', (await queued('unpaid', 855000333)) === true);

  // Paying stops the chase.
  const ordersOfMalika = (state, paid) => age(
    `UPDATE orders SET state = $1, paid_at = $2
      WHERE report_id IN (SELECT r.id FROM reports r JOIN children c ON c.id = r.child_id
                           WHERE c.nickname = 'Malika')`, [state, paid]);
  await ordersOfMalika('paid', new Date());
  ok('a paid report is never chased', (await queued('unpaid', 855000333)) === false);
  await ordersOfMalika('pending', null);
  ok('  (and is chased again once the payment is reversed)',
    (await queued('unpaid', 855000333)) === true);

  // ---- the opt-out --------------------------------------------------------
  await age(`UPDATE parents SET reminders_opted_out = TRUE WHERE telegram_chat_id = 855000333`);
  ok('an opted-out parent is dropped from the queue', (await queued('unpaid', 855000333)) === false);
  await age(`UPDATE parents SET reminders_opted_out = FALSE WHERE telegram_chat_id = 855000333`);

  // /stop must work from the bot, first time, with no argument.
  const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'test-webhook-secret';
  await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify({
      update_id: 1, message: { message_id: 9, chat: { id: 855000333, type: 'private' },
        from: { id: 855000333, first_name: 'Tolamagan' }, text: '/stop' },
    }),
  });
  await new Promise((r) => setTimeout(r, 400));
  const optedOut = await db.query('SELECT reminders_opted_out FROM parents WHERE telegram_chat_id = 855000333');
  ok('/stop in the bot opts the parent out', optedOut.rows[0].reminders_opted_out === true);
  ok('  and they stop appearing', (await queued('unpaid', 855000333)) === false);
  await age(`UPDATE parents SET reminders_opted_out = FALSE WHERE telegram_chat_id = 855000333`);

  // ---- quiet hours --------------------------------------------------------
  process.env.REMIND_QUIET_FROM = '0';
  process.env.REMIND_QUIET_TO = '23';
  delete require.cache[require.resolve('../../server/config')];
  delete require.cache[require.resolve('../../server/services/reminders')];
  const nightly = require('../../server/services/reminders');
  const quiet = await nightly.run({ dryRun: true });
  ok('nothing runs during quiet hours', quiet.skipped === 'quiet_hours', JSON.stringify(quiet));

  // ---- once, ever ---------------------------------------------------------
  // A claim is what makes a reminder single-use, so claim one by hand and
  // check the queue loses it. This is the mechanism the real send relies on.
  const target = (await db.query(
    `SELECT p.id FROM parents p WHERE p.telegram_chat_id = 855000222`)).rows[0];
  const sessRow = (await db.query(
    `SELECT s.id FROM sessions s JOIN children c ON c.id = s.child_id WHERE c.nickname = 'Bekzod'`)).rows[0];
  const claim = await repo.claimReminder({ parentId: target.id, kind: 'abandoned', sessionId: sessRow.id });
  ok('a reminder can be claimed', !!claim);
  const again = await repo.claimReminder({ parentId: target.id, kind: 'abandoned', sessionId: sessRow.id });
  ok('  and cannot be claimed twice', again === null);
  ok('a claimed reminder leaves the queue', (await queued('abandoned', 855000222)) === false);

  // Releasing it (what happens when Telegram refuses) puts it back.
  await repo.releaseReminder(claim.id);
  ok('a released claim returns to the queue', (await queued('abandoned', 855000222)) === true);

  // ---- a failed send must not consume the one chance ----------------------
  // The bot token is fake, so the send fails; the claim must be given back.
  const before = (await db.query('SELECT count(*)::int n FROM reminders_sent')).rows[0].n;
  const real = await reminders.run({});
  ok('a run with a dead bot sends nothing', real.sent === 0, JSON.stringify(real));
  const after = (await db.query('SELECT count(*)::int n FROM reminders_sent')).rows[0].n;
  ok('  and leaves no claims behind, so it can be retried', after === before,
    before + ' -> ' + after);

  // ---- the weekly cap -----------------------------------------------------
  // Two reminders already this week (the configured cap) removes the parent
  // from every queue, whatever else is outstanding.
  await db.query(
    `INSERT INTO reminders_sent (parent_id, kind, session_id)
     VALUES ($1, 'cap_filler_a', NULL), ($1, 'cap_filler_b', NULL)`, [target.id]);
  ok('a parent at the weekly cap is not messaged again',
    (await queued('abandoned', 855000222)) === false);

  await db.end();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
