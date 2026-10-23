'use strict';

// System-prompt assembly for CareerKids.
// Sources: loyiha-korsatmalari-uz.md and savollar-banki-1-4-sinflar-uz.md.
// Aligned with the 70-question bank and 12 interest areas.
// The 30-day development plan has been removed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../config');

function readSource(name) {
  const p = path.join(config.promptSourceDir, name);
  return fs.readFileSync(p, 'utf8').trim();
}

const PROTOCOL = `## 70 savolli baholash protokoli (majburiy)

Siz CareerKids veb-ilovasi ichida ishlayapsiz. Maqsad — 1–4-sinf o‘quvchisining hozirgi qiziqishlarini aniqlash va kattalarga bolani rivojlantirish uchun amaliy tavsiyalar berish.

1. Savollar bankidagi 70 ta savolni va ularning tartibini o‘zgartirmang. Savol matnlarini qayta tuzmang, almashtirmang yoki yangisini qo‘shmang. Savol banki loyiha ko‘rsatmalariga biriktirilgan manbadan olinadi.

2. Har bir savolga 1–5 oralig‘ida javob olinadi. Shkala «bu menmi?» degan savolga javob beradi, «yoqadimi?» degan savolga emas:
   1 — yo‘q, bu men emas;
   2 — kamdan-kam;
   3 — ba’zan;
   4 — ko‘pincha;
   5 — ha, bu aynan men.
   Javobni bolaning o‘rniga tanlamang.

3. Savollarni siz bermaysiz. Ilova 70 ta savolni o‘zi ko‘rsatadi va 1–5 javoblarni o‘zi yozib oladi; sizning vazifangiz — yig‘ilgan javoblar asosida hisobot yozish. Emoji ishlatmang.

4. Savol raqami, matni, javobi va tegishli yo‘nalishini aniq saqlang. Javobni bolaning o‘rniga tanlamang. Katta javobni kiritayotgan bo‘lsa, uni aynan bildirgan javobi sifatida qayd eting.

5. 70 savol 12 yo‘nalishga tegishli:
   - Qurilish va muhandislik: 1–6
   - Mantiq va matematika: 7–12
   - Fan va tadqiqot: 13–18
   - Ijodkorlik: 19–24
   - Nutq va til: 25–30
   - Yetakchilik: 31–36
   - Hamdardlik va yordam: 37–42
   - Tashkilotchilik: 43–48
   - Sport va harakat: 49–54
   - Texnologiya: 55–60
   - O‘sish tafakkuri: 61–65
   - Qiziquvchanlik: 66–70

6. Har bir yo‘nalishning o‘rtacha ballini faqat shu yo‘nalishga tegishli savollarga berilgan haqiqiy javoblardan hisoblang. Savol javobsiz qolsa, uni 0 deb olmang va o‘rtacha qiymatni sun’iy pasaytirmang. Yo‘nalishdagi javoblar yetarli bo‘lmasa, uni “yetarli ma’lumot yo‘q” deb belgilang.

7. Ballar qiziqish darajasini ko‘rsatadi, bolaning obyektiv qobiliyati, aqli, shaxsiyati yoki kelajakdagi kasbini aniqlamaydi. Natijalarni tashxis, qat’iy yorliq yoki boshqa bolalar bilan taqqoslash sifatida bermang.

8. Natijalarni sharhlash uchun faqat quyidagi ehtiyotkor diapazonlardan foydalanish mumkin:
   - 1.00–2.49 — hozircha qiziqish kamroq ko‘rindi
   - 2.50–3.49 — qiziqish vaziyatga qarab o‘zgarishi mumkin
   - 3.50–4.19 — qiziqish sezilarli
   - 4.20–5.00 — qiziqish yuqori ko‘rindi

   Bu diapazonlar klinik yoki standartlashtirilgan test me’yorlari emasligini kattalarga eslating.

9. Bola istalgan savolni o‘tkazib yuborishi yoki mashg‘ulotni keyin davom ettirishi mumkin. Javob bermaslikni salbiy xususiyat deb talqin qilmang.

10. Baholashga aloqasi bo‘lmagan so‘rovlarni muloyimlik bilan rad eting.

11. Siz faqat “[HISOBOT-SOROVI]” belgisi bilan boshlangan so‘rovga javob yozasiz — bir mashg‘ulotga bir marta. Javoblar sizga shu so‘rov ichida hisoblangan holda beriladi.

12. Har bir xulosa dalilga tayanishi shart. Bola aytmagan, savollarda o‘lchanmagan yoki mashg‘ulotda kuzatilmagan jihatlarni uydirmang. Musiqiy qobiliyat, emotsional intellekt, o‘rganish uslubi, sportga moslik yoki kasbiy salohiyat haqida maxsus dalil bo‘lmasa, ularni aniqlangandek yozmang.
`;

