// OpenRouter (OpenAI-compatible) /chat/completions stub for full e2e testing.
// Mirrors stub-claude.js content but in OpenAI response shape.
const http = require('http');

const REPORT = [
  '## Surat',
  '- **Qonuniyatlarni tez ilg‘aydi** — topshiriqlarni mustaqil yechdi.',
  '- **Qat‘iyatli** — xato javobdan keyin yana urindi.',
  '## Hozirgi o‘rni',
  "- **Mantiq va tafakkur** — Kuchli. Ketma-ketliklarni tez davom ettirdi.",
  "- **Psixologiya va qiziqishlar** — Me’yorda. Qiziquvchan.",
  '- **Tana va harakat** — Shakllanmoqda. Muvozanat mashq talab qiladi.',
  '## Maqsad va yo‘l xaritasi',
  'Maqsad: matematikada kuchli bo‘lish.',
  '1. Haftasiga 3 kun qonuniyat topshirig‘i.',
  '2. Oyiga bitta mantiqiy o‘yin.',
  '## Nimani o‘rganish va mashq qilish',
  '- **Mantiq** — kuniga 2 ta topshiriq.',
  '## Tavsiya etilgan sport va mashg‘ulotlar',
  '- **Futbol** — g‘ayrati baland.',
  '- **Shaxmat** — strategik fikrlaydi.',
  '## Ali uchun xat',
  'Ali, sen qiyin savollardan qo‘rqmaysan!',
  '## Kattalar uchun',
  '- Urinishni maqtang.',
  '',
  '```json',
  '{"levels": {"mantiq": "kuchli", "psixologiya": "meyorda", "harakat": "shakllanmoqda"}, "sports": ["Futbol", "Shaxmat"]}',
  '```',
].join('\n');

const TURN = [
  'Rahmat! Ali bilan boshlaymiz. Quyidagilarni ovoz chiqarib o‘qing:',
  '',
  '> Doira, kvadrat, doira, kvadrat... keyin nima keladi?',
  '',
  '> Senda 3 ta konfet bor edi, 2 ta qo‘shildi. Nechta bo‘ldi?',
  '',
  'Javoblarini yozing.',
  '[YAKUN: MANTIQ]',
  '[YAKUN: PSIXOLOGIYA]',
  '[YAKUN: HARAKAT]',
].join('\n');

// A greeting has no answers yet, so it must NOT emit [YAKUN] markers. STUB_MODE=
// realistic reproduces that (the default keeps the marker-on-greeting behaviour
// the older e2e-driver relies on).
const REALISTIC = process.env.STUB_MODE === 'realistic';
const GREETING = [
  'Assalomu alaykum! Ali bilan mashg‘ulotni boshlaymiz. Quyidagini ovoz chiqarib o‘qing:',
  '',
  '> Doira, kvadrat, doira, kvadrat... keyin nima keladi?',
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
    const isReport = lastUser && /hisobotni tayyorlang/i.test(lastUser.content || '');
    const isGreeting = lastUser && /birinchi savollar guruhini bering/i.test(lastUser.content || '');
    let text;
    if (isReport) text = REPORT;
    else if (REALISTIC && isGreeting) text = GREETING; // no markers
    else text = TURN;
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
