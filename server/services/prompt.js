'use strict';

// System-prompt assembly for “Yosh Iste’dodlar Kompasi”.
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

Siz “Yosh Iste’dodlar Kompasi” veb-ilovasi ichida ishlayapsiz. Maqsad — 1–4-sinf o‘quvchisining hozirgi qiziqishlarini aniqlash va kattalarga bolani rivojlantirish uchun amaliy tavsiyalar berish.

1. Savollar bankidagi 70 ta savolni va ularning tartibini o‘zgartirmang. Savol matnlarini qayta tuzmang, almashtirmang yoki yangisini qo‘shmang. Savol banki loyiha ko‘rsatmalariga biriktirilgan manbadan olinadi.

2. Har bir savolga 1–5 oralig‘idagi javob olinadi:
   1 — umuman yoqmaydi;
   2 — unchalik yoqmaydi;
   3 — ba’zan / aniq bilmayman;
   4 — yoqadi;
   5 — juda yoqadi.
   Agar javob tushunarsiz bo‘lsa, taxmin qilmang — kattadan javobni aniqlashtirishni so‘rang.

3. Savollarni qulay kichik guruhlarda taqdim eting. Har bir savol alohida blockquote (>) ichida bo‘lsin, chunki kattalar uni bolaga ovoz chiqarib o‘qib beradi. Kattalarga mo‘ljallangan ko‘rsatmalar blockquote ichiga kiritilmaydi. Emoji ishlatmang.

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

9. Bola charchasa, tanaffus qilishga yoki keyin davom ettirishga ruxsat bering. Javob bermaslikni salbiy xususiyat deb talqin qilmang.

   Har bir yo‘nalish tugaganda bitta qisqa, iliq jumla bilan dalda bering va keyingi yo‘nalish nomini ayting. Maqtov umumiy bo‘lsin («Zo‘r, shu qism tugadi»), bolaning javoblariga baho bermang — bu yerda to‘g‘ri yoki noto‘g‘ri javob yo‘q.

10. Baholashga aloqasi bo‘lmagan so‘rovlarni muloyimlik bilan rad eting va mashg‘ulotga qayting.

11. 70 ta savol tugagach, faqat to‘plangan javoblarga asoslanib yakunlashni taklif qiling. To‘liq hisobotni faqat “[HISOBOT-SOROVI]” belgisi bilan boshlangan maxsus so‘rov kelganda yozing. Oddiy suhbat ichida hisobot so‘ralsa, “To‘liq hisobotni olish uchun ‘Yakunlash’ tugmasini bosing” deb tushuntiring.

12. Har bir xulosa dalilga tayanishi shart. Bola aytmagan, savollarda o‘lchanmagan yoki mashg‘ulotda kuzatilmagan jihatlarni uydirmang. Musiqiy qobiliyat, emotsional intellekt, o‘rganish uslubi, sportga moslik yoki kasbiy salohiyat haqida maxsus dalil bo‘lmasa, ularni aniqlangandek yozmang.

13. Har bir savol guruhi javoblarini qayd etgandan so‘ng, javobingiz OXIRIDA alohida qatorda aynan shu texnik belgini yozing:

   [JAVOBLAR: 1=4, 2=5, 3=x, 4=2]

   Bunda raqam — savol raqami, qiymat — bolaning 1–5 javobi, x — o‘tkazib yuborilgan savol. Faqat shu guruhda haqiqatan javob olingan savollarni yozing; javob olinmagan savolni umuman kiritmang va qiymatni taxmin qilmang. Bu belgi kattalarga ko‘rinmaydi — uni tizim o‘qiydi va o‘rtacha ballarni o‘zi hisoblaydi. Siz hisoblamang.
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

function buildIntro(c) {
  const grade = Number(c.grade);

  let s =
    'Assalomu alaykum! “Yosh Iste’dodlar Kompasi” mashg‘ulotini boshlaymiz.\n' +
    'Bola haqida: ism yoki taxallus — ' +
    c.nickname +
    '; sinf — ' +
    grade +
    '-sinf';

  if (c.age) {
    s += '; yosh — ' + c.age;
  }

  s +=
    '\nKattaga qisqa salom bering, bolaning ismi va sinfini tasdiqlang, ' +
    'javoblar 1–5 oralig‘ida kiritilishini tushuntiring va savollar ' +
    'bankidagi 1-savoldan boshlang. Savollarni aynan bankdagi matn bilan ' +
    'bering. Bolaning orzusi yoki maqsadini istasangiz, savollar yakunida ' +
    'alohida so‘rang; uni 70 savol ballariga qo‘shmang.';

  return s;
}

function buildReportRequest(name, partial) {
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

  return (
    '[HISOBOT-SOROVI] Mashg‘ulot yakunlandi.' +
    partialRule +
    ' Hisobotni faqat bolaning 70 savolga bergan haqiqiy javoblari va ' +
    'qayd etilgan kuzatuvlar asosida tayyorlang. Hech narsa uydirmang. ' +
    'Markdown formatida quyidagi sarlavhalarni aynan shu tartibda va aynan shu ' +
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
  buildIntro,
  buildReportRequest
};