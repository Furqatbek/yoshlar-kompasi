// LIVE smoke test — drives a real sitting against a RUNNING app configured with
// a REAL LLM key. This is the pre-deploy check the stubs cannot give you: it is
// the only thing that reads what an actual model writes.
//
//   BASE_URL=http://127.0.0.1:8080 node test/live-smoke.js
//
// COSTS REAL MONEY, but much less than it used to: a sitting makes exactly ONE
// model call, for the report (roughly $0.02-0.10 depending on model). Starting
// a sitting and answering seventy questions costs nothing — the app serves the
// questions from its own bank and scores them itself.
//
// So this is a test of the report, which is the whole of what the model
// produces and the whole of what is sold. Use it to answer "is this model good
// enough?": run it against a free slug and a paid one and read both reports.
//
// Run it after every prompt change and before every deploy.
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
let pass = 0, fail = 0, warn = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? '  :: ' + x : '')); };
const note = (n, c, x) => { if (c) { console.log('ok   ' + n); } else { warn++; console.log('WARN ' + n + (x ? '  :: ' + x : '')); } };
async function j(path, opts) { const r = await fetch(BASE + path, opts); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, data: d }; }
const H = { 'content-type': 'application/json' };

// A child with a shape: high on building and science, low on tidiness. The
// report has to come back saying that and not something else — which is the
// one thing only a real model can be checked on.
function answerFor(n) {
  if (n >= 1 && n <= 6) return 5;    // construction
  if (n >= 13 && n <= 18) return 5;  // science
  if (n >= 43 && n <= 48) return 1;  // organization
  if (n >= 49 && n <= 54) return 2;  // sport
  return 3;
}

