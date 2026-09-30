'use strict';

// Data-access layer. All SQL lives here so routes stay thin and the queries are
// reviewable in one place.

const { query, withTransaction } = require('./pool');

// ---- sessions / children / messages ------------------------------------

// parentId is required under the Telegram-first flow (the adult logs in before
// the assessment). It stays a parameter rather than a hard NOT NULL so rows
// created by the older contact-gate flow remain readable.
async function createChildAndSession({ nickname, grade, age, goal, notes, model, promptVersion, sessionToken, parentId = null }) {
  return withTransaction(async (client) => {
    const child = (
      await client.query(
        `INSERT INTO children (nickname, grade, age, goal, notes, parent_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [nickname, grade, age, goal, notes, parentId]
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

// Parent-facing lookup: the unguessable session_token is the URL identifier
// (spec route /mashgulot/:token) and the credential in one.
async function getSessionByToken(token) {
  const { rows } = await query('SELECT * FROM sessions WHERE session_token = $1', [token]);
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
      // Refresh consent bookkeeping on re-contact so a changed consent text
      // version is recorded; never downgrade marketing consent.
      const { rows } = await query(
        `UPDATE parents
           SET name = $2,
               email = COALESCE($3, email),
               marketing_consent = marketing_consent OR $4,
               consent_text_version = $5,
               consented_at = now()
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

// Update the parent a child is already linked to (idempotent re-submit of the
// contact gate). Only sets phone if one is provided and not already taken.
async function updateParentContact(parentId, { phone, name, email, marketing, consentVersion }) {
  const { rows } = await query(
    `UPDATE parents
        SET name = $2,
            email = COALESCE($3, email),
            phone = CASE WHEN $4::text IS NOT NULL AND phone IS NULL THEN $4 ELSE phone END,
            marketing_consent = marketing_consent OR $5,
            consent_text_version = $6,
            consented_at = now()
      WHERE id = $1 RETURNING *`,
    [parentId, name, email, phone, marketing, consentVersion]
  );
  return rows[0] || null;
}

// ---- reports -----------------------------------------------------------

async function getReportBySession(sessionId) {
  const { rows } = await query('SELECT * FROM reports WHERE session_id = $1', [sessionId]);
  return rows[0] || null;
}

// Idempotent insert: the UNIQUE(session_id) plus ON CONFLICT DO NOTHING makes
// this the atomic claim that guarantees one report per session even under
// concurrent requests. Returns null if a report already exists (caller loses
// the race and should return the existing one instead of a 500).
async function createReport(r) {
  const { rows } = await query(
    `INSERT INTO reports
       (session_id, child_id, content_md, level_logic, level_psych, level_activity, sports, partial, share_token, delivered, delivered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
     ON CONFLICT (session_id) DO NOTHING
     RETURNING *`,
    [
      r.sessionId, r.childId, r.contentMd,
      r.levelLogic, r.levelPsych, r.levelActivity,
      JSON.stringify(r.sports || []), r.partial, r.shareToken,
      !!r.delivered, r.delivered ? new Date() : null,
    ]
  );
  return rows[0] || null;
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

// Right-to-erasure (spec §7): deleting a parent cascades to their children,
// sessions, messages and reports via the ON DELETE CASCADE foreign keys.
async function deleteParent(parentId) {
  const { rowCount } = await query('DELETE FROM parents WHERE id = $1', [parentId]);
  return rowCount > 0;
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
// Token/cost accounting: totals across all sessions (input/output tokens are
// accumulated per session by applyTurn). Powers the admin cost estimate.
async function tokenTotals() {
  const { rows } = await query(
    `SELECT count(*)::int AS sessions,
            count(*) FILTER (WHERE finished_at IS NOT NULL)::int AS finished,
            coalesce(sum(input_tokens),0)::bigint AS input_tokens,
            coalesce(sum(output_tokens),0)::bigint AS output_tokens
       FROM sessions`
  );
  const r = rows[0];
  return { sessions: r.sessions, finished: r.finished, inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens) };
}

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

// ---- Telegram authorization --------------------------------------------
// The adult logs in before the assessment, so every lead has a push channel.

// One parent row per Telegram account. Called from the bot webhook, so it must
// be idempotent: pressing /start twice must not create a second parent.
async function upsertParentByTelegram({ chatId, username, firstName, lastName }) {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Telegram foydalanuvchisi';
  const existing = (await query('SELECT * FROM parents WHERE telegram_chat_id = $1', [chatId])).rows[0];
  if (existing) {
    const { rows } = await query(
      `UPDATE parents
          SET telegram_username = $2,
              telegram_first_name = $3,
              name = CASE WHEN parents.name = '' THEN $4 ELSE parents.name END
        WHERE id = $1 RETURNING *`,
      [existing.id, username, firstName, name]
    );
    return rows[0];
  }
  const { rows } = await query(
    `INSERT INTO parents (name, telegram_chat_id, telegram_username, telegram_first_name, telegram_linked_at)
     VALUES ($1,$2,$3,$4, now()) RETURNING *`,
    [name, chatId, username, firstName]
  );
  return rows[0];
}

// Telegram-verified phone from a shared contact. The phone column is UNIQUE and
// a legacy row (created by the old phone gate) may already hold this number —
// in that case we keep the Telegram identity and leave the phone unset rather
// than failing the login. Returns null when the number was already taken.
async function setParentPhone(parentId, phone) {
  const { rows } = await query(
    `UPDATE parents SET phone = $2, phone_verified = TRUE
      WHERE id = $1
        AND NOT EXISTS (SELECT 1 FROM parents WHERE phone = $2 AND id <> $1)
      RETURNING *`,
    [parentId, phone]
  );
  return rows[0] || null;
}

// Consent recorded in the browser before the deep link was opened. Never
// downgrades an existing marketing consent.
async function applyAuthConsent(parentId, marketing, consentVersion) {
  const { rows } = await query(
    `UPDATE parents
        SET marketing_consent = marketing_consent OR $2,
            consent_text_version = COALESCE($3, consent_text_version),
            consented_at = now()
      WHERE id = $1 RETURNING *`,
    [parentId, !!marketing, consentVersion]
  );
  return rows[0];
}

async function createAuthRequest({ nonce, marketing, consentVersion, ttlMinutes }) {
  const { rows } = await query(
    `INSERT INTO auth_requests (nonce, marketing_consent, consent_text_version, expires_at)
     VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval) RETURNING *`,
    [nonce, !!marketing, consentVersion, String(ttlMinutes)]
  );
  return rows[0];
}

async function getParentByChatId(chatId) {
  const { rows } = await query('SELECT * FROM parents WHERE telegram_chat_id = $1', [chatId]);
  return rows[0] || null;
}

// The login this parent is part-way through, so the contact message can finish
// a handshake it does not carry the nonce for. Newest first: a second /start
// supersedes an abandoned one.
async function getPendingAuthRequestForParent(parentId) {
  const { rows } = await query(
    `SELECT * FROM auth_requests
      WHERE parent_id = $1 AND status IN ('pending', 'awaiting_phone') AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [parentId]
  );
  return rows[0] || null;
}

async function getAuthRequest(nonce) {
  const { rows } = await query(
    'SELECT * FROM auth_requests WHERE nonce = $1 AND expires_at > now()',
    [nonce]
  );
  return rows[0] || null;
}

// Bind a Telegram chat to a pending nonce. `status` is 'awaiting_phone' while
// the bot waits for the contact, or 'linked' when no phone is required.
async function bindAuthRequest(nonce, parentId, status) {
  const { rows } = await query(
    `UPDATE auth_requests
        SET parent_id = $2, status = $3, linked_at = now()
      WHERE nonce = $1 AND expires_at > now() AND status IN ('pending', 'awaiting_phone')
      RETURNING *`,
    [nonce, parentId, status]
  );
  return rows[0] || null;
}

// Issue the long-lived browser token and mark the handshake complete.
async function completeAuthRequest(nonce, token, ttlDays) {
  return withTransaction(async (client) => {
    const req = (
      await client.query(
        `UPDATE auth_requests SET status = 'linked', token = $2
          WHERE nonce = $1 AND expires_at > now() AND status IN ('pending', 'awaiting_phone')
          RETURNING *`,
        [nonce, token]
      )
    ).rows[0];
    if (!req || !req.parent_id) return null;
    await client.query(
      `INSERT INTO parent_tokens (token, parent_id, expires_at)
       VALUES ($1,$2, now() + ($3 || ' days')::interval)
       ON CONFLICT (token) DO NOTHING`,
      [token, req.parent_id, String(ttlDays)]
    );
    return req;
  });
}

// Hand the token to the browser exactly once, then burn the nonce.
async function consumeAuthRequest(nonce) {
  const { rows } = await query(
    `UPDATE auth_requests SET status = 'consumed'
      WHERE nonce = $1 AND status = 'linked' AND expires_at > now()
      RETURNING *`,
    [nonce]
  );
  return rows[0] || null;
}

// Validate a browser login token. Touches last_used_at so idle logins are
// visible, and refuses expired rows without needing a sweeper to have run.
async function getParentByToken(token) {
  if (!token) return null;
  const { rows } = await query(
    `UPDATE parent_tokens SET last_used_at = now()
      WHERE token = $1 AND expires_at > now()
      RETURNING parent_id`,
    [token]
  );
  if (!rows[0]) return null;
  const p = await query('SELECT * FROM parents WHERE id = $1', [rows[0].parent_id]);
  return p.rows[0] || null;
}

async function revokeParentToken(token) {
  await query('DELETE FROM parent_tokens WHERE token = $1', [token]);
}

// ---- funnel analytics ---------------------------------------------------

// Fire-and-forget by contract: analytics must never be the reason a parent
// cannot start an assessment, so a failure here is logged and swallowed. The
// caller may await it (cheap single INSERT) without having to guard it.
async function recordEvent({ visitorId, stage, parentId = null, sessionId = null, source = null }) {
  if (!visitorId || !stage) return false;
  try {
    await query(
      `INSERT INTO analytics_events (visitor_id, stage, parent_id, session_id, source)
       VALUES ($1,$2,$3,$4,$5)`,
      [visitorId, stage, parentId, sessionId, source ? String(source).slice(0, 120) : null]
    );
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[analytics] dropped event', stage, err.message);
    return false;
  }
}

// Distinct visitors per stage over the window. Counting visitors rather than
// events is what makes reloads and double-fired beacons harmless.
async function funnelCounts(days) {
  const { rows } = await query(
    `SELECT stage, count(DISTINCT visitor_id)::int AS n
       FROM analytics_events
      WHERE created_at >= now() - ($1 || ' days')::interval
      GROUP BY stage`,
    [days]
  );
  const out = {};
  for (const r of rows) out[r.stage] = Number(r.n);

  // The last stage is not an event: a lead becomes "enrolled" when an admin
  // says so in the panel, possibly weeks later. Count the visitors whose
  // parent has that status, windowed on when they visited (not on when the
  // admin got round to updating them) so the row lines up with the rest.
  const { rows: conv } = await query(
    `SELECT count(DISTINCT e.visitor_id)::int AS n
       FROM analytics_events e
       JOIN parents p ON p.id = e.parent_id
      WHERE p.lead_status = 'enrolled'
        AND e.created_at >= now() - ($1 || ' days')::interval`,
    [days]
  );
  out.enrolled = Number((conv[0] || {}).n || 0);
  return out;
}

// Where the traffic came from, for the visitors who arrived in the window.
// One row per source with how many of those visitors ever reached a session.
async function funnelBySource(days) {
  const { rows } = await query(
    `WITH first_touch AS (
       SELECT DISTINCT ON (visitor_id) visitor_id, COALESCE(source, 'direct') AS source
         FROM analytics_events
        WHERE created_at >= now() - ($1 || ' days')::interval
        ORDER BY visitor_id, created_at
     ),
     reached AS (
       SELECT DISTINCT visitor_id FROM analytics_events
        WHERE stage = 'session_start'
          AND created_at >= now() - ($1 || ' days')::interval
     )
     SELECT f.source,
            count(*)::int AS visitors,
            count(r.visitor_id)::int AS started
       FROM first_touch f
       LEFT JOIN reached r ON r.visitor_id = f.visitor_id
      GROUP BY f.source
      ORDER BY visitors DESC
      LIMIT 10`,
    [days]
  );
  return rows.map((r) => ({ source: r.source, visitors: Number(r.visitors), started: Number(r.started) }));
}

module.exports = {
  createChildAndSession, getSessionById, getSessionByToken, getChildById,
  addMessage, getMessages, applyTurn, setSessionStatus,
  upsertParent, linkChildToParent, updateParentContact,
  getReportBySession, createReport, getReportByShareToken, markReportDelivered,
  getAdminByEmail, listLeads, getParent, getLeadChildren, updateLead, deleteParent, weeklyBuckets, tokenTotals,
  upsertParentByTelegram, setParentPhone, applyAuthConsent,
  createAuthRequest, getAuthRequest, bindAuthRequest, completeAuthRequest, consumeAuthRequest,
  getParentByChatId, getPendingAuthRequestForParent,
  getParentByToken, revokeParentToken,
  recordEvent, funnelCounts, funnelBySource,
};
