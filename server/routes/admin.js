'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { config } = require('../config');
const repo = require('../db/repo');
const { adminAuth, signAdmin, adminCookieOptions } = require('../middleware/auth');
const { rateLimit, clientIp } = require('../middleware/rateLimit');
const { asyncHandler, badRequest, unauthorized, notFound } = require('../utils/http');
const leadStatus = require('../utils/leadStatus');
const { formatUzPhone } = require('../utils/phone');

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.adminLoginPerMin,
  key: (r) => 'adminlogin:' + clientIp(r),
  message: 'Juda ko‘p urinish. Bir daqiqadan so‘ng qayta urinib ko‘ring.',
});

// POST /admin/login
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');
    if (!email || !password) throw badRequest('Email va parolni kiriting.');
    const admin = await repo.getAdminByEmail(email);
    // Always run a compare to keep timing uniform whether or not the user exists.
    const hash = admin ? admin.password_hash : '$2a$12$0000000000000000000000000000000000000000000000000000';
    const ok = await bcrypt.compare(password, hash).catch(() => false);
    if (!admin || !ok) throw unauthorized('Email yoki parol noto‘g‘ri.');
    res.cookie(config.admin.cookieName, signAdmin(admin), adminCookieOptions());
    res.json({ ok: true, email: admin.email });
  })
);

// POST /admin/logout
router.post('/logout', (req, res) => {
  res.clearCookie(config.admin.cookieName, { path: '/' });
  res.json({ ok: true });
});

// GET /admin/me — session probe used by the frontend to know if it's authed.
router.get('/me', adminAuth, (req, res) => {
  res.json({ email: req.admin.email, role: req.admin.role });
});

function leadRow(r) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ? formatUzPhone(r.phone) : null,
    children_label: r.children_label || null,
    children_count: r.children_count,
    sessions_count: r.sessions_count,
    last_report_at: r.last_report_at,
    lead_status: r.lead_status,
    lead_status_label: leadStatus.toLabel(r.lead_status),
  };
}

// GET /admin/leads
router.get(
  '/leads',
  adminAuth,
  asyncHandler(async (req, res) => {
    const rows = await repo.listLeads({
      status: leadStatus.toEnum(req.query.status), // null (no filter) for 'all'/unknown
      grade: req.query.grade,
      sinceDays: req.query.date,
    });
    res.json({ leads: rows.map(leadRow), statuses: leadStatus.options() });
  })
);

// GET /admin/leads/:id
router.get(
  '/leads/:id',
  adminAuth,
  asyncHandler(async (req, res) => {
    const parent = await repo.getParent(req.params.id);
    if (!parent) throw notFound('Lid topilmadi.');
    const rows = await repo.getLeadChildren(parent.id);
    const byChild = new Map();
    for (const row of rows) {
      if (!byChild.has(row.child_id)) {
        byChild.set(row.child_id, { name: row.nickname, grade: row.grade, sessions: [] });
      }
      // Only sessions that produced a report are listed (they carry a link).
      if (row.share_token) {
        byChild.get(row.child_id).sessions.push({
          date: row.report_at || row.started_at,
          partial: row.partial,
          share_token: row.share_token,
        });
      }
    }
    res.json({
      parent: {
        id: parent.id,
        name: parent.name,
        phone: parent.phone ? formatUzPhone(parent.phone) : null,
        marketing_consent: parent.marketing_consent,
        consent_text_version: parent.consent_text_version,
        consented_at: parent.consented_at,
        lead_status: parent.lead_status,
        admin_notes: parent.admin_notes,
        created_at: parent.created_at,
      },
      children: Array.from(byChild.values()),
      statuses: leadStatus.options(),
    });
  })
);

// PATCH /admin/leads/:id
router.patch(
  '/leads/:id',
  adminAuth,
  asyncHandler(async (req, res) => {
    const parent = await repo.getParent(req.params.id);
    if (!parent) throw notFound('Lid topilmadi.');
    const patch = {};
    if (req.body && req.body.lead_status !== undefined) {
      const st = leadStatus.toEnum(req.body.lead_status);
      if (!st) throw badRequest('Holat noto‘g‘ri.');
      patch.leadStatus = st;
    }
    if (req.body && req.body.admin_notes !== undefined) {
      patch.adminNotes = String(req.body.admin_notes).slice(0, 4000);
    }
    const updated = await repo.updateLead(parent.id, patch);
    res.json({ ok: true, lead_status: updated.lead_status, admin_notes: updated.admin_notes });
  })
);

// GET /admin/stats — weekly funnel buckets (frontend renders funnel + table).
router.get(
  '/stats',
  adminAuth,
  asyncHandler(async (req, res) => {
    const buckets = await repo.weeklyBuckets();
    res.json({ buckets });
  })
);

// GET /admin/export/leads.csv
router.get(
  '/export/leads.csv',
  adminAuth,
  asyncHandler(async (req, res) => {
    const rows = await repo.listLeads({
      status: leadStatus.toEnum(req.query.status),
      grade: req.query.grade,
      sinceDays: req.query.date,
    });
    const q = (val) => '"' + String(val == null ? '' : val).replace(/"/g, '""') + '"';
    const head = ['Ota-ona', 'Telefon', 'Holat', 'Marketing roziligi', 'Bolalar', "Mashg'ulotlar", "Qo'shilgan"];
    const lines = [head.map(q).join(',')];
    for (const r of rows) {
      lines.push([
        r.name,
        r.phone ? formatUzPhone(r.phone) : '',
        leadStatus.toLabel(r.lead_status),
        r.marketing_consent ? 'Ha' : "Yo'q",
        r.children_label || '',
        r.sessions_count,
        r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
      ].map(q).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="lidlar.csv"');
    res.send('﻿' + lines.join('\n'));
  })
);

module.exports = router;