const REPORT_JSON_RULE = `## Hisobot uchun tuzilmali ma’lumot (majburiy)

To‘liq hisobot matnidan keyin eng oxirida faqat bitta JSON bloki yozing. JSON quyidagi tuzilishga ega bo‘lsin:

\`\`\`json
{
  "categories": {
    "construction_engineering": {
      "answered": 6,
      "average": null,
      "interest": null
    },
    "logic_math": {
      "answered": 6,
      "average": null,
      "interest": null
    },
    "science_research": {
      "answered": 6,
      "average": null,
      "interest": null
    },
    "creativity": {
      "answered": 6,
      "average": null,
      "interest": null
    },
    "speech_language": {
      "answered": 6,
      "average": null,
      "interest": null
    },
    "leadership": {
      "answered": 6,
      "average": null,
      "interest": null
    },
    "empathy_helping": {
      "answered": 6,
      "average": null,
      "interest": null
    },
    "organization": {
      "answered": 6,
      "average": null,
      "interest": null
    },
    "sport_activity": {
      "answered": 6,
      "average": null,
      "interest": null
    },
    "technology": {
      "answered": 6,
      "average": null,
      "interest": null
    },
    "growth_mindset": {
      "answered": 5,
      "average": null,
      "interest": null
    },
    "curiosity": {
      "answered": 5,
      "average": null,
      "interest": null
    }
  },
  "top_interests": [],
  "developing_interests": [],
  "clubs": [],
  "sports": [],
  "data_completeness": "complete"
}
\`\`\`

Qoidalar:
- “answered” — shu yo‘nalishdagi haqiqiy javoblar soni.
- “average” — javoblangan savollarning arifmetik o‘rtachasi.
- “interest” — yuqoridagi diapazonlardan mos tavsif. Ma’lumot yetarli bo‘lmasa, average va interest null bo‘lsin.
- “top_interests” va “developing_interests” faqat ballar bilan asoslangan yo‘nalishlarni o‘z ichiga olsin. Teng ball bo‘lsa, sun’iy ravishda bittasini ustun qo‘ymang.
- “clubs” va “sports” faqat javoblar bilan asoslangan ehtiyotkor tavsiyalar bo‘lsin. Dalil bo‘lmasa, bo‘sh ro‘yxat ishlating.
- “data_completeness” faqat “complete” yoki “partial” bo‘lsin.
- JSON yaroqli bo‘lsin: sharhlar, izohlar yoki trailing comma qo‘shmang.
- JSON tarkibiga 30 kunlik reja yoki kunlik vazifalar qo‘shmang.`;

let _prompt = null;
let _version = null;

// Drop the assembled prompt so the next call rebuilds it. Called when the
// question bank changes: an edited bank is a different instrument and must not
// go on serving the cached text, nor keep the old version hash.
function invalidate() { _prompt = null; _version = null; }

function assemble() {
  if (_prompt) return _prompt;

  const instructions = readSource('loyiha-korsatmalari-uz.md');
  // The live bank when the database has been read (the admin panel can edit
  // it), otherwise the seeded file — so a cold start never serves an empty one.
  const bank = require('./questionBank').cachedMarkdown()
    || readSource('savollar-banki-1-4-sinflar-uz.md');

  _prompt = [
    instructions,
    bank,
    PROTOCOL,
    REPORT_JSON_RULE
  ].join('\n\n---\n\n');

  // The version has to identify everything that shapes a report, not just the
  // system prompt. The report brief is sent as a separate turn at report time,
  // so hashing only _prompt would let two reports share a version while having
  // been written to different instructions — and sessions.prompt_version is how
  // a surprising report gets traced back to what produced it.
  const brief = JSON.stringify(
    (require('./questionBank').cachedReportSections()
      || require('../data/reportTemplate').SECTIONS)
      .map((sec) => [sec.key, sec.heading, sec.instruction])
  );

  const hash = crypto
    .createHash('sha256')
    .update(_prompt + '\n\x00brief\x00' + brief)
    .digest('hex')
    .slice(0, 12);

  _version = config.promptVersionOverride || 'v2-' + hash;

  return _prompt;
}

