'use strict';

// The report's sections, as shipped.
//
// Each is a heading the model must use verbatim and a brief saying what belongs
// under it. This is the seed for the report_sections table, which the admin
// panel edits; keeping the default in code means a deploy always has a sane
// report to fall back on and the shipped wording is reviewable in a diff.
//
// `free` has to match services/paywall.js. Both are asserted against each other
// in unit/paywall.test.js so they cannot drift apart unnoticed.

const SECTIONS = [
  {
    key: 'summary', position: 1, free: true,
    heading: 'Qisqacha xulosa',
    instruction: 'Bolaning hozirgi qiziqishlari haqida 2–4 jumla. Buni qobiliyat yoki '
      + 'kelajakdagi muvaffaqiyat bashorati sifatida ko‘rsatmang.',
  },
  {
    key: 'areas', position: 2, free: false,
    heading: '12 yo‘nalish bo‘yicha natijalar',
    instruction: 'Har bir yo‘nalish uchun javoblangan savollar soni, o‘rtacha ball '
      + '(1–5) va ehtiyotkor talqin. Yo‘nalish baholanmagan bo‘lsa, '
      + '«yetarli ma’lumot yo‘q» deb yozing.',
  },
  {
    key: 'map', position: 3, free: false,
    heading: 'Hozirgi qiziqishlar xaritasi',
    instruction: 'Ballar bilan asoslangan eng yuqori 2–3 qiziqish va ularni rivojlantirish '
      + 'uchun oddiy sinov faoliyatlari. Teng yoki yaqin ballarni ochiq ko‘rsating.',
  },
  {
    key: 'developing', position: 4, free: false,
    heading: 'Rivojlantirish mumkin bo‘lgan yo‘nalishlar',
    instruction: 'Faqat ballar yoki kattalar qayd etgan kuzatuvlar asosida, tanqidsiz va '
      + 'yorliqsiz yozing. Past ballni qobiliyatsizlik deb talqin qilmang; bu faoliyat '
      + 'hozircha bolaga qiziq emasligini anglatishi mumkin.',
  },
  {
    key: 'clubs', position: 5, free: false,
    heading: 'To‘garak va mashg‘ulot tavsiyalari',
    instruction: 'Faqat javoblar bilan asoslangan 1–3 ta variantni yozing. Ularni kasb '
      + 'bashorati emas, qiziqishni sinab ko‘rish imkoniyati sifatida ko‘rsating.',
  },
  {
    key: 'encouragement', position: 6, free: true,
    heading: 'Bolaga o‘qib beriladigan dalda',
    instruction: 'Bola tushunadigan sodda, mehribon 2–3 jumla. Bolani boshqa bolalar bilan '
      + 'solishtirmang.',
  },
  {
    key: 'adults', position: 7, free: false,
    heading: 'Kattalar uchun muhim eslatmalar',
    instruction: 'Natijalar standartlashtirilgan psixologik test yoki tashxis emasligini; '
      + 'qiziqishlar vaqt o‘tishi bilan o‘zgarishini; bolaning tanlovi va '
      + 'hordig‘ini hurmat qilish zarurligini eslating.',
  },
];

module.exports = { SECTIONS };
