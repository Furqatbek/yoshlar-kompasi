'use strict';

// The report's sections, as shipped.
//
// Each is a heading the model must use verbatim and a brief saying what belongs
// under it. This is the seed for the report_sections table, which the admin
// panel edits; keeping the default in code means a deploy always has a sane
// report to fall back on and the shipped wording is reviewable in a diff.
//
// This file IS the report structure. The consolidated instructions
// (uploads/careerkids-system-prompt-uz.md) deliberately do not restate it —
// they point at the brief that services/prompt.js builds from these rows. Two
// copies of thirteen headings, one of them admin-editable, would diverge the
// first time somebody reworded one, and a heading that disagrees with the
// parser does not error: the section silently vanishes from the report.
//
// `free` has to match services/paywall.js. Both are asserted against each other
// in unit/paywall.test.js so they cannot drift apart unnoticed.
//
// Thirteen sections, from §20 of the instructions. Seven of them existed before
// and kept their keys; `clubs` became `sports_clubs` (it now carries sport as
// well, per §14), and six are new.

const SECTIONS = [
  {
    key: 'child', position: 1, free: true,
    heading: 'Bola haqida qisqacha ma’lumot',
    instruction: 'Ism yoki taxallus, sinf, yosh (agar berilgan bo‘lsa), javob berilgan '
      + 'savollar soni va so‘rovnoma to‘liqligi. Faqat berilgan ma’lumotni yozing; '
      + 'keraksiz shaxsiy ma’lumot qo‘shmang.',
  },
  {
    key: 'summary', position: 2, free: true,
    heading: 'Qisqacha xulosa',
    instruction: 'Bolaning hozirgi qiziqishlari haqida 2–4 jumla. Yuqori natija olgan '
      + 'yo‘nalishlarni ehtiyotkorlik bilan ko‘rsating, qiziqish va qobiliyat '
      + 'o‘rtasidagi farqni saqlang, kelajakdagi kasbni bashorat qilmang.',
  },
  {
    key: 'areas', position: 3, free: false,
    heading: '12 yo‘nalish bo‘yicha natijalar',
    instruction: 'Har bir yo‘nalish uchun: nomi, javoblangan savollar soni, o‘rtacha ball '
      + '(1–5), qiziqish darajasi va qisqa, ehtiyotkor izoh. Yo‘nalishda javob bo‘lmasa, '
      + '«Ma’lumot yetarli emas» deb yozing.',
  },
  {
    key: 'map', position: 4, free: false,
    heading: 'Hozirgi qiziqishlar xaritasi',
    instruction: 'Eng yuqori natijalarni va ular asosida sinab ko‘rish mumkin bo‘lgan '
      + 'faoliyatlarni ko‘rsating. Ballar teng bo‘lsa, ularni teng deb ko‘rsating — '
      + 'sun’iy ravishda bittasini ustun qo‘ymang.',
  },
  {
    key: 'developing', position: 5, free: false,
    heading: 'Boshqa rivojlanish imkoniyatlari',
    instruction: 'Bola hali sinab ko‘rmagan, lekin tanishib ko‘rishi mumkin bo‘lgan '
      + 'yo‘nalishlarni taklif qiling. Ularni past ball yoki kamchilik sifatida '
      + 'taqdim etmang.',
  },
  {
    key: 'subjects', position: 6, free: false,
    heading: 'Fanlar bo‘yicha tavsiyalar',
    instruction: 'Matematika, ingliz tili, o‘qish savodxonligi, notiqlik va IT bo‘yicha '
      + 'yoshga mos, bajarilishi mumkin bo‘lgan tavsiyalar. Bolaning qiziqishlariga '
      + 'moslashtiring, ammo faqat yuqori ball olgan yo‘nalishlar bilan cheklanmang. '
      + 'Bolaning o‘qish yoki fan darajasi tekshirilmagan — u qiynalayotgani yoki '
      + 'orqada qolgani haqida xulosa chiqarmang.',
  },
  {
    key: 'sports_clubs', position: 7, free: false,
    heading: 'Sport va to‘garaklar',
    instruction: 'Bolaning qiziqishlari bilan bog‘liq 1–3 ta faoliyatni tavsiya qiling. '
      + 'Bolaning o‘z tanlovi, yoshi, sog‘lig‘i, xavfsizligi va mahalliy imkoniyatlarni '
      + 'hisobga olishni eslating. Yuqori ball sportdagi mahoratni isbotlamaydi.',
  },
  {
    key: 'reading', position: 8, free: false,
    heading: 'Kitobxonlik tavsiyasi',
    instruction: 'Bolaning yoshi va qiziqishlariga mos kitobxonlik yo‘nalishini taklif '
      + 'qiling. Agar tasdiqlangan kitoblar ro‘yxati berilgan bo‘lsa, faqat shu '
      + 'ro‘yxatdan foydalaning. Ro‘yxat berilmagan bo‘lsa, kitob nomlarini va '
      + 'mualliflarini uydirmang — ro‘yxat kiritilishi kerakligini ayting.',
  },
  {
    key: 'parent_steps', position: 9, free: false,
    heading: 'Ota-ona uchun 3 ta amaliy qadam',
    instruction: 'Keyingi kunlar yoki haftalarda bajarish mumkin bo‘lgan uchta sodda '
      + 'qadam. Har biri katta xarajat, ko‘p vaqt yoki maxsus jihoz talab qilmasin. '
      + 'Ota-onaga bolani majburlash yoki bir vaqtda ko‘p to‘garakka yozdirishni '
      + 'tavsiya qilmang.',
  },
  {
    key: 'teacher', position: 10, free: false,
    heading: 'O‘qituvchi uchun tavsiya',
    instruction: 'Odatiy dars davomida 2–5 daqiqada bajarish mumkin bo‘lgan bitta qisqa '
      + 'faoliyatni ko‘rsating: qaysi darsda, qancha vaqt, nimani kuzatish. '
      + 'O‘qituvchiga bolalarni ballar bo‘yicha reyting qilishni tavsiya qilmang.',
  },
  {
    key: 'support', position: 11, free: false,
    heading: 'Qo‘shimcha yordam',
    instruction: 'Zarurat yoki ota-onaning xohishi bo‘lsa, qaysi turdagi o‘qituvchi yoki '
      + 'ustoz yordam berishi mumkinligini tushuntiring. Faqat qiziqish ballari asosida '
      + 'repetitor kerak degan xulosa chiqarmang. Haqiqiy o‘qituvchilar katalogi '
      + 'berilmagan bo‘lsa, ism, narx, malaka yoki sharhlarni uydirmang.',
  },
  {
    key: 'encouragement', position: 12, free: true,
    heading: 'Bolaga dalda',
    instruction: 'Bolaga o‘qib berish mumkin bo‘lgan sodda, mehribon 2–3 jumla. Bolani '
      + 'boshqa bolalar bilan solishtirmang.',
  },
  {
    key: 'adults', position: 13, free: false,
    heading: 'Kattalar uchun muhim eslatma',
    instruction: 'Natijalar bolaning hozirgi qiziqishlarini aks ettiradi; ular qobiliyat '
      + 'testi yoki tashxis emas. Qiziqishlar vaqt o‘tishi bilan o‘zgaradi. Bolaning '
      + 'fikri, hordig‘i, tanlovi va individual rivojlanish sur’atini hurmat qilish kerak.',
  },
];

module.exports = { SECTIONS };
