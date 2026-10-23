'use strict';

// The two optional modules, §8 and §9 of the instructions.
//
// Both exist because the seventy-question inventory does not measure what they
// ask about, and the instructions are explicit that it must not be made to:
//
//   §8  "70 savollik asosiy so‘rovnoma bolaning o‘rganish usulini ... o‘lchamaydi"
//   §9  "Uy vazifasi uchun qulay sharoitni tushunish asosiy qiziqish
//        so‘rovnomasidan alohida amalga oshiriladi"
//
// So their answers never join the seventy. That is enforced by schema, not by
// care: they are stored in module_answers, a table services/scoring.js has no
// path to, and unit/modules.test.js proves that filling both moves no interest
// score at all.
//
// Neither module is a classifier. §8 forbids "vizual o‘rganuvchi" and the like
// outright — what it collects is what the child said they prefer, reported as
// a preference and nothing more. §9's answers become suggestions for the adult
// about homework conditions, never a claim about attention or memory.
//
// Both are skippable, and skipping is a first-class outcome: §23 says an
// unfilled module must produce no conclusion at all rather than a hedged one.

// Answers on the same 1–5 shape the child already learned in the inventory,
// but worded for "do you like this?" rather than "is this you?" — the questions
// below ask about preference, and reusing the interest labels would have the
// child answering a question nobody asked.
const PREFERENCE_SCALE = [
  { value: 1, label: 'Yo‘q' },
  { value: 2, label: 'Kamdan-kam' },
  { value: 3, label: 'Ba’zan' },
  { value: 4, label: 'Ko‘pincha' },
  { value: 5, label: 'Ha' },
];

const MODULES = [
  {
    key: 'learning_preferences',
    n: 1,
    title: 'Qanday o‘rganish qulay',
    // Shown before the first question, to the adult and the child together.
    intro: 'Bu savollar bolaning nimani yoqtirishini so‘raydi — to‘g‘ri yoki noto‘g‘ri '
      + 'javob yo‘q. Ular qiziqish ballariga qo‘shilmaydi va bolaga «o‘rganish uslubi» '
      + 'degan yorliq qo‘yilmaydi.',
    kind: 'scale',
    scale: PREFERENCE_SCALE,
    items: [
      [1, 'Yangi mavzuni o‘rganayotganda, avval o‘qituvchining tushuntirishini tinglashni yoqtirasanmi?'],
      [2, 'Rasm, chizma yoki diagrammalar yordamida tushuntirishni yoqtirasanmi?'],
      [3, 'Misol ko‘rsatib berishsa, mavzuni tushunishing osonroq bo‘ladimi?'],
      [4, 'Mashqlarni o‘zing bajarib ko‘rishni yoqtirasanmi?'],
      [5, 'Savol-javob yoki suhbat orqali o‘rganishni yoqtirasanmi?'],
      [6, 'O‘yinlar va amaliy topshiriqlar orqali o‘rganishni yoqtirasanmi?'],
      [7, 'Yangi mavzuni o‘rganganingdan keyin uni boshqalarga tushuntirishni yoqtirasanmi?'],
      [8, 'Vazifani bajarishdan oldin yozma ko‘rsatmalarni ko‘rib chiqishni yoqtirasanmi?'],
    ],
  },
  {
    key: 'homework_environment',
    n: 2,
    title: 'Uy vazifasi qanday qulay',
    intro: 'Bu savollar uy vazifasi uchun qanday sharoit qulayroq ekanini so‘raydi. '
      + 'Javoblar qiziqish ballariga qo‘shilmaydi va ular asosida bolaga diqqat yoki '
      + 'xotira bilan bog‘liq tashxis qo‘yilmaydi.',
    // Categorical, not scalar: §9 gives each question its own options, and most
    // of them end in "it depends on the task", which is a real answer and not a
    // midpoint on a scale.
    kind: 'choice',
    items: [
      [1, 'Uy vazifasini qayerda bajarishni yoqtirasan?', [
        'Alohida, tinch joyda',
        'Oila a’zolari yaqinida',
        'Stol atrofida, boshqalar bilan birga',
        'Boshqa joyda',
      ]],
      [2, 'Uy vazifasini qachon bajarish senga qulayroq?', [
        'Maktabdan kelgach, biroz dam olganimdan keyin',
        'Kunning ikkinchi yarmida',
        'Kechroq',
        'Har kuni har xil vaqtda',
      ]],
      [3, 'Uy vazifasini qanday boshlashni afzal ko‘rasan?', [
        'Avval oson vazifalarni bajaraman',
        'Avval qiyin vazifalarni bajaraman',
        'Kattalar bilan birga reja tuzaman',
        'Vazifaga qarab tanlayman',
      ]],
      [4, 'Vazifani bajarayotganda qanday yordam senga qulay?', [
        'Avval o‘zim bajarib ko‘raman',
        'Tushunmasam, kattadan yordam so‘rayman',
        'Katta odam yonimda bo‘lishini yoqtiraman',
        'Vazifaga qarab turlicha yordam kerak bo‘ladi',
      ]],
      [5, 'Uzoqroq vazifalarni qanday bajarishni yoqtirasan?', [
        'Hammasini bir vaqtda bajarishga harakat qilaman',
        'Vazifani kichik qismlarga bo‘lib bajaraman',
        'Orada qisqa tanaffus qilaman',
        'Har safar har xil usuldan foydalanaman',
      ]],
      [6, 'Uy vazifasini bajarayotganda nimalar diqqatingni chalg‘itishi mumkin?', [
        'Televizor yoki telefon',
        'Atrofdagi suhbatlar va shovqin',
        'Charchoq',
        'Vazifaning qiyinligi',
        'Boshqa omillar',
      ]],
      [7, 'Vazifani tugatganingni qanday tekshirishni yoqtirasan?', [
        'O‘zim qayta tekshiraman',
        'Katta odam tekshirib berishini yoqtiraman',
        'Javoblarni namunaga solishtiraman',
        'Vazifaga qarab turlicha tekshiraman',
      ]],
      [8, 'Uy vazifasini bajarishda senga nima yordam beradi?', [
        'Oldindan tuzilgan reja',
        'Tinch muhit',
        'Kattalarning dalda berishi',
        'Qisqa tanaffuslar',
        'Aniq misollar va ko‘rsatmalar',
        'Boshqa yordam',
      ]],
    ],
  },
];

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

// Flat list, the way data/questions.js exposes ALL.
const ALL = MODULES.flatMap((m) =>
  m.items.map(([n, text, options]) => ({
    module: m.key, n, text, options: options || null, kind: m.kind,
  })));

module.exports = { MODULES, BY_KEY, ALL, PREFERENCE_SCALE, COUNT: ALL.length };
