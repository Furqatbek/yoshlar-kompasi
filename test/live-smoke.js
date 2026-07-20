// LIVE smoke test — drives a real minimal session against a RUNNING app that is
// configured with a REAL LLM key. This is the pre-deploy check that stub tests
// cannot give you: it verifies the actual model follows the prompt contract.
//
//   BASE_URL=http://127.0.0.1:8080 node test/live-smoke.js
//
// COSTS REAL MONEY (one short session: greeting + 2 turns + report — roughly
// $0.05-0.20 depending on model). Run it after every prompt change and before
// every deploy. It does NOT use stubs.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
let pass = 0, fail = 0, warn = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  :: ' + x : '')); };
const note = (n, c, x) => { if (c) { console.log('ok   ' + n); } else { warn++; console.log('WARN ' + n + (x ? '  :: ' + x : '')); } };
async function j(path, opts) { const r = await fetch(BASE + path, opts); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, data: d }; }
const H = { 'content-type': 'application/json' };

(async () => {
  console.log('live smoke against', BASE, '(real LLM — this spends credits)\n');

  // 1. Real greeting.
  let r = await j('/api/sessions', { method: 'POST', headers: H, body: JSON.stringify({ consent: true, nickname: 'Sinov', grade: 2, age: 7 }) });
  ok('create session -> 201', r.status === 201, 'status=' + r.status + ' ' + JSON.stringify(r.data && r.data.api_error));
  const stok = r.data && r.data.session_token;
  const greeting = ((r.data && r.data.messages) || []).filter((m) => m.role === 'assistant').map((m) => m.content).join('\n');
  ok('real greeting arrived (non-empty)', greeting.length > 50, 'len=' + greeting.length);
  note('greeting has child-facing blockquote (>)', /^>\s/m.test(greeting));
  note('greeting has NO premature [YAKUN] markers', !/\[YAKUN:/i.test(greeting), 'markers in greeting');
  console.log('\n--- greeting excerpt ---\n' + greeting.slice(0, 400) + '\n---\n');

  // 2. Two real answers.
  r = await j('/api/sessions/' + stok + '/messages', { method: 'POST', headers: H, body: JSON.stringify({ content: "Sinov birinchi savolga to'g'ri javob berdi. Ikkinchisiga: '25' dedi, tez va ishonch bilan." }) });
  ok('turn 1 -> 200 non-empty reply', r.status === 200 && r.data.reply && r.data.reply.length > 20, 'status=' + r.status);
  r = await j('/api/sessions/' + stok + '/messages', { method: 'POST', headers: H, body: JSON.stringify({ content: "Sinov: bo'sh kunimda biror narsani BILIB OLISHNI tanlayman, olim bo'lish qiziq dedi. Kun-tun o'yinida 8 tadan 6 tasini to'g'ri bajardi, adashganda kulib yubordi va yana urindi." }) });
  ok('turn 2 -> 200 non-empty reply', r.status === 200 && r.data.reply && r.data.reply.length > 20, 'status=' + r.status);
  note('progress markers appearing or pending (info)', true, JSON.stringify(r.data && r.data.progress));

  // 3. Real report.
  await j('/api/sessions/' + stok + '/contact', { method: 'POST', headers: H, body: JSON.stringify({ parent_name: 'Sinovchi' }) });
  console.log('\ngenerating report (can take 1-3 minutes)...');
  const t0 = Date.now();
  r = await j('/api/sessions/' + stok + '/report', { method: 'POST', headers: H, body: '{}' });
  const secs = Math.round((Date.now() - t0) / 1000);
  ok('report -> 200 with share_token (' + secs + 's)', r.status === 200 && !!(r.data && r.data.share_token), 'status=' + r.status + ' ' + JSON.stringify(r.data));
  ok('report flagged partial (only 2 answers)', !!(r.data && r.data.partial === true), 'partial=' + (r.data && r.data.partial));

  // 4. Contract checks on the real report.
  const pub = await j('/api/reports/' + r.data.share_token);
  ok('public report -> 200', pub.status === 200);
  const md = (pub.data && pub.data.content_md) || '';
  ok('report body substantial', md.length > 400, 'len=' + md.length);
  ok('report uses ## sections', (md.match(/^## /gm) || []).length >= 3, 'sections=' + (md.match(/^## /gm) || []).length);
  ok('structured levels parsed from JSON block', pub.data && pub.data.levels && typeof pub.data.levels === 'object', JSON.stringify(pub.data && pub.data.levels));
  note('honest partial: unassessed levels are null', !!(pub.data && pub.data.levels && Object.values(pub.data.levels).some((v) => v === null)), JSON.stringify(pub.data && pub.data.levels));
  note('no fabricated full-marks', !(pub.data && pub.data.levels && Object.values(pub.data.levels).every((v) => v === 'kuchli')));
  note('markers stripped from report text', !/\[YAKUN:/i.test(md));
  console.log('\n--- report section headers ---\n' + (md.match(/^## .*$/gm) || []).join('\n') + '\n---\n');
  console.log('Full report link: ' + BASE + '/hisobot/' + r.data.share_token);
  console.log('(token usage & cost: admin panel -> Statistika -> LLM xarajati)');

  console.log('\n==== live smoke: ' + pass + ' passed, ' + fail + ' failed, ' + warn + ' warnings ====');
  if (warn) console.log('Warnings are prompt-quality signals — read the report and judge.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('LIVE SMOKE ERROR', e); process.exit(2); });
