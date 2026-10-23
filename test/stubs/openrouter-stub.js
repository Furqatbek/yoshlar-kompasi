// OpenRouter (OpenAI-compatible) /chat/completions stub for full e2e testing.
// Mirrors stub-claude.js content but in OpenAI response shape.
const http = require('http');

const REPORT = [
  '## Qisqacha xulosa',
  'Ali hozirda yasash va tekshirishga qiziqadi. Bu qobiliyat bahosi emas —',
  'u shu kunlarda nimani yoqtirishini ko‘rsatadi.',
  '## 12 yo‘nalish bo‘yicha natijalar',
  '- **Konstruktorlik va muhandislik** — 6/6 javob, o‘rtacha 4.50 — kuchli qiziqish bildirildi.',
  '- **Mantiq va matematika** — 6/6 javob, o‘rtacha 4.00 — qiziqish sezilarli.',
  '- **Tashkiliy qobiliyat** — 6/6 javob, o‘rtacha 1.83 — hozircha kamroq qiziqish bildirildi.',
  '## Hozirgi qiziqishlar xaritasi',
  '- **Konstruktorlik va muhandislik** — konstruktor bilan kichik ko‘prik yasab ko‘ring.',
  '## Rivojlantirish mumkin bo‘lgan yo‘nalishlar',
  '- **Tashkiliy qobiliyat** — bu hozircha qiziq emas; qobiliyatsizlik emas.',
  '## To‘garak va mashg‘ulot tavsiyalari',
  '- **Robototexnika to‘garagi** — qurish javoblariga bog‘liq.',
  '- **Shaxmat** — mantiq javoblariga bog‘liq.',
  '## Bolaga o‘qib beriladigan dalda',
  'Ali, sen qiyin savollardan qo‘rqmaysan!',
  '## Kattalar uchun muhim eslatmalar',
  'Bu standartlashtirilgan test emas. Qiziqishlar vaqt bilan o‘zgaradi.',
  '',
  '```json',
  '{"categories": {"construction_engineering": {"answered": 6, "average": 4.5, "interest": "strong"}},'
    + ' "top_interests": ["construction_engineering"], "developing_interests": ["organization"],'
    + ' "clubs": ["Robototexnika to‘garagi"], "sports": ["Futbol", "Shaxmat"], "data_completeness": "complete"}',
  '```',
].join('\n');

// The app serves the questions and records the answers itself, so a reply that
// claimed answers would be inventing them. The stub stays out of it.

// An ordinary conversational turn, kept for the /messages route. Starting a
// sitting no longer calls the model at all, so there is no greeting to fake:
// a stub that answered one would be covering for a request the app must not
// make.
const TURN = () => [
  'Savollarni ilovaning o‘zi ko‘rsatadi.',
  'Bola javoblarini belgilab boring; yakunda hisobot tayyorlanadi.',
].join('\n');

// How many completions the app has asked for. A test can read it before and
// after a step and assert on the difference, which is the only way to prove a
// call did NOT happen — a missing greeting looks identical to a fast one from
// the outside.
let calls = 0;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (/\/__calls$/.test(req.url)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ calls }));
    }
    // The key check the app runs at boot, so a test run does not print a
    // provider warning about a stub that simply never implemented it. Not
    // counted in `calls`: that counts generations, and this is not one.
    if (/\/key$/.test(req.url)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: { label: 'stub', usage: 0, limit: null } }));
    }
    if (!/\/chat\/completions$/.test(req.url)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'not found: ' + req.url } }));
    }
    calls++;
    let payload = {};
    try { payload = JSON.parse(body); } catch (e) {}
    // Mimic real OpenRouter: model ids are namespaced vendor/model slugs. A bare
    // Anthropic id like `claude-sonnet-4-6` is rejected with 400.
    const model = payload.model || '';
    if (!model.includes('/')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: model + ' is not a valid model id', code: 400 } }));
    }
    const msgs = payload.messages || [];
    // Sanity: OpenAI format must start with a system message and carry no
    // top-level `system` field.
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const isReport = lastUser && /\[HISOBOT-SOROVI\]/i.test(lastUser.content || '');
    const text = isReport ? REPORT : TURN();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'gen-stub', object: 'chat.completion', model: payload.model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    }));
  });
});
const PORT = parseInt(process.env.STUB_PORT || '5602', 10);
server.listen(PORT, () => console.log('[openrouter-stub] on :' + PORT + ' (/chat/completions)'));