(async () => {
  console.log('live smoke against', BASE, '(real LLM — the report call spends credits)\n');

  // 1. Starting a sitting. No model is involved, so this is a latency check as
  //    much as anything: if it takes seconds, something is calling out again.
  const t0 = Date.now();
  let r = await j('/api/sessions', { method: 'POST', headers: H, body: JSON.stringify({ consent: true, nickname: 'Sinov', grade: 2, age: 7 }) });
  const createMs = Date.now() - t0;
  ok('create session -> 201', r.status === 201, 'status=' + r.status + ' ' + JSON.stringify(r.data));
  const stok = r.data && r.data.session_token;
  ok('  no model call: nothing visible is created',
    ((r.data && r.data.messages) || []).filter((m) => !m.meta).length === 0);
  ok('  so it is fast (' + createMs + 'ms)', createMs < 3000, createMs + 'ms — a model call is back in the start path');

  // 2. The inventory, served and answered the way the browser does it.
  const A = { 'content-type': 'application/json', 'x-session-token': stok };
  let q = await j('/api/sessions/' + stok + '/questions', { headers: A });
  ok('the questions come from the bank', q.status === 200 && (q.data.questions || []).length >= 60,
    'n=' + ((q.data.questions || []).length));
  ok('  with the scale the child answers on', (q.data.scale || []).length === 5);
  const answers = (q.data.questions || []).map((x) => ({ n: x.n, value: answerFor(x.n) }));
  r = await j('/api/sessions/' + stok + '/answers', { method: 'POST', headers: A, body: JSON.stringify({ answers }) });
  ok('every answer is recorded', r.status === 200 && r.data.progress
    && r.data.progress.answered === answers.length,
    JSON.stringify(r.data && r.data.progress));

  // 3. The one real model call.
  await j('/api/sessions/' + stok + '/contact', { method: 'POST', headers: A, body: JSON.stringify({ parent_name: 'Sinovchi' }) });
  console.log('\ngenerating report (can take 1-3 minutes)...');
  const t1 = Date.now();
  r = await j('/api/sessions/' + stok + '/report', { method: 'POST', headers: A, body: '{}' });
  const secs = Math.round((Date.now() - t1) / 1000);
  ok('report -> 200 with share_token (' + secs + 's)', r.status === 200 && !!(r.data && r.data.share_token),
    'status=' + r.status + ' ' + JSON.stringify(r.data));
  ok('a fully answered sitting is not flagged partial', r.data && r.data.partial === false,
    'partial=' + (r.data && r.data.partial));

  // 4. What the model actually wrote.
  const pub = await j('/api/reports/' + r.data.share_token);
  ok('public report -> 200', pub.status === 200);
  const md = (pub.data && pub.data.content_md) || '';
  const cats = (pub.data && pub.data.categories) || {};
  if (pub.data && pub.data.locked) {
    // The report is sold, so the public link shows the free sections and
    // withholds the rest until someone pays. Everything below reads the full
    // text, which there is no way to fetch without an order.
    console.log('\n--- the free sections, as an unpaid reader sees them ---\n'
      + md + '\n---\nLocked: ' + JSON.stringify(pub.data.locked_sections) + '\n');
    ok('the free part is substantial', md.length > 200, 'len=' + md.length);
    ok('  and the rest is withheld, not missing',
      (pub.data.locked_sections || []).length >= 4, JSON.stringify(pub.data.locked_sections));
    console.log('\n==== live smoke: ' + pass + ' passed, ' + fail + ' failed, ' + warn + ' warnings ====');
    console.log('To judge the whole report, run against a build with PAYMENTS_ENABLED=false,');
    console.log('or pay for this one and re-open: ' + BASE + '/hisobot/' + r.data.share_token);
    process.exit(fail ? 1 : 0);
  }
  ok('report body substantial', md.length > 400, 'len=' + md.length);
  ok('report uses ## sections', (md.match(/^## /gm) || []).length >= 3, 'sections=' + (md.match(/^## /gm) || []).length);
  ok('the twelve areas came back scored', Object.keys(cats).length === 12, String(Object.keys(cats).length));

  // The scores are the server's arithmetic, not the model's, so these are not
  // a check on the model — they are a check that the report we served is about
  // the child who answered.
  ok('the scores match the answers given',
    cats.construction_engineering && Number(cats.construction_engineering.average) === 5
    && cats.organization && Number(cats.organization.average) === 1,
    JSON.stringify({ build: cats.construction_engineering, tidy: cats.organization }));
  ok('  and the top areas are the ones answered highest',
    JSON.stringify((pub.data.top_interests || []).slice().sort())
      .includes('construction_engineering'),
    JSON.stringify(pub.data.top_interests));

  // These are judgement calls on the prose, which is what a weak model gets
  // wrong. Warnings, not failures: read them.
  note('the model wrote about the strong areas',
    /konstruktor|muhandis|qurilish/i.test(md) && /fan|tadqiqot|tajriba/i.test(md),
    'the report does not mention what the child answered highest on');
  // The area is called "Tashkiliy qobiliyat" in the bank and
  // "Tashkilotchilik" in the protocol, so match the stem.
  note('it is honest about the low area rather than silent',
    /tashkil|tartib/i.test(md));
  note('no claims the inventory cannot support',
    !/emotsional intellekt|o.rganish uslubi|iqtidorlar xaritasi|\bIQ\b/i.test(md),
    'the report claims something seventy agreement ratings cannot show');
  note('no ability score, percentile or ranking',
    !/foiz|protsentil|reyting|o.rtacha bola|boshqa bolalarga nisbatan/i.test(md));
  note('no leftover answer markers', !/\[JAVOBLAR:|\[YAKUN:/i.test(md));
  note('the child is addressed by name somewhere', /Sinov/.test(md));
  note('clubs were recommended', (pub.data.clubs || []).length > 0, JSON.stringify(pub.data.clubs));
  note('it is Uzbek, not Russian or English',
    !/\b(the|and|very)\b/i.test(md) && !/[а-яА-Я]/.test(md));

  console.log('\n--- report section headers ---\n' + (md.match(/^## .*$/gm) || []).join('\n') + '\n---\n');
  console.log('Full report link: ' + BASE + '/hisobot/' + r.data.share_token);
  console.log('(token usage & cost: admin panel -> Statistika -> LLM xarajati)');

  console.log('\n==== live smoke: ' + pass + ' passed, ' + fail + ' failed, ' + warn + ' warnings ====');
  if (warn) console.log('Warnings are prompt-quality signals — read the report and judge.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('LIVE SMOKE ERROR', e); process.exit(2); });
