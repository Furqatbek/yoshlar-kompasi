'use strict';

// System-prompt assembly (backend-spec §4). At startup we concatenate the two
// versioned source files — the project instructions and the question bank —
// then append the interface protocol and the structured-report rule. Every
// session records the resulting prompt_version so old reports stay explainable
// after prompt edits.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../config');

function readSource(name) {
  const p = path.join(config.promptSourceDir, name);
  return fs.readFileSync(p, 'utf8').trim();
}

// The two lines the backend spec requires us to add to the instructions:
// the blockquote rule and the [YAKUN] track markers, plus the anti-abuse line.
const PROTOCOL = `## Interfeys protokoli (majburiy format qoidalari)
Siz veb-ilova ichida ishlayapsiz. Quyidagilarga qat'iy amal qiling:
1. Bolaga ovoz chiqarib o'qib beriladigan HAR BIR matnni blockquote (>) qilib yozing. Har bir savol yoki topshiriq — ALOHIDA blockquote, oralarida bo'sh qator. Kattalarga mo'ljallangan izohlar oddiy matn bo'lib qoladi.
2. Bir vaqtda 2–4 ta savol bering va yo'nalishlarni almashtirib turing. Savollar bankidagi namunalarni so'zma-so'z o'qib bermang — har safar shu tur va qiyinlikdagi yangi variant tuzing (raqam, narsa, ismlarni almashtiring) va bir savolni takrorlamang. Javoblaringiz ixcham bo'lsin: kattalar uchun 1–2 jumla izoh + savollar. Emoji ishlatmang.
3. Bir yo'nalish bo'yicha baholash uchun yetarli ma'lumot to'plangach, javobingiz OXIRIDA alohida qatorda aynan shunday texnik belgi yozing: [YAKUN: MANTIQ] yoki [YAKUN: PSIXOLOGIYA] yoki [YAKUN: HARAKAT]. Bu belgi kattalarga ko'rinmaydi; har birini faqat bir marta ishlating. Uchala belgi ham yozilgach, mashg'ulotni yakunlash mumkinligini kattalarga ayting.
4. Hisobotni faqat alohida so'ralganda, so'rovda berilgan sarlavhalar bilan yozing; undan oldin hisobot yozmang. Hisobotdagi har bir kuchli tomon, kuzatuv va daraja aynan bolaning yozib berilgan javoblaridan kelib chiqsin — hech qachon ma'lumot uydirmang. Bola javob bermagan yo'nalishni baholamang: uning darajasini null qoldiring va u haqda kuzatuv yozmang. Agar suhbatda deyarli javob bo'lmasa, to'liq baholash to'qib chiqarmang.
5. Bola baholashiga aloqasi bo'lmagan (mavzudan tashqari) so'rovlarni muloyimlik bilan rad eting va mashg'ulotga qayting.`;

// The structured-report rule the admin panel relies on for filtering.
const FENCE = '```';
const REPORT_JSON_RULE = `## Hisobot uchun tuzilmali ma'lumot (majburiy)
To'liq hisobot so'ralganda, hisobot matnidan KEYIN, eng oxirida faqat bitta ${FENCE}json bloki yozing:
${FENCE}json
{"levels": {"mantiq": "...", "psixologiya": "...", "harakat": "..."}, "sports": ["...", "..."], "riasec": ["...", "..."]}
${FENCE}
"levels" qiymatlari faqat shakllanmoqda / meyorda / kuchli bo'lsin (yo'nalish baholanmagan bo'lsa null). "sports" — tavsiya etilgan sport nomlari ro'yxati. "riasec" — aniqlangan 1–2 moyillik harfi (R/I/A/S/E/C); aniq moyillik bo'lmasa bo'sh ro'yxat. Bu blok kattalarga ko'rsatilmaydi va tizim tomonidan o'qiladi.`;

let _prompt = null;
let _version = null;

function assemble() {
  if (_prompt) return _prompt;
  const instructions = readSource('loyiha-korsatmalari-uz.md');
  const bank = readSource('savollar-banki-1-4-sinflar-uz.md');
  _prompt = [instructions, '---', bank, '---', PROTOCOL, REPORT_JSON_RULE].join('\n\n');
  const hash = crypto.createHash('sha256').update(_prompt).digest('hex').slice(0, 12);
  _version = config.promptVersionOverride || 'v1-' + hash;
  return _prompt;
}

function systemPrompt() {
  return assemble();
}

function promptVersion() {
  assemble();
  return _version;
}

// First user turn — mirrors the original kompas-prompt buildIntro.
function buildIntro(c) {
  const grade = Number(c.grade);
  const grp = grade <= 2 ? 'A' : 'B';
  let s =
    "Assalomu alaykum! Yangi mashg'ulotni boshlaymiz. Men bolaning yonidagi katta odamman (ota-ona yoki o'qituvchi).\n" +
    'Bola haqida:\n' +
    '- Ismi: ' + c.nickname + '\n' +
    '- Sinfi: ' + grade + '-sinf (' + grp + ' guruh savollari)';
  if (c.age) s += '\n- Yoshi: ' + c.age;
  if (c.goal) s += '\n- Maqsad yoki orzu: ' + c.goal;
  if (c.notes) s += '\n- Qo‘shimcha izoh: ' + c.notes;
  s += "\nMeni qisqa kutib oling, bolaning ismi va sinfini tasdiqlang va darhol birinchi savollar guruhini bering.";
  return s;
}

