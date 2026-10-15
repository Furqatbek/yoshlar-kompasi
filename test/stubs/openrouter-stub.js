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

const REALISTIC = process.env.STUB_MODE === 'realistic';
const GREETING = [
  'Assalomu alaykum! Ali bilan mashg‘ulotni boshlaymiz.',
  'Har bir savolga 1–5 oralig‘ida javob bering.',
  '',
  '> LEGO yoki konstruktor yig‘ishni yaxshi ko‘raman.',
  '',
  'Javobini yozing.',
].join('\n');

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (!/\/chat\/completions$/.test(req.url)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'not found: ' + req.url } }));
    }
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
    const isGreeting = lastUser && /1-savoldan boshlang/i.test(lastUser.content || '');
    let text;
    if (isReport) text = REPORT;
    else if (REALISTIC && isGreeting) text = GREETING; // no markers
    else text = TURN();
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
