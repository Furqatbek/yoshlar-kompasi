// What is free, what is sold, and when a reminder may be sent.
//
// No database, no app. These are the rules that decide what a parent sees
// without paying and whether a message goes out at 4am, so they are worth
// pinning down on their own.

const assert = require('assert');
const paywall = require('../../server/services/paywall');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

const REPORT = [
  '## Surat',
  '- **Diqqatli** — misollarni sabr bilan yechdi.',
  '',
  '## Hozirgi o‘rni',
  '- **Mantiq va tafakkur** — Kuchli.',
  '',
  '## Iqtidorlar xaritasi',
  '- **Mantiqiy-matematik** — yaqqol namoyon bo‘ldi.',
  '',
  '## O‘rganish usuli',
  'Amaliy-harakatli.',
  '',
  '## Ali uchun xat',
  'Ali, sen juda tirishqoqsan!',
  '',
  '## Kattalar uchun',
  '- Kuzatib boring.',
].join('\n');

// ---- what stays free ------------------------------------------------------

test('the child\'s portrait is free', () => {
  const { freeMd } = paywall.split(REPORT);
  assert.ok(freeMd.includes('## Surat'));
  assert.ok(freeMd.includes('Diqqatli'), 'the actual finding, not just the heading');
});

// The letter is addressed to the child, who did the work. Charging their
// parent to read it to them is not something this product should do.
test('the letter to the child is free, and is matched by shape not by name', () => {
  const { freeMd } = paywall.split(REPORT);
  assert.ok(freeMd.includes('## Ali uchun xat'));
  assert.ok(freeMd.includes('tirishqoqsan'));
  // Same rule with a different child.
  const other = paywall.split('## Zuhra uchun xat\nZuhra, barakalla!');
  assert.ok(other.freeMd.includes('barakalla'));
  assert.strictEqual(other.lockedTitles.length, 0);
});

test('everything a parent would act on is locked', () => {
  const { freeMd, lockedTitles } = paywall.split(REPORT);
  assert.deepStrictEqual(lockedTitles,
    ['Hozirgi o‘rni', 'Iqtidorlar xaritasi', 'O‘rganish usuli', 'Kattalar uchun']);
  for (const leak of ['Mantiq va tafakkur', 'Mantiqiy-matematik', 'Amaliy-harakatli', 'Kuzatib boring']) {
    assert.ok(!freeMd.includes(leak), 'leaked into the free part: ' + leak);
  }
});

test('the locked section titles are reported, so the wall is not blank', () => {
  const r = paywall.publicReport(
    { content_md: REPORT, nickname: 'Ali', grade: 2, partial: false, created_at: 'd', sports: ['suzish'] },
    { paid: false, priceUzs: 49000 });
  assert.strictEqual(r.locked, true);
  assert.ok(r.locked_sections.length === 4);
  assert.strictEqual(r.price_uzs, 49000);
});

// The headline finding must not leak through the JSON while the prose is
// hidden — that would hand the result to anyone who opened the network tab.
test('structured findings are withheld until paid', () => {
  const row = {
    content_md: REPORT, nickname: 'Ali', grade: 2, partial: false, created_at: 'd',
    level_logic: 'kuchli', level_psych: 'me’yorda', level_activity: 'shakllanmoqda',
    sports: ['suzish', 'shaxmat'],
  };
  const locked = paywall.publicReport(row, { paid: false, priceUzs: 49000 });
  assert.deepStrictEqual(locked.levels, { logic: null, psych: null, activity: null });
  assert.deepStrictEqual(locked.sports, []);

  const paid = paywall.publicReport(row, { paid: true, priceUzs: 49000 });
  assert.strictEqual(paid.locked, false);
  assert.strictEqual(paid.levels.logic, 'kuchli');
  assert.deepStrictEqual(paid.sports, ['suzish', 'shaxmat']);
  assert.strictEqual(paid.content_md, REPORT, 'a paid report is the whole thing');
});

test('the child name and date are shown either way', () => {
  const locked = paywall.publicReport({ content_md: REPORT, nickname: 'Ali', grade: 2, created_at: 'd' },
    { paid: false, priceUzs: 1 });
  assert.strictEqual(locked.nickname, 'Ali');
  assert.strictEqual(locked.grade, 2);
});

test('a report with no headings does not crash the split', () => {
  const { freeMd, lockedTitles } = paywall.split('shunchaki matn');
  assert.strictEqual(freeMd, 'shunchaki matn');
  assert.deepStrictEqual(lockedTitles, []);
  assert.deepStrictEqual(paywall.split('').lockedTitles, []);
  assert.deepStrictEqual(paywall.split(null).freeMd, '');
});

// ---- when a reminder may be sent ------------------------------------------
// Loaded after the config is set, since the window comes from it.
process.env.REMIND_QUIET_FROM = '21';
process.env.REMIND_QUIET_TO = '9';
process.env.REMIND_TZ_OFFSET = '5';
delete require.cache[require.resolve('../../server/config')];
delete require.cache[require.resolve('../../server/services/reminders')];
const reminders = require('../../server/services/reminders');

// Uzbekistan is UTC+5, so 06:00 UTC is 11:00 there.
const utc = (h) => new Date(Date.UTC(2026, 0, 15, h, 0, 0));

test('nothing is sent in the middle of the night', () => {
  assert.strictEqual(reminders.withinQuietHours(utc(22)), true, '03:00 local');
  assert.strictEqual(reminders.withinQuietHours(utc(1)), true, '06:00 local');
  assert.strictEqual(reminders.withinQuietHours(utc(19)), true, '24:00 local');
});

test('daytime is allowed', () => {
  assert.strictEqual(reminders.withinQuietHours(utc(6)), false, '11:00 local');
  assert.strictEqual(reminders.withinQuietHours(utc(11)), false, '16:00 local');
});

// The window wraps midnight, which a naive "between from and to" gets exactly
// backwards — it would send at 3am and stay silent all day.
test('the quiet window wraps midnight correctly', () => {
  // Boundaries: quiet runs [21:00, 09:00), so 08:00 is still quiet and 09:00
  // is the first hour a reminder may go out.
  assert.strictEqual(reminders.withinQuietHours(utc(3)), true, '08:00 local — still quiet');
  assert.strictEqual(reminders.withinQuietHours(utc(4)), false, '09:00 local — allowed');
  assert.strictEqual(reminders.withinQuietHours(utc(15)), false, '20:00 local — last allowed hour');
  assert.strictEqual(reminders.withinQuietHours(utc(16)), true, '21:00 local — quiet again');
});

// ---- what the messages say ------------------------------------------------

test('every reminder names the child and offers a way out', () => {
  const m = reminders.messageFor('abandoned', { nickname: 'Ali', session_token: 'tok' });
  assert.ok(m.includes('Ali'));
  assert.ok(m.includes('/stop'), 'an opt-out the parent can actually use');
  assert.ok(m.includes('/mashgulot/tok'), 'a link back to what they left');
});

test('the unpaid reminder states the price', () => {
  const m = reminders.messageFor('unpaid', { nickname: 'Zuhra', share_token: 'sh', amount: 4900000 });
  assert.ok(m.includes('49 000 so‘m'), m);
  assert.ok(m.includes('/hisobot/sh'));
});

test('an unknown reminder kind produces nothing to send', () => {
  assert.strictEqual(reminders.messageFor('made_up', {}), null);
});

console.log('\n' + pass + ' passed, 0 failed');