// Fixed report-request user turn — mirrors the original buildReportRequest.
function buildReportRequest(name, partial) {
  const p = partial
    ? ' Diqqat: barcha yo‘nalishlar to‘liq qamrab olinmadi. Hisobotni FAQAT bolaning shu suhbatda bergan haqiqiy javoblariga asoslang — baholanmagan yo‘nalish uchun darajani null qoldiring va u haqda kuzatuv, kuchli tomon yoki tavsiya UYDIRMANG. Hisobot qisman ma‘lumot asosida tuzilayotganini eng boshida bir jumla bilan ayting. Agar bola deyarli javob bermagan bo‘lsa, bo‘limlarni sun‘iy to‘ldirmang: qisqa va rostgo‘y yozing hamda to‘laqonli mashg‘ulot o‘tkazishni taklif qiling. Quyidagi bo‘limlardagi son ko‘rsatkichlari (3–5, 2–3, uch qator kabi) — yuqori chegara, majburiy emas: yetarli asos bo‘lmasa kamroq band yozing yoki "— yetarli ma‘lumot yo‘q" deb belgilang. Sonni to‘ldirish uchun hech narsani to‘qib chiqarmang.'
    : '';
  return (
    'Mashg‘ulot yakunlandi.' + p +
    ' Endi hisobotni tayyorlang. Hisobotni faqat shu suhbatdagi haqiqiy javoblar va kuzatuvlarga asoslang — hech narsa uydirmang. Faqat hisobot matnini yozing (kirish izohisiz, blockquote ishlatmang), Markdown formatida, aynan quyidagi ## sarlavhalar bilan:\n\n' +
    '## Surat\n3–5 ta kuchli tomon: har biri "- **Nomi** — qisqa izoh" ko‘rinishida (faqat javoblardan ko‘ringanicha; asos kam bo‘lsa kamroq yozing).\n\n' +
    '## Hozirgi o‘rni\nHar bir BAHOLANGAN yo‘nalish uchun bitta qator: "- **Mantiq va tafakkur** — Me‘yorda. Kuzatuvlar..." (daraja faqat: Shakllanmoqda / Me‘yorda / Kuchli). Baholanmagan yo‘nalishni "- **Nomi** — baholanmadi" deb belgilang va JSON‘da uning darajasini null qoldiring.\n\n' +
    '## Iqtidorlar xaritasi\nGardner modeli bo‘yicha FAQAT shu suhbatda kuzatilgan iqtidorlar (til-nutq, mantiqiy-matematik, fazoviy-vizual, musiqiy-ritmik, tana-harakat, shaxslararo, ichki-shaxsiy, tabiat): har biri "- **Iqtidor** — yaqqol namoyon bo‘ldi / belgilari bor / kam kuzatildi; qisqa dalil (bola nima qildi yoki dedi)". Kuzatilmagan iqtidorni umuman yozmang.\n\n' +
    '## Qiziqishlar kompasi\nRIASEC bo‘yicha eng kuchli 1–2 moyillik (Quruvchi / Tadqiqotchi / Ijodkor / Yordamchi / Tashkilotchi / Tartib ustasi), har biri bolaning aniq javobiga tayangan 1–2 jumla izoh bilan; buni "hozirgi moyillik" sifatida taqdim eting. Aniq moyillik ko‘rinmasa, buni ochiq yozing.\n\n' +
    '## O‘sish tafakkuri va o‘z-o‘zini boshqarish\n2–4 ta kuzatuv: xatoga munosabat, qat‘iyat, diqqat, sabr — har biri suhbatdagi aniq holatga bog‘langan, yorliqsiz, bittadan rivojlantirish taklifi bilan.\n\n' +
    '## Maqsad va yo‘l xaritasi\nBirinchi xatboshi — maqsad. So‘ng kelgusi 3–6 oy uchun 3–4 bosqich raqamlangan ro‘yxat: "1. ...".\n\n' +
    '## Nimani o‘rganish va mashq qilish\nHar bir soha "- **Soha** — haftalik hajmdagi aniq taklif" ko‘rinishida.\n\n' +
    '## Tavsiya etilgan sport va mashg‘ulotlar\nBolaning javoblaridan mos sabab topilsa, 1–3 ta variant: "- **Sport nomi** — bolaning o‘z javobiga bog‘langan bir qatorlik sabab". Agar javoblarda yetarli asos bo‘lmasa, sport to‘qib chiqarmang — "— yetarli ma‘lumot yo‘q" deb yozing. Har birini bir necha hafta sinab ko‘rishni va yangi sport oldidan oddiy tibbiy ko‘rikni eslating (Kattalar uchun bo‘limida).\n\n' +
    '## ' + name + ' uchun xat\nBolaga o‘qib beriladigan 2–3 ta sodda, ruhlantiruvchi jumla.\n\n' +
    '## Kattalar uchun\n"- " ro‘yxat: nimani qo‘llab-quvvatlash, kuzatish yoki maktabdan so‘rash.'
  );
}

module.exports = { systemPrompt, promptVersion, buildIntro, buildReportRequest };
