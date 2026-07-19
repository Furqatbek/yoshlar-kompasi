'use strict';

// Data-access layer. All SQL lives here so routes stay thin and the queries are
// reviewable in one place.

const { query, withTransaction } = require('./pool');

// ---- sessions / children / messages ------------------------------------

async function createChildAndSession({ nickname, grade, age, goal, notes, model, promptVersion, sessionToken }) {
  return withTransaction(async (client) => {
    const child = (
      await client.query(
        `INSERT INTO children (nickname, grade, age, goal, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [nickname, grade, age, goal, notes]
      )
    ).rows[0];
    const session = (
      await client.query(
        `INSERT INTO sessions (child_id, session_token, prompt_version, model)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [child.id, sessionToken, promptVersion, model]
      )
    ).rows[0];
    return { child, session };
  });
}

async function getSessionById(id) {
  const { rows } = await query('SELECT * FROM sessions WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getChildById(id) {
  const { rows } = await query('SELECT * FROM children WHERE id = $1', [id]);
  return rows[0] || null;
}

async function addMessage(sessionId, role, content, meta = false) {
  const { rows } = await query(
    `INSERT INTO messages (session_id, role, content, meta)
     VALUES ($1,$2,$3,$4) RETURNING id, role, content, meta, created_at`,
    [sessionId, role, content, meta]
  );
  return rows[0];
}

async function getMessages(sessionId) {
  const { rows } = await query(
    'SELECT role, content, meta FROM messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC',
    [sessionId]
  );
  return rows;
}

// Apply the results of one Claude turn: bump turn count, add token usage, OR the
// completed tracks in, and (optionally) mark the session finished.
async function applyTurn(sessionId, { inputTokens = 0, outputTokens = 0, progress = null, incTurn = true }) {
  const sets = ['input_tokens = input_tokens + $2', 'output_tokens = output_tokens + $3'];
  const params = [sessionId, inputTokens, outputTokens];
  if (incTurn) sets.push('turn_count = turn_count + 1');
  if (progress) {
    sets.push('done_mantiq = done_mantiq OR $4');
    sets.push('done_psixologiya = done_psixologiya OR $5');
    sets.push('done_harakat = done_harakat OR $6');
    params.push(!!progress.MANTIQ, !!progress.PSIXOLOGIYA, !!progress.HARAKAT);
  }
  const { rows } = await query(
    `UPDATE sessions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0];
}

async function setSessionStatus(sessionId, status, finished = false) {
  const { rows } = await query(
    `UPDATE sessions SET status = $2${finished ? ', finished_at = now()' : ''} WHERE id = $1 RETURNING *`,
    [sessionId, status]
  );
  return rows[0];
}

// ---- parents / contact -------------------------------------------------

// Dedupe parents by normalized phone. A repeat family attaches to the existing
// record. Consent is never downgraded.
async function upsertParent({ phone, name, email, marketing, consentVersion }) {
  if (phone) {
    const existing = (await query('SELECT * FROM parents WHERE phone = $1', [phone])).rows[0];
    if (existing) {
      const { rows } = await query(
        `UPDATE parents
           SET name = $2,
               email = COALESCE($3, email),
               marketing_consent = marketing_consent OR $4,
               consent_text_version = COALESCE(consent_text_version, $5),
               consented_at = COALESCE(consented_at, now())
         WHERE id = $1 RETURNING *`,
        [existing.id, name, email, marketing, consentVersion]
      );
      return rows[0];
    }
  }
  const { rows } = await query(
    `INSERT INTO parents (name, phone, email, marketing_consent, consent_text_version, consented_at)
     VALUES ($1,$2,$3,$4,$5, now()) RETURNING *`,
    [name, phone, email, marketing, consentVersion]
  );
  return rows[0];
}

async function linkChildToParent(childId, parentId) {
  await query('UPDATE children SET parent_id = $2 WHERE id = $1', [childId, parentId]);
}

// ---- reports -----------------------------------------------------------

async function getReportBySession(sessionId) {
  const { rows } = await query('SELECT * FROM reports WHERE session_id = $1', [sessionId]);
  return rows[0] || null;
}

async function createReport(r) {
  const { rows } = await query(
    `INSERT INTO reports
       (session_id, child_id, content_md, level_logic, level_psych, level_activity, sports, partial, share_token, delivered, delivered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
     RETURNING *`,
    [
      r.sessionId, r.childId, r.contentMd,
      r.levelLogic, r.levelPsych, r.levelActivity,
      JSON.stringify(r.sports || []), r.partial, r.shareToken,
      !!r.delivered, r.delivered ? new Date() : null,
    ]
  );
  return rows[0];
}

async function getReportByShareToken(token) {
  const { rows } = await query(
    `SELECT r.*, c.nickname, c.grade
       FROM reports r JOIN children c ON c.id = r.child_id
      WHERE r.share_token = $1`,
    [token]
  );
  return rows[0] || null;
}

async function markReportDelivered(shareToken) {
  await query(
    `UPDATE reports SET delivered = TRUE, delivered_at = COALESCE(delivered_at, now())
     WHERE share_token = $1`,
    [shareToken]
  );
}

// ---- admin -------------------------------------------------------------

async function getAdminByEmail(email) {
  const { rows } = await query('SELECT * FROM admins WHERE email = $1', [email]);
  return rows[0] || null;
}

async function listLeads({ status, grade, sinceDays }) {
  const where = [];
  const params = [];
  if (status && status !== 'all') { params.push(status); where.push(`p.lead_status = $${params.length}`); }
  if (grade && grade !== 'all') {
    params.push(parseInt(grade, 10));
    where.push(`EXISTS (SELECT 1 FROM children cc WHERE cc.parent_id = p.id AND cc.grade = $${params.length})`);
  }
  if (sinceDays && sinceDays !== 'all') {
    params.push(parseInt(sinceDays, 10));
    where.push(`p.created_at >= now() - ($${params.length} || ' days')::interval`);
  }
  const sql = `
    SELECT p.id, p.name, p.phone, p.marketing_consent, p.lead_status, p.created_at,
           COUNT(DISTINCT c.id)::int AS children_count,
           COUNT(DISTINCT s.id)::int AS sessions_count,
           MAX(r.created_at) AS last_report_at,
           string_agg(DISTINCT c.nickname || ' · ' || c.grade || '-sinf', ', ') AS children_label
      FROM parents p
      LEFT JOIN children c ON c.parent_id = p.id
      LEFT JOIN sessions s ON s.child_id = c.id
      LEFT JOIN reports  r ON r.child_id = c.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY p.id
     ORDER BY p.created_at DESC`;
  const { rows } = await query(sql, params);
  return rows;
}

async function getParent(parentId) {
  const { rows } = await query('SELECT * FROM parents WHERE id = $1', [parentId]);
  return rows[0] || null;
}

async function getLeadChildren(parentId) {
  const { rows } = await query(
    `SELECT c.id AS child_id, c.nickname, c.grade,
            s.id AS session_id, s.status, s.started_at,
            r.share_token, r.partial, r.created_at AS report_at
       FROM children c
       LEFT JOIN sessions s ON s.child_id = c.id
       LEFT JOIN reports  r ON r.session_id = s.id
      WHERE c.parent_id = $1
      ORDER BY c.created_at ASC, s.started_at ASC`,
    [parentId]
  );
  return rows;
}

async function updateLead(parentId, { leadStatus, adminNotes }) {
  const sets = [];
  const params = [parentId];
  if (leadStatus !== undefined) { params.push(leadStatus); sets.push(`lead_status = $${params.length}`); }
  if (adminNotes !== undefined) { params.push(adminNotes); sets.push(`admin_notes = $${params.length}`); }
  if (!sets.length) return getParent(parentId);
  const { rows } = await query(
    `UPDATE parents SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

// Weekly funnel counts for the last 4 weeks (bucket 0 = this week).
async function weeklyBuckets() {
  const buckets = [0, 1, 2, 3].map(() => ({ started: 0, finished: 0, contact: 0, delivered: 0 }));
  const runOne = async (key, sql) => {
    const { rows } = await query(sql);
    for (const row of rows) {
      const wk = Number(row.wk);
      if (wk >= 0 && wk < 4) buckets[wk][key] = Number(row.n);
    }
  };
  const bucketExpr = (col) => `floor(extract(epoch from (now() - ${col})) / 604800)::int`;
  await runOne('started',
    `SELECT ${bucketExpr('started_at')} AS wk, count(*)::int AS n FROM sessions
      WHERE started_at >= now() - interval '28 days' GROUP BY wk`);
  await runOne('finished',
    `SELECT ${bucketExpr('finished_at')} AS wk, count(*)::int AS n FROM sessions
      WHERE finished_at IS NOT NULL AND finished_at >= now() - interval '28 days' GROUP BY wk`);
  await runOne('contact',
    `SELECT ${bucketExpr('consented_at')} AS wk, count(*)::int AS n FROM parents
      WHERE consented_at IS NOT NULL AND consented_at >= now() - interval '28 days' GROUP BY wk`);
  await runOne('delivered',
    `SELECT ${bucketExpr('delivered_at')} AS wk, count(*)::int AS n FROM reports
      WHERE delivered_at IS NOT NULL AND delivered_at >= now() - interval '28 days' GROUP BY wk`);
  return buckets;
}

module.exports = {
  createChildAndSession, getSessionById, getChildById,
  addMessage, getMessages, applyTurn, setSessionStatus,
  upsertParent, linkChildToParent,
  getReportBySession, createReport, getReportByShareToken, markReportDelivered,
  getAdminByEmail, listLeads, getParent, getLeadChildren, updateLead, weeklyBuckets,
};
