// What the bot actually says back.
//
// The API suites drive the real webhook shapes, but the bot's outbound sends
// fail there (no Telegram to reach) and are deliberately swallowed, so nothing
// has ever looked at the replies themselves. This does, by stubbing fetch and
// reading the sendMessage payloads the handler produces.
//
// Worth pinning because parse_mode is now on: a stray "<" in a reply is not a
// typo, it is a 400 from Telegram and a message the parent never receives —
// and these replies are the only thing standing between a half-finished login
// and a parent who gives up.

const assert = require('assert');

process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_BOT_USERNAME = 'kompas_test_bot';

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

// Flipped by the one test that needs Telegram to refuse an upload.
let failUploads = false;

// Load the module with a chosen PUBLIC_BASE_URL and a fetch that records
// instead of calling out.
function harness(base) {
  const prev = process.env.PUBLIC_BASE_URL;
  if (base === null) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = base;
  for (const m of ['../../server/config', '../../server/services/delivery/telegram']) {
    delete require.cache[require.resolve(m)];
  }
  const tg = require('../../server/services/delivery/telegram');
  if (prev === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = prev;

  const sent = [];
  const realFetch = global.fetch;
  // The report goes out as a file, so a send is either a JSON body or a
  // multipart upload; both are recorded in the same shape.
  global.fetch = async (url, opts) => {
    const method = String(url).split('/').pop();
    if (opts.body instanceof FormData) {
      const rec = { method, _upload: true };
      for (const [k, v] of opts.body.entries()) {
        if (v instanceof Blob) rec[k] = { name: v.name, type: v.type, size: v.size };
        else if (k === 'reply_markup') rec[k] = JSON.parse(v);
        else rec[k] = v;
      }
      sent.push(rec);
    } else {
      sent.push({ method, ...JSON.parse(opts.body) });
    }
    if (failUploads && method === 'sendDocument') {
      return { ok: false, json: async () => ({ ok: false, description: 'Request Entity Too Large' }) };
    }
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  };
  const restore = () => { global.fetch = realFetch; failUploads = false; };
  return { tg, sent, restore };
}

const DEPS = {
  findReportByShareToken: async () => null,
  markDelivered: async () => {},
  onAuthStart: async () => ({ needPhone: false }),
  onContact: async () => ({ ok: true }),
  onStop: async () => true,
};

// Run one message through the handler and hand back what it tried to send.
// Takes the MESSAGE and wraps it: handleUpdate drops an update with no
// `message` on the floor, so passing the wrong shape here would make every
// assertion below pass over an empty list.
async function reply(message, { base = 'https://kompas.uz', deps = {} } = {}) {
  const h = harness(base);
  try {
    await h.tg.handleUpdate({ update_id: 1, message }, { ...DEPS, ...deps });
    assert.ok(h.sent.length > 0, 'the bot said nothing at all to: ' + JSON.stringify(message).slice(0, 80));
    return h.sent;
  } finally { h.restore(); }
}

const text = (m) => ({ message_id: 1, chat: { id: 7, type: 'private' }, from: { id: 7, first_name: 'Dilnoza' }, text: m });
const inline = (s) => s.reply_markup && s.reply_markup.inline_keyboard;
const run = [];
const it = (name, fn) => run.push([name, fn]);

// ---- every reply, as a class ----------------------------------------------

it('every reply is valid HTML for Telegram and carries no raw markup', async () => {
  const updates = [
    text('/start'),
    text('/stop'),
    text('/start auth_missing'),
    text('/start sometoken'),
    { message_id: 1, chat: { id: 7, type: 'private' }, from: { id: 7 }, contact: { user_id: 7, phone_number: '+998901112233' } },
    { message_id: 1, chat: { id: 7, type: 'private' }, from: { id: 7 }, contact: { user_id: 9, phone_number: '+998901112233' } },
  ];
  for (const u of updates) {
    for (const s of await reply(u)) {
      assert.strictEqual(s.parse_mode, 'HTML', JSON.stringify(s.text));
      const opens = (s.text.match(/<b>/g) || []).length;
      const closes = (s.text.match(/<\/b>/g) || []).length;
      assert.strictEqual(opens, closes, 'unbalanced <b> in: ' + s.text);
      // Any other angle bracket would be markup Telegram does not know.
      const stripped = s.text.replace(/<\/?b>/g, '');
      assert.ok(!/[<>]/.test(stripped.replace(/&lt;|&gt;/g, '')), 'stray bracket in: ' + s.text);
      assert.strictEqual(s.disable_web_page_preview, true, 'preview left on: ' + s.text);
    }
  }
});

it('a hostile Telegram display name cannot break the greeting', async () => {
  const u = { message_id: 1, chat: { id: 7, type: 'private' },
    from: { id: 7, first_name: '<b>Ali' }, text: '/start auth_nonce' };
  const [s] = await reply(u, { deps: { onAuthStart: async () => ({ needPhone: true }) } });
  assert.ok(s.text.includes('&lt;b&gt;Ali'), s.text);
  assert.strictEqual((s.text.match(/<b>/g) || []).length, (s.text.match(/<\/b>/g) || []).length, s.text);
});

// ---- the individual replies ------------------------------------------------

it('/start with no payload explains the bot and offers the site', async () => {
  const [s] = await reply(text('/start'));
  assert.ok(/^<b>/.test(s.text), s.text);
  assert.ok(inline(s), 'no button: ' + JSON.stringify(s.reply_markup));
  assert.strictEqual(inline(s)[0][0].url, 'https://kompas.uz/');
});

it('  and falls back to prose when we do not know our own origin', async () => {
  const [s] = await reply(text('/start'), { base: null });
  assert.ok(!s.reply_markup, 'a relative button URL is a hard 400: ' + JSON.stringify(s.reply_markup));
  assert.ok(/saytda/i.test(s.text), 'the prose still says where to go: ' + s.text);
});

it('/stop confirms and promises the reports keep coming', async () => {
  const [s] = await reply(text('/stop'));
  assert.ok(/to‘xtatildi/.test(s.text), s.text);
  assert.ok(/[Hh]isobot/.test(s.text), 'must say the report is unaffected: ' + s.text);
  assert.ok(!inline(s), 'someone opting out is not offered a way back in');
});

it('  and says the same when they were already opted out', async () => {
  const [s] = await reply(text('/stop'), { deps: { onStop: async () => false } });
  assert.ok(/[Hh]isobot/.test(s.text), s.text);
});

it('a forwarded contact is refused, keeping the share-phone keyboard up', async () => {
  const u = { message_id: 1, chat: { id: 7, type: 'private' }, from: { id: 7 },
    contact: { user_id: 9, phone_number: '+998901112233' } };
  const [s] = await reply(u);
  assert.ok(s.reply_markup.keyboard, 'the phone keyboard must stay: ' + JSON.stringify(s.reply_markup));
  assert.ok(/o‘zingizning/.test(s.text), s.text);
});

it('a shared contact confirms and clears the keyboard', async () => {
  const u = { message_id: 1, chat: { id: 7, type: 'private' }, from: { id: 7 },
    contact: { user_id: 7, phone_number: '+998901112233' } };
  const [s] = await reply(u);
  assert.strictEqual(s.reply_markup.remove_keyboard, true, JSON.stringify(s.reply_markup));
  // reply_markup holds one thing at a time — clearing the stale phone keyboard
  // is worth more than a shortcut, since the page unlocks from polling anyway.
  assert.ok(!inline(s), 'cannot clear the keyboard and show a button at once');
});

it('an expired login link offers one tap back', async () => {
  const [s] = await reply(text('/start auth_gone'), { deps: { onAuthStart: async () => null } });
  assert.ok(/eskirgan/.test(s.text), s.text);
  assert.ok(inline(s), 'recoverable in one tap, so it gets the button');
});

it('a missing report does not pretend the site can fix it', async () => {
  const [s] = await reply(text('/start notarealtoken'));
  assert.ok(/topilmadi/.test(s.text), s.text);
  assert.ok(!inline(s), 'no button to a dead end');
});

// ---- the report arrives as a file -----------------------------------------
//
// A link needs a browser, a signal and a tab the parent still has open in three
// months. A document sits in the chat and in Telegram's own storage, which is
// where these are actually kept. The caption carries the same words the message
// would have, so this is one send rather than two.

const PDF = { filename: 'CareerKids - Dilnoza - 23.10.2026.pdf', buffer: Buffer.from('%PDF-1.3 stub') };
const withReport = (getDocument, unlocked = true) => ({
  findReportByShareToken: async () => ({
    childNickname: 'Dilnoza', reportUrl: 'https://kompas.uz/hisobot/tok', getDocument, unlocked,
  }),
});

it('the report is delivered as a document, not a link to one', async () => {
  const [s] = await reply(text('/start tok'), { deps: withReport(async () => PDF) });
  assert.strictEqual(s.method, 'sendDocument', 'sent ' + s.method + ' instead');
  assert.strictEqual(s.document.name, PDF.filename, JSON.stringify(s.document));
  assert.strictEqual(s.document.type, 'application/pdf', s.document.type);
  assert.ok(s.document.size > 0, 'an empty attachment is worse than none');
});

it('  carrying the same words, and the button, as the message it replaces', async () => {
  const [s] = await reply(text('/start tok'), { deps: withReport(async () => PDF) });
  assert.ok(/Dilnoza/.test(s.caption), s.caption);
  assert.strictEqual(s.parse_mode, 'HTML', 'the caption is HTML like every other reply');
  assert.ok(inline(s), 'the link is still offered: a file is not a page');
});

it('  and it is one send, not a file followed by an explanation', async () => {
  const sent = await reply(text('/start tok'), { deps: withReport(async () => PDF) });
  assert.strictEqual(sent.length, 1, sent.map((x) => x.method).join(' + '));
});

it('a report with no file still arrives as a link', async () => {
  // What a paywalled report does: documentFor returns null until it is bought.
  const [s] = await reply(text('/start tok'), { deps: withReport(async () => null) });
  assert.strictEqual(s.method, 'sendMessage');
  assert.ok(/Dilnoza/.test(s.text) && inline(s), s.text);
});

it('a refused upload falls back to the link rather than losing the delivery', async () => {
  // Telegram can refuse for reasons we cannot see coming. A parent with a link
  // is in a much better position than a parent with nothing.
  failUploads = true;
  const sent = await reply(text('/start tok'), { deps: withReport(async () => PDF) });
  assert.deepStrictEqual(sent.map((x) => x.method), ['sendDocument', 'sendMessage'],
    'expected the upload to be tried and the message to follow');
  assert.ok(/Dilnoza/.test(sent[1].text) && inline(sent[1]), sent[1].text);
});

it('  as does a file that could not be drawn at all', async () => {
  const [s] = await reply(text('/start tok'), {
    deps: withReport(async () => { throw new Error('pdf: missing font'); }),
  });
  assert.strictEqual(s.method, 'sendMessage', 'a broken renderer must not cost the parent the report');
});


// ---- what the message says about money ------------------------------------
//
// The same delivery runs twice on a paid deployment: once when the report is
// written and nobody has paid, and again when they have. Quoting the price the
// second time reads as a demand for money the parent has already sent.

function withPayments(fn) {
  const prev = process.env.PAYMENTS_ENABLED;
  process.env.PAYMENTS_ENABLED = 'true';
  process.env.REPORT_PRICE_UZS = '49000';
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.PAYMENTS_ENABLED; else process.env.PAYMENTS_ENABLED = prev;
  }
}

it('an unpaid report is delivered with the price, before the tap', async () => {
  const sent = await withPayments(() =>
    reply(text('/start tok'), { deps: withReport(async () => null, false) }));
  const s = sent[0];
  assert.strictEqual(s.method, 'sendMessage', 'nothing to attach until it is bought');
  assert.ok(/49 000/.test(s.text), s.text);
});

it('  and a paid one never mentions it again', async () => {
  const sent = await withPayments(() =>
    reply(text('/start tok'), { deps: withReport(async () => PDF, true) }));
  const s = sent[0];
  assert.strictEqual(s.method, 'sendDocument');
  assert.ok(!/49 000|so‘m/.test(s.caption),
    'the parent has paid; this still asks them for money: ' + s.caption);
  assert.ok(/ochiq/.test(s.caption), s.caption);
});

(async () => {
  for (const [name, fn] of run) { await fn(); pass++; console.log('  ok  - ' + name); }
  console.log('\n' + pass + ' passed, 0 failed');
})().catch((e) => { console.error(e); process.exit(1); });
