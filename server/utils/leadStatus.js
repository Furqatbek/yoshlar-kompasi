'use strict';

// The DB stores a stable English enum; the UI speaks Uzbek. Map at the boundary.
const ORDER = ['new', 'contacted', 'interested', 'enrolled', 'closed'];
const LABELS = {
  new: 'Yangi',
  contacted: "Bog'lanildi",
  interested: 'Qiziqish bildirdi',
  enrolled: 'Yozildi',
  closed: 'Yopildi',
};
const REVERSE = Object.fromEntries(Object.entries(LABELS).map(([k, val]) => [val.toLowerCase(), k]));

function toLabel(enumValue) {
  return LABELS[enumValue] || enumValue;
}

// Accept either the enum value or the Uzbek label; return a valid enum or null.
function toEnum(input) {
  if (!input) return null;
  const low = String(input).trim().toLowerCase();
  if (ORDER.includes(low)) return low;
  if (REVERSE[low]) return REVERSE[low];
  return null;
}

function options() {
  return ORDER.map((value) => ({ value, label: LABELS[value] }));
}

module.exports = { ORDER, LABELS, toLabel, toEnum, options };
