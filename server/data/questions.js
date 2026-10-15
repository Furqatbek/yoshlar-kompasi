'use strict';

// The 70-question interest inventory — the approved bank.
//
// These texts are fixed by the product owner and must reach the child exactly
// as written: the prompt forbids the model from rewording, shortening or
// substituting them. unit/questions.test.js pins all 70 against this file, so
// an accidental edit fails the build rather than quietly changing the
// instrument every result is computed from.
//
// Section keys are the contract shared with the report JSON, the database and
// the admin panel; do not rename one without a migration.

const SECTIONS = [
  {
    key: 'construction_engineering', n: 1, title: 'Konstruktorlik va muhandislik',
    items: [
      [1, 'LEGO yoki konstruktor yig‘ishni yaxshi ko‘raman.'],
      [2, 'Biror narsa buzilib qolsa, uni qanday tuzatishni o‘ylab ko‘raman.'],
      [3, 'O‘yinchoqning ichida nima borligini bilishga qiziqaman.'],
      [4, 'Biror narsani qo‘lim bilan yasashni yaxshi ko‘raman.'],
      [5, 'Qog‘oz, karton yoki boshqa narsalardan model yasashni yoqtiraman.'],
      [6, 'Narsalar qanday ishlashini bilishni istayman.'],
    ],
  },
  {
    key: 'logic_math', n: 2, title: 'Mantiq va matematika',
    items: [
      [7, 'Jumboqlar yechishni yaxshi ko‘raman.'],
      [8, 'Matematik masalalarni yechish menga qiziq.'],
      [9, 'O‘xshashlik va farqlarni tez topaman.'],
      [10, 'Biror muammo chiqsa, yechim topishga harakat qilaman.'],
      [11, 'Shaxmat yoki mantiqiy o‘yinlarni yoqtiraman.'],
      [12, 'Sonlar bilan ishlash menga yoqadi.'],
    ],
  },
  {
    key: 'science_research', n: 3, title: 'Fan va tadqiqotchilik',
    items: [
      [13, 'Tajribalar o‘tkazishni yaxshi ko‘raman.'],
      [14, 'Nima uchun degan savolni ko‘p beraman.'],
      [15, 'Hayvonlar va tabiat haqida bilishni yoqtiraman.'],
      [16, 'Kosmos haqida bilishga qiziqaman.'],
      [17, 'Ilmiy videolarni tomosha qilishni yaxshi ko‘raman.'],
      [18, 'Biror narsani tekshirib ko‘rishni yaxshi ko‘raman.'],
    ],
  },
  {
    key: 'creativity', n: 4, title: 'Ijodkorlik',
    items: [
      [19, 'Rasm chizishni yaxshi ko‘raman.'],
      [20, 'Yangi o‘yinlar o‘ylab topaman.'],
      [21, 'Hikoya yoki ertak to‘qishni yoqtiraman.'],
      [22, 'Ranglar bilan ishlashni yaxshi ko‘raman.'],
      [23, 'Bir narsani boshqalardan boshqacharoq qilishni yoqtiraman.'],
      [24, 'Tasavvur qilishni yaxshi ko‘raman.'],
    ],
  },
  {
    key: 'speech_language', n: 5, title: 'Nutq va til',
    items: [
      [25, 'O‘qigan hikoyamni boshqalarga aytib berishni yoqtiraman.'],
      [26, 'Sinf oldida gapirishdan qo‘rqmayman.'],
      [27, 'Yangi so‘zlarni o‘rganishni yaxshi ko‘raman.'],
      [28, 'Kitob o‘qishni yoqtiraman.'],
      [29, 'Hikoyalar tinglashni yaxshi ko‘raman.'],
      [30, 'O‘z fikrimni tushuntirib bera olaman.'],
    ],
  },
  {
    key: 'leadership', n: 6, title: 'Liderlik',
    items: [
      [31, 'Do‘stlarim meni sardor qilib tanlashadi.'],
      [32, 'Guruhda ish bo‘lsa boshqarishni yoqtiraman.'],
      [33, 'Odamlarni birlashtirishni yaxshi ko‘raman.'],
      [34, 'O‘yin qoidalarini tushuntirib bera olaman.'],
      [35, 'Boshqalarga yordam berib ishni tugatishni yoqtiraman.'],
      [36, 'Mas’uliyat olishdan qo‘rqmayman.'],
    ],
  },
  {
    key: 'empathy_helping', n: 7, title: 'Empatiya va yordam berish',
    items: [
      [37, 'Kimdir xafa bo‘lsa, yordam berishni xohlayman.'],
      [38, 'Kichik bolalarga yordam berishni yaxshi ko‘raman.'],
      [39, 'Hayvonlarga g‘amxo‘rlik qilishni yoqtiraman.'],
      [40, 'Do‘stlarimning his-tuyg‘ularini tushunishga harakat qilaman.'],
      [41, 'Boshqalarga yangi narsani o‘rgatishni yoqtiraman.'],
      [42, 'Odamlarga yaxshilik qilish menga yoqadi.'],
    ],
  },
  {
    key: 'organization', n: 8, title: 'Tashkiliy qobiliyat',
    items: [
      [43, 'Xonamni tartibli saqlashni yaxshi ko‘raman.'],
      [44, 'O‘yinchoqlarimni joy-joyiga qo‘yaman.'],
      [45, 'Vazifalar ro‘yxatini tuzishni yoqtiraman.'],
      [46, 'Ishlarni vaqtida bajarishga harakat qilaman.'],
      [47, 'Buyumlarim qayerda ekanini yaxshi bilaman.'],
      [48, 'Qoidalarga amal qilish menga oson.'],
    ],
  },
  {
    key: 'sport_activity', n: 9, title: 'Sport va faollik',
    items: [
      [49, 'Ko‘chada faol o‘yinlar o‘ynashni yaxshi ko‘raman.'],
      [50, 'Sport musobaqalarida qatnashishni yoqtiraman.'],
      [51, 'Yugurish va harakat qilish menga yoqadi.'],
      [52, 'Jamoaviy sportlarni yaxshi ko‘raman.'],
      [53, 'Yangi sport turlarini sinab ko‘rishni istayman.'],
      [54, 'Har kuni harakatda bo‘lishni yoqtiraman.'],
    ],
  },
  {
    key: 'technology', n: 10, title: 'Texnologiya',
    items: [
      [55, 'Kompyuterda yangi narsalarni o‘rganishni yaxshi ko‘raman.'],
      [56, 'Robotlar haqida bilishga qiziqaman.'],
      [57, 'Scratch yoki shunga o‘xshash dasturlar bilan ishlashni xohlayman.'],
      [58, 'Texnika qanday ishlashini bilishni istayman.'],
      [59, 'Elektron qurilmalarni kuzatishni yaxshi ko‘raman.'],
      [60, 'Kelajakdagi texnologiyalar haqida o‘qishni yoqtiraman.'],
    ],
  },
  {
    key: 'growth_mindset', n: 11, title: 'Rivojlanish fikrlashi (Growth Mindset)',
    items: [
      [61, 'Biror narsani uddalay olmasam, yana urinib ko‘raman.'],
      [62, 'Qiyin vazifalar menga qiziq tuyuladi.'],
      [63, 'Xatolarimdan o‘rganaman.'],
      [64, 'Mashq qilsam yaxshilanaman deb o‘ylayman.'],
      [65, 'Yangi narsalarni sinab ko‘rishdan qo‘rqmayman.'],
    ],
  },
  {
    key: 'curiosity', n: 12, title: 'Qiziquvchanlik',
    items: [
      [66, 'Har kuni yangi narsa bilishni xohlayman.'],
      [67, 'Savollar berishni yaxshi ko‘raman.'],
      [68, 'Biror mavzu qiziq bo‘lsa, ko‘proq ma’lumot izlayman.'],
      [69, 'Muzey yoki yangi joylarga borishni yoqtiraman.'],
      [70, 'Atrofimdagi narsalarni kuzataman.'],
    ],
  },
];

