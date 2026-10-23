'use strict';

// System-prompt assembly for CareerKids.
//
// One source now: uploads/careerkids-system-prompt-uz.md, the consolidated
// instructions (25 sections). It replaced three things that used to be joined
// here — the project instructions file, the PROTOCOL block below it and the
// REPORT_JSON_RULE block after that — which between them said the same rules in
// three voices and had drifted: the protocol's twelve area names were not the
// ones the question bank ships, and its JSON schema was a generation behind the
// report.
//
// The document deliberately does NOT contain two things, and this is where they
// are put back:
//
//   §4  the 70 questions — the bank is admin-editable, so the live one is
//       injected at the <!-- SAVOLLAR-BANKI --> marker. A copy in the document
//       would still be describing the old instrument the first time somebody
//       added a question.
//   §20 the thirteen report headings — they come from report_sections, also
//       admin-editable, and are appended per report by buildReportRequest().
//       A heading that disagrees with the parser does not error; the section
//       just vanishes from the report.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../config');

function readSource(name) {
  const p = path.join(config.promptSourceDir, name);
  return fs.readFileSync(p, 'utf8').trim();
}

// Where the live question bank is spliced into §4 of the document.
const BANK_MARKER = '<!-- SAVOLLAR-BANKI -->';

let _prompt = null;
let _version = null;

// Drop the assembled prompt so the next call rebuilds it. Called when the
// question bank changes: an edited bank is a different instrument and must not
// go on serving the cached text, nor keep the old version hash.
function invalidate() { _prompt = null; _version = null; }

