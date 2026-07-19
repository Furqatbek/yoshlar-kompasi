'use strict';

const express = require('express');
const router = express.Router();

const repo = require('../db/repo');
const { rateLimit, clientIp } = require('../middleware/rateLimit');
const { asyncHandler, notFound } = require('../utils/http');

// A modest IP limiter; share tokens are 144-bit so brute force is infeasible,
// but this bounds scraping.
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  key: (r) => 'report:' + clientIp(r),
  message: 'Juda ko‘p so‘rov.',
});

// GET /api/reports/:token — public report data (unguessable token, no login).
router.get(
  '/:token',
  readLimiter,
  asyncHandler(async (req, res) => {
    const r = await repo.getReportByShareToken(req.params.token);
    if (!r) throw notFound('Hisobot topilmadi.');
    res.json({
      content_md: r.content_md,
      nickname: r.nickname,
      grade: r.grade,
      partial: r.partial,
      date: r.created_at,
      levels: { logic: r.level_logic, psych: r.level_psych, activity: r.level_activity },
      sports: r.sports,
    });
  })
);

module.exports = router;
