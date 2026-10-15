'use strict';

// Regenerates uploads/savollar-banki-1-4-sinflar-uz.md from server/data/questions.js.
//
// The prompt reads the markdown; the app, the database seed and the admin panel
// read the module. Generating one from the other is what stops the instrument
// the child answers from drifting away from the instrument the report is
// computed on. Run after editing questions.js; CI pins the result.

const fs = require('fs');
const path = require('path');
const { SECTIONS, SCALE, BANDS, COUNT } = require('../data/questions');

const out = [];
out.push('# Savollar banki — 1–4-sinflar (' + COUNT + ' ta tasdiqlangan savol)');
out.push('');
out.push('Bu ro‘yxat — loyihaning tasdiqlangan savollar banki. Savol matnlarini');
out.push('o‘zgartirish, qisqartirish, almashtirish yoki yangisini qo‘shish mumkin emas.');
out.push('Savollar quyidagi tartibda, 12 ta yo‘nalish bo‘yicha beriladi.');
out.push('');
out.push('Har bir savolga 1–5 oralig‘ida javob olinadi:');
out.push('');
for (const s of SCALE) out.push('- **' + s.value + '** — ' + s.label);
out.push('');
out.push('Bola javob berishni xohlamasa yoki savolni tushunmasa, savolni o‘tkazib');
out.push('yuborish mumkin. O‘tkazib yuborilgan savol nol deb hisoblanmaydi.');
out.push('');
for (const s of SECTIONS) {
  out.push('## ' + s.n + '-bo‘lim. ' + s.title);
  out.push('');
  for (const [n, text] of s.items) out.push(n + '. ' + text);
  out.push('');
}
out.push('## Natijalarni guruhlash');
out.push('');
out.push('Yo‘nalishning o‘rtacha bali — shu yo‘nalishdagi **javob berilgan**');
out.push('savollar balining arifmetik o‘rtachasi. Javobsiz savollar hisobga');
out.push('olinmaydi. Yo‘nalishda umuman javob bo‘lmasa, natija «ma’lumot yetarli');
out.push('emas» bo‘ladi.');
out.push('');
let lo = 1.0;
for (const b of BANDS) {
  const hi = Math.min(b.max, 5).toFixed(2);
  out.push('- ' + lo.toFixed(2) + '–' + hi + ' — ' + b.label);
  lo = b.max + 0.01;
}
out.push('');
out.push('Bu chegaralar faqat qiziqish javoblarini guruhlash uchun. Ular');
out.push('tasdiqlangan psixometrik me’yorlar emas va bolaning qobiliyatini,');
out.push('aqlini yoki kelajakdagi kasbini o‘lchamaydi.');
out.push('');

const dest = path.join(__dirname, '..', '..', 'uploads', 'savollar-banki-1-4-sinflar-uz.md');
fs.writeFileSync(dest, out.join('\n'));
console.log('[build-bank] ' + dest + ' (' + COUNT + ' questions, ' + SECTIONS.length + ' sections)');