function assemble() {
  if (_prompt) return _prompt;

  const document = readSource('careerkids-system-prompt-uz.md');
  // The live bank when the database has been read (the admin panel can edit
  // it), otherwise the seeded file — so a cold start never serves an empty one.
  const bank = require('./questionBank').cachedMarkdown()
    || readSource('savollar-banki-1-4-sinflar-uz.md');

  // §4 is a marker, not a list. Asserted rather than assumed: if the marker is
  // ever lost in an edit, the model is handed instructions that tell it the
  // question bank is immutable and then never show it the questions, and the
  // reports would be built on seventy answers to statements it has not read.
  if (!document.includes(BANK_MARKER)) {
    throw new Error('careerkids-system-prompt-uz.md has lost its '
      + BANK_MARKER + ' marker — the question bank would not reach the model');
  }
  _prompt = document.replace(BANK_MARKER, bank);

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
// The two optional modules, rendered for the report request.
//
// A module that was not filled has to be stated, not omitted. §23 is explicit:
// "O‘rganish afzalliklari moduli to‘ldirilmagan bo‘lsa, bolaga o‘rganish
// uslubini belgilamang" — and a model that is simply shown nothing tends to
// write the section anyway, from the interest scores, which is exactly the
// inference §8 forbids. Saying "this was not filled in" is what makes the
// silence deliberate rather than an absence the model feels obliged to fill.
//
// `questions` is repo.getModuleQuestions(), `state` is repo.getModuleState().
function modulesBlock(questions, state) {
  const { MODULES } = require('../data/modules');
  if (!questions || !questions.length) return '';

  const byModule = new Map();
  for (const q of questions) {
    if (!byModule.has(q.module)) byModule.set(q.module, []);
    byModule.get(q.module).push(q);
  }

  const answers = (state && state.answers) || {};
  const completion = (state && state.completion) || {};
  const out = [];

  for (const m of MODULES) {
    const qs = byModule.get(m.key);
    if (!qs || !qs.length) continue;
    const given = new Map(((answers[m.key]) || []).map((a) => [a.n, a]));
    const done = completion[m.key] === true && given.size > 0;

    if (!done) {
      out.push('### ' + m.title + ' — to‘ldirilmadi\n'
        + 'Bu modul to‘ldirilmagan. Shu sababli bu mavzuda bolaga hech qanday '
        + 'ta’rif, uslub yoki tavsiya bermang — hatto qiziqish ballariga '
        + 'tayanib ham. JSON’da `module_completed: false` bo‘lsin.');
      continue;
    }

    const lines = qs.map((q) => {
      const a = given.get(q.n);
      if (!a) return '- ' + q.text + ' — javob berilmadi';
      if (a.value != null) {
        const label = (m.scale.find((s) => s.value === a.value) || {}).label || String(a.value);
        return '- ' + q.text + ' — ' + label + ' (' + a.value + '/5)';
      }
      return '- ' + q.text + ' — ' + a.choice;
    });
    out.push('### ' + m.title + ' — to‘ldirildi\n' + lines.join('\n'));
  }

  if (!out.length) return '';
  return '\nQo‘shimcha modullar (qiziqish ballariga qo‘shilmaydi):\n\n'
    + out.join('\n\n') + '\n';
}

// The approved catalogues (§17 books, §16 tutors), rendered for the request.
//
// Only ever called with repo.approvedBooks() / repo.approvedTutors(), which
// return approved AND active rows and nothing else. An empty catalogue produces
// an explicit "there is no list" rather than silence, for the same reason an
// unfilled module does: a model shown nothing writes the section anyway, and
// what it writes is a plausible Uzbek title for a book that does not exist.
// §17 and §23 both require it said out loud.
function cataloguesBlock(books, tutors) {
  const out = [];

  if (books && books.length) {
    out.push('### Tasdiqlangan kitoblar ro‘yxati (' + books.length + ' ta)\n'
      + 'Kitobxonlik tavsiyasini FAQAT shu ro‘yxatdan bering. Ro‘yxatda yo‘q '
      + 'kitobni tavsiya qilmang va nom, muallif yoki syujet uydirmang.\n'
      + books.map((b) => {
        const bits = [b.title];
        if (b.author) bits.push(b.author);
        const age = b.age_min && b.age_max ? b.age_min + '–' + b.age_max + ' yosh'
          : (b.age_min ? b.age_min + '+ yosh' : (b.age_max ? b.age_max + ' yoshgacha' : null));
        if (age) bits.push(age);
        if (b.genre) bits.push(b.genre);
        if (b.language) bits.push(b.language);
        return '- ' + bits.join(' — ');
      }).join('\n'));
  } else {
    out.push('### Tasdiqlangan kitoblar ro‘yxati — kiritilmagan\n'
      + 'Platformaga hali biror kitob ro‘yxati kiritilmagan. Shu sababli hech '
      + 'qanday kitob nomi yoki muallifini yozmang. Kitobxonlik bo‘limida faqat '
      + 'umumiy yo‘nalish (masalan, qanday mavzudagi kitoblar va kuniga qancha '
      + 'o‘qish) haqida yozing va ro‘yxat kiritilishi kerakligini ayting.');
  }

  if (tutors && tutors.length) {
    out.push('### Tasdiqlangan ustozlar katalogi (' + tutors.length + ' ta)\n'
      + 'Qo‘shimcha yordam bo‘limida faqat shu yo‘nalishlarni ko‘rsating.\n'
      + tutors.map((t) => {
        const bits = [t.subject];
        if (t.name) bits.push(t.name);
        if (t.age_range) bits.push(t.age_range);
        if (t.method) bits.push(t.method);
        return '- ' + bits.join(' — ');
      }).join('\n'));
  } else {
    out.push('### Tasdiqlangan ustozlar katalogi — kiritilmagan\n'
      + 'Haqiqiy o‘qituvchilar katalogi kiritilmagan. Ism, narx, malaka, sharh '
      + 'yoki bo‘sh vaqt yozmang. Faqat qaysi TURDAGI mutaxassis foydali '
      + 'bo‘lishi mumkinligini va uyda mustaqil boshlash qadamini tushuntiring.');
  }

  return '\nKataloglar:\n\n' + out.join('\n\n') + '\n';
}

function buildReportRequest(name, partial, scored, modules, catalogues) {
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
    modulesBlock(modules && modules.questions, modules && modules.state) +
    cataloguesBlock(catalogues && catalogues.books, catalogues && catalogues.tutors) +
    '\nMarkdown formatida quyidagi sarlavhalarni aynan shu tartibda va aynan shu ' +
    'matn bilan ishlating:\n\n' +
    body +
    '\nHisobot matnidan keyin ko‘rsatmalarning 24-bo‘limida berilgan ' +
    'sxemaga mos bitta JSON blokini yozing. JSON qiymatlari hisobotdagi ' +
    'haqiqiy natijalarga mos bo‘lsin.'
  );
}

module.exports = {
  invalidate,
  systemPrompt,
  modulesBlock,
  cataloguesBlock,
  promptVersion,
  childContext,
  buildReportRequest,
  REPORT_MARKER
};