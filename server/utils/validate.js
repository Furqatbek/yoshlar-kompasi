'use strict';

const { badRequest } = require('./http');

function str(v) {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
function trimmed(v) {
  return str(v).trim();
}

// Required non-empty string with a max length.
function reqStr(v, field, max) {
  const s = trimmed(v);
  if (!s) throw badRequest(field + ' — majburiy.', 'required');
  if (max && s.length > max) throw badRequest(field + ' juda uzun.', 'too_long');
  return s;
}

// Optional string, capped and trimmed; empty → null.
function optStr(v, max) {
  const s = trimmed(v);
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

function grade(v) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 1 || n > 4) throw badRequest('Sinf 1–4 oralig‘ida bo‘lishi kerak.', 'bad_grade');
  return n;
}

function optAge(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 3 || n > 18) throw badRequest('Yosh 3–18 oralig‘ida bo‘lishi kerak.', 'bad_age');
  return n;
}

function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

module.exports = { str, trimmed, reqStr, optStr, grade, optAge, bool };
