'use strict';

// Parsing helpers for Claude output.
//  - track markers: [YAKUN: MANTIQ|PSIXOLOGIYA|HARAKAT] drive the report gate.
//  - the report's trailing ```json block feeds the structured admin columns.

const TRACKS = ['MANTIQ', 'PSIXOLOGIYA', 'HARAKAT'];

// Which tracks a reply reports as complete.
function parseTrackMarkers(text) {
  const found = { MANTIQ: false, PSIXOLOGIYA: false, HARAKAT: false };
  const re = /\[YAKUN:\s*(MANTIQ|PSIXOLOGIYA|HARAKAT)\s*\]/gi;
  let m;
  while ((m = re.exec(String(text)))) found[m[1].toUpperCase()] = true;
  return found;
}

function stripMarkers(text) {
  return String(text)
    .split('\n')
    .filter((l) => !/^\s*\[YAKUN:\s*(MANTIQ|PSIXOLOGIYA|HARAKAT)\s*\]\s*$/i.test(l))
    .join('\n')
    .replace(/\[YAKUN:\s*(MANTIQ|PSIXOLOGIYA|HARAKAT)\s*\]/gi, '')
    .trim();
}

const LEVELS = ['shakllanmoqda', 'meyorda', 'kuchli'];
function normLevel(v) {
  if (v == null) return null;
  const s = String(v).toLowerCase();
  if (s.includes('kuchli')) return 'kuchli';
  if (s.includes('shakl')) return 'shakllanmoqda';
  if (s.includes('yor') || s.includes('meyor') || s.includes("me'yor")) return 'meyorda';
  return null;
}

// Parse the report: pull the last ```json block into structured columns and
// strip it (and any stray markers) from the markdown stored/shown to users.
function parseReport(rawText) {
  const text = stripMarkers(rawText);
  const re = /```json\s*([\s\S]*?)```/gi;
  let m;
  let last = null;
  while ((m = re.exec(text))) last = m;

  let levels = null;
  let sports = [];
  let contentMd = text;

  if (last) {
    try {
      const j = JSON.parse(last[1].trim());
      if (j && typeof j === 'object') {
        levels = j.levels && typeof j.levels === 'object' ? j.levels : null;
        sports = Array.isArray(j.sports) ? j.sports.map((s) => String(s)).filter(Boolean) : [];
      }
    } catch (_) { /* leave structured fields null */ }
    contentMd = (text.slice(0, last.index) + text.slice(last.index + last[0].length)).trim();
  }

  return {
    contentMd,
    levelLogic: levels ? normLevel(levels.mantiq) : null,
    levelPsych: levels ? normLevel(levels.psixologiya) : null,
    levelActivity: levels ? normLevel(levels.harakat) : null,
    sports,
  };
}

module.exports = { TRACKS, LEVELS, parseTrackMarkers, stripMarkers, parseReport, normLevel };
