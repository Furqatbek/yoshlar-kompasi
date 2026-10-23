'use strict';

// The reading diary (§19). Parent-scoped, because it outlives the sitting that
// introduced it — a session token is one assessment, and this is kept for
// months across devices.
//
// Every route goes through parentAuth and every query is bounded by the
// children that parent owns. A diary holds a child's own words about what they
// read and what they did not understand; "fetch it, then check who owns it" is
// one forgotten branch away from handing that to a stranger, so the ownership
// is in the SQL.

const express = require('express');
const router = express.Router();

const repo = require('../db/repo');
const { parentAuth } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../utils/http');

const MAX_TEXT = 2000;
const TEXT_FIELDS = ['author', 'favourite_moment', 'favourite_character',
  'unclear_part', 'opinion', 'discussed', 'next_choice'];

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !Number.isNaN(Date.parse(s));

// GET /api/diary — this parent's children and their entries.
router.get(
  '/',
  parentAuth,
  asyncHandler(async (req, res) => {
    const childId = req.query.child_id ? String(req.query.child_id) : null;
    const [children, entries] = await Promise.all([
      repo.diaryChildren(req.parent.id),
      repo.listDiary(req.parent.id, childId),
    ]);
    res.json({ children, entries });
  })
);

// POST /api/diary — add or update one book's entry.
router.post(
  '/',
  parentAuth,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const childId = String(b.child_id || '');
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!childId) throw badRequest('Bolani tanlang');
    if (!title) throw badRequest('Kitob nomini yozing');
    if (title.length > 300) throw badRequest('Kitob nomi juda uzun');

    const fields = { title };
    for (const k of TEXT_FIELDS) {
      if (!(k in b)) continue; // absent means "leave it alone"
      const v = b[k];
      if (v !== null && typeof v !== 'string') throw badRequest('Noto‘g‘ri qiymat: ' + k);
      if (typeof v === 'string' && v.length > MAX_TEXT) throw badRequest('Matn juda uzun: ' + k);
      fields[k] = typeof v === 'string' ? v.trim() : null;
    }

    if ('started_on' in b) {
      if (b.started_on !== null && !isDate(b.started_on)) throw badRequest('Boshlangan sana noto‘g‘ri');
      fields.started_on = b.started_on || null;
    }

    // §19: "Bola o‘qimagan kitobni tugatilgan deb belgilamang."
    //
    // A database cannot know whether a child read a book. What it can refuse
    // is the shape of the claim: finished means somebody entered the day it
    // was finished. The constraint enforces it too — this is the readable
    // error rather than a 500 from a CHECK violation.
    const status = b.status === 'finished' ? 'finished' : (b.status === 'reading' ? 'reading' : null);
    if (status) {
      fields.status = status;
      if (status === 'finished') {
        if (!isDate(b.finished_on)) {
          throw badRequest(
            'Kitob tugatilgan deb belgilash uchun tugatilgan sanani yozing.',
            'finished_needs_date');
        }
        fields.finished_on = b.finished_on;
      } else {
        // Going back to "reading" clears the finish date rather than leaving a
        // stale one behind for the next edit to resurrect.
        fields.finished_on = null;
      }
    }

    if (fields.started_on && fields.finished_on && fields.finished_on < fields.started_on) {
      throw badRequest('Tugatilgan sana boshlangan sanadan oldin bo‘lishi mumkin emas.');
    }

    const entry = await repo.upsertDiaryEntry(req.parent.id, childId, fields);
    // Null means the child is not this parent's. Not found rather than
    // forbidden: whether somebody else's child exists is not this caller's
    // business either way.
    if (!entry) throw notFound('Bola topilmadi');
    res.status(201).json({ entry });
  })
);

router.delete(
  '/:id',
  parentAuth,
  asyncHandler(async (req, res) => {
    if (!(await repo.deleteDiaryEntry(req.parent.id, req.params.id))) {
      throw notFound('Yozuv topilmadi');
    }
    res.json({ ok: true });
  })
);

module.exports = router;
