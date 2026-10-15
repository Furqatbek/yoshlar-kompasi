// The 70 questions, pinned.
//
// The instrument is the product. Every average, every band and every
// recommendation is computed from these exact 70 items, so a reworded question
// silently changes what the number means — and nothing else in the system would
// notice. The product owner's first rule for this bank was that the texts must
// not change, so this test holds them.
//
// The expected list below is transcribed from the approved bank. If a question
// legitimately changes, change it HERE too, in the same commit, deliberately.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { SECTIONS, ALL, SCALE, BANDS, COUNT } = require('../../server/data/questions');

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log('  ok  - ' + name); };

const EXPECTED = {
  construction_engineering: [
    'LEGO yoki konstruktor yig‘ishni yaxshi ko‘raman.',
    'Biror narsa buzilib qolsa, uni qanday tuzatishni o‘ylab ko‘raman.',
    'O‘yinchoqning ichida nima borligini bilishga qiziqaman.',
    'Biror narsani qo‘lim bilan yasashni yaxshi ko‘raman.',
    'Qog‘oz, karton yoki boshqa narsalardan model yasashni yoqtiraman.',
    'Narsalar qanday ishlashini bilishni istayman.',
  ],
  logic_math: [
    'Jumboqlar yechishni yaxshi ko‘raman.',
    'Matematik masalalarni yechish menga qiziq.',
    'O‘xshashlik va farqlarni tez topaman.',
    'Biror muammo chiqsa, yechim topishga harakat qilaman.',
    'Shaxmat yoki mantiqiy o‘yinlarni yoqtiraman.',
    'Sonlar bilan ishlash menga yoqadi.',
  ],
  science_research: [
    'Tajribalar o‘tkazishni yaxshi ko‘raman.',
    'Nima uchun degan savolni ko‘p beraman.',
    'Hayvonlar va tabiat haqida bilishni yoqtiraman.',
    'Kosmos haqida bilishga qiziqaman.',
    'Ilmiy videolarni tomosha qilishni yaxshi ko‘raman.',
    'Biror narsani tekshirib ko‘rishni yaxshi ko‘raman.',
  ],
  creativity: [
    'Rasm chizishni yaxshi ko‘raman.',
    'Yangi o‘yinlar o‘ylab topaman.',
    'Hikoya yoki ertak to‘qishni yoqtiraman.',
    'Ranglar bilan ishlashni yaxshi ko‘raman.',
    'Bir narsani boshqalardan boshqacharoq qilishni yoqtiraman.',
    'Tasavvur qilishni yaxshi ko‘raman.',
  ],
  speech_language: [
    'O‘qigan hikoyamni boshqalarga aytib berishni yoqtiraman.',
    'Sinf oldida gapirishdan qo‘rqmayman.',
    'Yangi so‘zlarni o‘rganishni yaxshi ko‘raman.',
    'Kitob o‘qishni yoqtiraman.',
    'Hikoyalar tinglashni yaxshi ko‘raman.',
    'O‘z fikrimni tushuntirib bera olaman.',
  ],
  leadership: [
    'Do‘stlarim meni sardor qilib tanlashadi.',
    'Guruhda ish bo‘lsa boshqarishni yoqtiraman.',
    'Odamlarni birlashtirishni yaxshi ko‘raman.',
    'O‘yin qoidalarini tushuntirib bera olaman.',
    'Boshqalarga yordam berib ishni tugatishni yoqtiraman.',
    'Mas’uliyat olishdan qo‘rqmayman.',
  ],
  empathy_helping: [
    'Kimdir xafa bo‘lsa, yordam berishni xohlayman.',
    'Kichik bolalarga yordam berishni yaxshi ko‘raman.',
    'Hayvonlarga g‘amxo‘rlik qilishni yoqtiraman.',
    'Do‘stlarimning his-tuyg‘ularini tushunishga harakat qilaman.',
    'Boshqalarga yangi narsani o‘rgatishni yoqtiraman.',
    'Odamlarga yaxshilik qilish menga yoqadi.',
  ],
  organization: [
    'Xonamni tartibli saqlashni yaxshi ko‘raman.',
    'O‘yinchoqlarimni joy-joyiga qo‘yaman.',
    'Vazifalar ro‘yxatini tuzishni yoqtiraman.',
    'Ishlarni vaqtida bajarishga harakat qilaman.',
    'Buyumlarim qayerda ekanini yaxshi bilaman.',
    'Qoidalarga amal qilish menga oson.',
  ],
  sport_activity: [
    'Ko‘chada faol o‘yinlar o‘ynashni yaxshi ko‘raman.',
    'Sport musobaqalarida qatnashishni yoqtiraman.',
    'Yugurish va harakat qilish menga yoqadi.',
    'Jamoaviy sportlarni yaxshi ko‘raman.',
    'Yangi sport turlarini sinab ko‘rishni istayman.',
    'Har kuni harakatda bo‘lishni yoqtiraman.',
  ],
  technology: [
    'Kompyuterda yangi narsalarni o‘rganishni yaxshi ko‘raman.',
    'Robotlar haqida bilishga qiziqaman.',
    'Scratch yoki shunga o‘xshash dasturlar bilan ishlashni xohlayman.',
    'Texnika qanday ishlashini bilishni istayman.',
    'Elektron qurilmalarni kuzatishni yaxshi ko‘raman.',
    'Kelajakdagi texnologiyalar haqida o‘qishni yoqtiraman.',
  ],
  growth_mindset: [
    'Biror narsani uddalay olmasam, yana urinib ko‘raman.',
    'Qiyin vazifalar menga qiziq tuyuladi.',
    'Xatolarimdan o‘rganaman.',
    'Mashq qilsam yaxshilanaman deb o‘ylayman.',
    'Yangi narsalarni sinab ko‘rishdan qo‘rqmayman.',
  ],
  curiosity: [
    'Har kuni yangi narsa bilishni xohlayman.',
    'Savollar berishni yaxshi ko‘raman.',
    'Biror mavzu qiziq bo‘lsa, ko‘proq ma’lumot izlayman.',
    'Muzey yoki yangi joylarga borishni yoqtiraman.',
    'Atrofimdagi narsalarni kuzataman.',
  ],
};