// The 1-5 scale, with the words a parent reads out.
//
// It asks "is this you?", not "do you like it?". Every one of the seventy items
// is a first-person self-description, and 21 of them are about what a child
// DOES or CAN DO rather than what they enjoy — "Buyumlarim qayerda ekanini
// yaxshi bilaman", "O'z fikrimni tushuntirib bera olaman", the whole organising
// block and all of growth mindset. A liking scale turns those into nonsense:
// "do you like knowing where your things are?" has no answer. Agreement reads
// correctly for all seventy.
//
// Worded as frequency rather than abstract agreement because a six-year-old can
// answer "often" and cannot reliably answer "somewhat agree".
const SCALE = [
  { value: 1, label: 'Yo‘q, bu men emas' },
  { value: 2, label: 'Kamdan-kam' },
  { value: 3, label: 'Ba’zan' },
  { value: 4, label: 'Ko‘pincha' },
  { value: 5, label: 'Ha, bu aynan men' },
];

// Interpretation bands. These group INTEREST answers; they are not validated
// psychometric norms and every surface that shows one has to say so.
const BANDS = [
  { max: 2.49, key: 'low',      label: 'hozircha kamroq qiziqish bildirildi' },
  { max: 3.49, key: 'mixed',    label: 'qiziqish aralash yoki vaziyatga bog\'liq' },
  { max: 4.19, key: 'notable',  label: 'qiziqish sezilarli' },
  { max: 5.01, key: 'strong',   label: 'kuchli qiziqish bildirildi' },
];

const ALL = SECTIONS.flatMap((s) => s.items.map(([n, text]) => ({ n, text, section: s.key })));

module.exports = { SECTIONS, SCALE, BANDS, ALL, COUNT: ALL.length };
