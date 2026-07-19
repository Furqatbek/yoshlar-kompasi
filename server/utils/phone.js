'use strict';

// Normalize an Uzbek phone number to E.164 (+998XXXXXXXXX). The frontend
// collects the 9 national digits (operator code + number). Deduplicating
// parents by normalized phone (backend-spec §5) depends on this being stable.

function normalizeUzPhone(input) {
  if (input == null) return null;
  let d = String(input).replace(/\D/g, '');
  if (!d) return null;
  // Drop a leading international 00.
  if (d.startsWith('00')) d = d.slice(2);
  // With country code already present.
  if (d.length === 12 && d.startsWith('998')) return '+' + d;
  // Bare 9 national digits.
  if (d.length === 9) return '+998' + d;
  // Some inputs include a leading 0 before the 9 digits.
  if (d.length === 10 && d.startsWith('0')) return '+998' + d.slice(1);
  return null; // anything else is invalid
}

function isValidUzPhone(input) {
  return normalizeUzPhone(input) !== null;
}

// Display form used in admin lists: "+998 90 123-45-67".
function formatUzPhone(e164) {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(String(e164 || ''));
  if (!m) return e164 || '';
  return '+998 ' + m[1] + ' ' + m[2] + '-' + m[3] + '-' + m[4];
}

module.exports = { normalizeUzPhone, isValidUzPhone, formatUzPhone };