function systemPrompt() {
  return assemble();
}

function promptVersion() {
  assemble();
  return _version;
}

// Who the sitting is about. This is stored once, when the session is created,
// and is the only thing the model ever learns about the child besides the
// scores — goal and notes stay in our database.
//
// It used to be an instruction to greet the adult and start asking from
// question 1, and starting a sitting waited on the model's reply to it. The
// app asks the questions now, so there is nothing to instruct: this is a
// statement of fact that costs no round trip.
function childContext(c) {
  let s = 'Bola haqida: ism yoki taxallus — ' + c.nickname + '; sinf — ' + Number(c.grade) + '-sinf';
  if (c.age) s += '; yosh — ' + c.age;
  return s + '.';
}

// The one request the model ever answers. It is a shared constant because two
// other places have to recognise it: the route, to know whether this sitting
// has already been asked, and the system prompt, which tells the model to
// write a report only when it sees this.
const REPORT_MARKER = '[HISOBOT-SOROVI]';

// `scored` is services/scoring.js output. It is embedded verbatim because the
// inventory is a form: there is no conversation for the model to read results
// out of, and letting it recompute them from raw answers is how a skipped
// question becomes a zero.
function buildReportRequest(name, partial, scored) {
  const partialRule = partial
    ? ' Diqqat: baholash qisman yakunlangan. Hisobot boshida ma’lumotlar ' +
      'to‘liq emasligini ayting. Javobsiz savollarni taxmin qilmang; ' +
      'yetarli ma’lumot bo‘lmagan yo‘nalishlarda ball va xulosa bermang.\n'
    : '';

  // The section briefs come from the database when it has been read, so an
  // administrator editing the report wording changes the next report. The
  // shipped template is the fallback, which keeps a cold start producing a
  // correct report rather than a headless one.
  const sections = require('./questionBank').cachedReportSections()
    || require('../data/reportTemplate').SECTIONS;

  const body = sections
    .map((sec) => '## ' + sec.heading + '\n' + sec.instruction + '\n')
    .join('\n');

  let results = '';
  if (scored && scored.categories) {
    const lines = Object.entries(scored.categories).map(([key, c]) => {
      const title = c.title || key;
      if (c.average == null) return '- ' + title + ': yetarli ma\u2019lumot yo\u2018q (' + c.answered + '/' + c.of + ' javob)';
      return '- ' + title + ': o\u2018rtacha ' + c.average.toFixed(2) + ' (' + c.answered + '/' + c.of
        + ' javob) — ' + (c.label || '');
    });
    results =
      '\nHisoblangan natijalar (tizim hisobladi — qayta hisoblamang, o\u2018zgartirmang):\n'
      + lines.join('\n')
      + '\n\nJami javob: ' + scored.answered + '/' + scored.total
      + '; to\u2018liqlik: ' + scored.data_completeness + '.\n';
  }

  // The name is repeated here rather than left to the stored context turn: the
  // report addresses the child directly, and it must not depend on how much of
  // the history happens to survive normalization.
  return (
    REPORT_MARKER + ' ' + (name ? name + ' bilan mashg‘ulot yakunlandi.' : 'Mashg‘ulot yakunlandi.') +
    partialRule +
    ' Hisobotni faqat bolaning 70 savolga bergan haqiqiy javoblari va ' +
    'qayd etilgan kuzatuvlar asosida tayyorlang. Hech narsa uydirmang. ' +
    results +
    '\nMarkdown formatida quyidagi sarlavhalarni aynan shu tartibda va aynan shu ' +
    'matn bilan ishlating:\n\n' +
    body +
    '\nHisobot matnidan keyin REPORT_JSON_RULE da ko‘rsatilgan tuzilishga ' +
    'mos bitta JSON blokini yozing. JSON qiymatlari hisobotdagi haqiqiy ' +
    'natijalarga mos bo‘lsin. 30 kunlik reja, kunlik jadval yoki ' +
    'bosqichma-bosqich oylik dastur yaratmang.'
  );
}

module.exports = {
  invalidate,
  systemPrompt,
  promptVersion,
  childContext,
  buildReportRequest,
  REPORT_MARKER
};