test('there are exactly 70 questions in 12 sections', () => {
  assert.strictEqual(COUNT, 70, 'got ' + COUNT);
  assert.strictEqual(SECTIONS.length, 12);
});

test('every question text is the approved one, word for word', () => {
  for (const s of SECTIONS) {
    const want = EXPECTED[s.key];
    assert.ok(want, 'no expectation for section ' + s.key);
    const got = s.items.map(([, text]) => text);
    assert.deepStrictEqual(got, want, 'section ' + s.key + ' drifted');
  }
});

test('the sections are the ones the report JSON names', () => {
  assert.deepStrictEqual(SECTIONS.map((s) => s.key), Object.keys(EXPECTED));
});

test('question numbers run 1..70 with no gap, repeat or reorder', () => {
  assert.deepStrictEqual(ALL.map((q) => q.n), Array.from({ length: 70 }, (_, i) => i + 1));
});

test('section boundaries match the documented ranges', () => {
  const ranges = {};
  for (const s of SECTIONS) ranges[s.key] = [s.items[0][0], s.items[s.items.length - 1][0]];
  assert.deepStrictEqual(ranges, {
    construction_engineering: [1, 6], logic_math: [7, 12], science_research: [13, 18],
    creativity: [19, 24], speech_language: [25, 30], leadership: [31, 36],
    empathy_helping: [37, 42], organization: [43, 48], sport_activity: [49, 54],
    technology: [55, 60], growth_mindset: [61, 65], curiosity: [66, 70],
  });
});

test('the scale is 1..5 and every point has words a parent can read out', () => {
  assert.deepStrictEqual(SCALE.map((s) => s.value), [1, 2, 3, 4, 5]);
  for (const s of SCALE) assert.ok(s.label && s.label.length > 3, JSON.stringify(s));
});

test('the bands cover 1.00 to 5.00 with no gap or overlap', () => {
  assert.strictEqual(BANDS.length, 4);
  assert.deepStrictEqual(BANDS.map((b) => b.max), [2.49, 3.49, 4.19, 5.01]);
  assert.ok(BANDS[BANDS.length - 1].max > 5, 'the top band must include a perfect 5.00');
});

// The prompt reads the generated markdown, the app reads the module. If they
// drift, the child answers one instrument and the report scores another.
test('the generated bank markdown matches the module', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', '..', 'uploads',
    'savollar-banki-1-4-sinflar-uz.md'), 'utf8');
  for (const q of ALL) {
    assert.ok(md.includes(q.n + '. ' + q.text), 'missing from the bank markdown: ' + q.n + '. ' + q.text);
  }
  const numbered = (md.match(/^\d+\. /gm) || []).length;
  assert.strictEqual(numbered, 70, 'the markdown lists ' + numbered + ' questions, not 70');
});

console.log('\n' + pass + ' passed, 0 failed');
