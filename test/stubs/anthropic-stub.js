// Minimal Anthropic /v1/messages stub for integration testing.
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

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch (e) {}
    const msgs = payload.messages || [];
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const isReport = lastUser && /hisobotni tayyorlang/i.test(lastUser.content || '');
    const text = isReport ? REPORT : TURN;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_stub', type: 'message', role: 'assistant',
      content: [{ type: 'text', text }],
      model: payload.model, stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 200 },
    }));
  });
});
const PORT = parseInt(process.env.STUB_PORT || '5599', 10);
server.listen(PORT, () => console.log('[anthropic-stub] on :' + PORT));
