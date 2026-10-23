'use strict';

// Data-access layer. All SQL lives here so routes stay thin and the queries are
// reviewable in one place.

const { query, withTransaction } = require('./pool');

// ---- sessions / children / messages ------------------------------------

// parentId is required under the Telegram-first flow (the adult logs in before
// the assessment). It stays a parameter rather than a hard NOT NULL so rows
// created by the older contact-gate flow remain readable.
async function createChildAndSession({ nickname, grade, age, goal, notes, model, promptVersion, sessionToken, parentId = null, administeredBy = null }) {
  return withTransaction(async (client) => {
    const child = (
      await client.query(
        `INSERT INTO children (nickname, grade, age, goal, notes, parent_id, administered_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [nickname, grade, age, goal, notes, parentId, administeredBy]
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

// Apply the results of one Claude turn: bump turn count and add token usage.
// Progress through the 70 questions is not kept here — it is recorded by
// saveAnswers() from the model's [JAVOBLAR:] line, so the count always matches
// rows that exist rather than a flag somebody set.
async function applyTurn(sessionId, { inputTokens = 0, outputTokens = 0, incTurn = true }) {
  const sets = ['input_tokens = input_tokens + $2', 'output_tokens = output_tokens + $3'];
  const params = [sessionId, inputTokens, outputTokens];
  if (incTurn) sets.push('turn_count = turn_count + 1');
  const { rows } = await query(
    `UPDATE sessions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0];
}

// Record a batch. `answers` carry a 1-5 value; `skipped` are question numbers
// the child passed on, stored with a NULL value so the sitting can reach the
// end without those questions ever entering an average.
//
// Re-answering overwrites, so a correction replaces rather than double-counts.
// A skip never overwrites a real answer: going back and answering a question
// is progress, and a later batch repeating the skip must not undo it.
async function saveAnswers(sessionId, answers, skipped) {
  const rowsIn = [
    ...(answers || []).map((a) => [a.question_n, a.value]),
    ...(skipped || []).map((n) => [n, null]),
  ];
  if (!rowsIn.length) return null;
  return withTransaction(async (c) => {
    for (const [n, value] of rowsIn) {
      await c.query(
        `INSERT INTO answers (session_id, question_n, value) VALUES ($1, $2, $3)
         ON CONFLICT (session_id, question_n) DO UPDATE
           SET value = COALESCE(EXCLUDED.value, answers.value), updated_at = now()`,
        [sessionId, n, value]
      );
    }
    const { rows } = await c.query(
      `UPDATE sessions SET
         answered_count = (SELECT count(*) FROM answers WHERE session_id = $1 AND value IS NOT NULL),
         seen_count     = (SELECT count(*) FROM answers WHERE session_id = $1)
       WHERE id = $1 RETURNING *`,
      [sessionId]
    );
    return rows[0];
  });
}

// Every row, skips included — what the UI needs to restore a part-finished
// sitting exactly as the adult left it.
async function getAnswerRows(sessionId) {
  const { rows } = await query(
    'SELECT question_n, value FROM answers WHERE session_id = $1 ORDER BY question_n ASC',
    [sessionId]
  );
  return rows;
}

async function getAnswers(sessionId) {
  const { rows } = await query(
    'SELECT question_n, value FROM answers WHERE session_id = $1 AND value IS NOT NULL ORDER BY question_n ASC',
    [sessionId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// The catalogues (§17 books, §16 tutors).
//
// Two readers, and the difference between them is the point:
//
//   listBooks / listTutors   — the admin panel. Everything, approved or not.
//   approvedBooks / approvedTutors — what may reach the model. Approved AND
//                            active only, and these are the ONLY functions the
//                            report path calls.
//
// Keeping them apart means a bulk import cannot put an unchecked title in front
// of a parent even for the minutes before somebody reviews it.

const BOOK_FIELDS = ['title', 'author', 'age_min', 'age_max', 'genre',
  'reading_level', 'language', 'list_position', 'source', 'approved', 'active', 'notes'];

async function listBooks({ limit = 500 } = {}) {
  const { rows } = await query(
    `SELECT * FROM books ORDER BY list_position NULLS LAST, title ASC LIMIT $1`,
    [Math.min(Number(limit) || 500, 2000)]
  );
  return rows;
}

// What the report may see. Age-bounded when an age is known: §17 asks for books
// matched to the child's age, and sending the whole hundred would cost input
// tokens on ninety books nobody will recommend.
async function approvedBooks({ age = null, limit = 40 } = {}) {
  const params = [Math.min(Number(limit) || 40, 200)];
  let ageClause = '';
  if (Number.isInteger(age)) {
    params.push(age);
    // A book with no stated age range stays eligible — §17 says a missing
    // field must not be guessed at, and excluding it would be a guess that it
    // does not fit.
    ageClause = ` AND (age_min IS NULL OR age_min <= $2) AND (age_max IS NULL OR age_max >= $2)`;
  }
  const { rows } = await query(
    `SELECT title, author, age_min, age_max, genre, reading_level, language, list_position
       FROM books
      WHERE approved = true AND active = true${ageClause}
      ORDER BY list_position NULLS LAST, title ASC
      LIMIT $1`,
    params
  );
  return rows;
}

async function upsertBook(b) {
  const { rows } = await query(
    `INSERT INTO books (title, author, age_min, age_max, genre, reading_level,
                        language, list_position, source, approved, active, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (title, author) DO UPDATE SET
       age_min = EXCLUDED.age_min, age_max = EXCLUDED.age_max,
       genre = EXCLUDED.genre, reading_level = EXCLUDED.reading_level,
       language = EXCLUDED.language, list_position = EXCLUDED.list_position,
       source = EXCLUDED.source, notes = EXCLUDED.notes, updated_at = now()
     RETURNING *`,
    [b.title, b.author || null, b.age_min ?? null, b.age_max ?? null, b.genre || null,
      b.reading_level || null, b.language || null, b.list_position ?? null,
      b.source, b.approved === true, b.active !== false, b.notes || null]
  );
  return rows[0] || null;
}

// A bulk paste of a supplied list. Lands UNAPPROVED whatever the payload says:
// the point of the flag is that a human looked, and an importer claiming its
// own rows are approved would defeat it.
async function importBooks(items, source) {
  let added = 0, updated = 0;
  await withTransaction(async (client) => {
    for (const raw of items) {
      const title = String((raw && raw.title) || '').trim();
      if (!title) continue;
      const res = await client.query(
        `INSERT INTO books (title, author, age_min, age_max, genre, reading_level,
                            language, list_position, source, approved, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10)
         ON CONFLICT (title, author) DO UPDATE SET
           age_min = COALESCE(EXCLUDED.age_min, books.age_min),
           age_max = COALESCE(EXCLUDED.age_max, books.age_max),
           genre = COALESCE(EXCLUDED.genre, books.genre),
           reading_level = COALESCE(EXCLUDED.reading_level, books.reading_level),
           language = COALESCE(EXCLUDED.language, books.language),
           list_position = COALESCE(EXCLUDED.list_position, books.list_position),
           updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [title, (raw.author || '').trim() || null,
          Number.isInteger(raw.age_min) ? raw.age_min : null,
          Number.isInteger(raw.age_max) ? raw.age_max : null,
          (raw.genre || '').trim() || null, (raw.reading_level || '').trim() || null,
          (raw.language || '').trim() || null,
          Number.isInteger(raw.list_position) ? raw.list_position : null,
          source, (raw.notes || '').trim() || null]
      );
      if (res.rows[0] && res.rows[0].inserted) added += 1; else updated += 1;
    }
  });
  return { added, updated };
}

async function setBookApproval(id, approved) {
  const { rows } = await query(
    'UPDATE books SET approved = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, !!approved]);
  return rows[0] || null;
}

async function deleteBook(id) {
  const { rowCount } = await query('DELETE FROM books WHERE id = $1', [id]);
  return rowCount > 0;
}

async function listTutors() {
  const { rows } = await query('SELECT * FROM tutors ORDER BY subject ASC, name ASC NULLS FIRST');
  return rows;
}

async function approvedTutors() {
  const { rows } = await query(
    `SELECT subject, name, age_range, method, goal FROM tutors
      WHERE approved = true AND active = true ORDER BY subject ASC`);
  return rows;
}

async function upsertTutor(t) {
  const { rows } = await query(
    `INSERT INTO tutors (subject, name, age_range, method, goal, source, approved, active, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [t.subject, t.name || null, t.age_range || null, t.method || null, t.goal || null,
      t.source, t.approved === true, t.active !== false, t.notes || null]);
  return rows[0] || null;
}

async function setTutorApproval(id, approved) {
  const { rows } = await query(
    'UPDATE tutors SET approved = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, !!approved]);
  return rows[0] || null;
}

async function deleteTutor(id) {
  const { rowCount } = await query('DELETE FROM tutors WHERE id = $1', [id]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
// The two optional modules (§8 learning preferences, §9 homework environment).
//
// Everything here reads and writes module_answers / module_completions. None of
// it touches `answers`, which is the table getAnswers() above feeds to
// services/scoring.js — that separation is the whole point and is asserted in
// unit/modules.test.js.

async function getModuleQuestions() {
  const { rows } = await query(
    `SELECT module, n, text, kind, options FROM module_questions
      WHERE active = true ORDER BY module ASC, position ASC`
  );
  return rows;
}

// Answers and completion state for one sitting, shaped for the client and for
// the report request.
async function getModuleState(sessionId) {
  const [answers, done] = await Promise.all([
    query(`SELECT module, question_n, value, choice FROM module_answers
            WHERE session_id = $1 ORDER BY module ASC, question_n ASC`, [sessionId]),
    query('SELECT module, completed FROM module_completions WHERE session_id = $1', [sessionId]),
  ]);
  const byModule = {};
  for (const r of answers.rows) {
    (byModule[r.module] = byModule[r.module] || []).push({
      n: r.question_n,
      value: r.value == null ? null : Number(r.value),
      choice: r.choice,
    });
  }
  const completion = {};
  for (const r of done.rows) completion[r.module] = r.completed;
  return { answers: byModule, completion };
}

// Upsert, so a child changing their mind replaces rather than duplicates.
// A null value AND a null choice means "skipped this question", which is a row
// the CHECK constraint refuses — so those are dropped rather than stored, and
// an unanswered question is simply absent.
async function saveModuleAnswers(sessionId, module, items) {
  const rows = (items || []).filter(
    (a) => a && (Number.isInteger(a.value) || (typeof a.choice === 'string' && a.choice)));
  if (!rows.length) return 0;
  return withTransaction(async (client) => {
    let n = 0;
    for (const a of rows) {
      const res = await client.query(
        `INSERT INTO module_answers (session_id, module, question_n, value, choice)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (session_id, module, question_n)
         DO UPDATE SET value = EXCLUDED.value, choice = EXCLUDED.choice
         RETURNING id`,
        [sessionId, module, a.n,
          Number.isInteger(a.value) ? a.value : null,
          Number.isInteger(a.value) ? null : a.choice]
      );
      n += res.rowCount;
    }
    return n;
  });
}

// `completed` false records a deliberate skip, which §23 needs to tell apart
// from "not offered yet": the report must say nothing about a skipped module,
// and the UI must not keep asking.
async function setModuleCompletion(sessionId, module, completed) {
  const { rows } = await query(
    `INSERT INTO module_completions (session_id, module, completed)
     VALUES ($1,$2,$3)
     ON CONFLICT (session_id, module)
     DO UPDATE SET completed = EXCLUDED.completed, finished_at = now()
     RETURNING *`,
    [sessionId, module, !!completed]
  );
  return rows[0] || null;
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
       (session_id, child_id, content_md, sports, clubs, partial, share_token,
        delivered, delivered_at, categories, top_interests, developing_areas, data_completeness,
        payload)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,
        $14::jsonb)
     ON CONFLICT (session_id) DO NOTHING
     RETURNING *`,
    [
      r.sessionId, r.childId, r.contentMd,
      JSON.stringify(r.sports || []), JSON.stringify(r.clubs || []),
      r.partial, r.shareToken,
      !!r.delivered, r.delivered ? new Date() : null,
      JSON.stringify(r.categories || null), JSON.stringify(r.topInterests || []),
      JSON.stringify(r.developingAreas || []), r.dataCompleteness || null,
      // null, not '{}': a report written before the v2 block existed never had
      // these sections, and an empty object would read as "the model considered
      // them and had nothing to say".
      r.payload ? JSON.stringify(r.payload) : null,
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

  // The last two stages are not events. A payment is confirmed by Payme
  // calling us, with no browser present to send a beacon; an enrolment is an
  // admin pressing a button in the panel, possibly weeks later. Both are
  // therefore joined through parent_id, and both are windowed on when the
  // VISITOR came (not on when the money or the admin arrived) so the rows line
  // up with the stages above them instead of drifting out of the window.
  const outcome = async (key, where) => {
    const { rows } = await query(
      `SELECT count(DISTINCT e.visitor_id)::int AS n
         FROM analytics_events e
         JOIN parents p ON p.id = e.parent_id
        WHERE ${where}
          AND e.created_at >= now() - ($1 || ' days')::interval`,
      [days]
    );
    out[key] = Number((rows[0] || {}).n || 0);
  };
  // Paid: the parent bought at least one report. Matched at parent level, the
  // same way enrolment is, so a parent who paid on a second device still
  // counts — the funnel is asking "did this person convert", not "which tab".
  await outcome('paid', `EXISTS (SELECT 1 FROM orders o WHERE o.parent_id = p.id AND o.state = 'paid')`);
  await outcome('enrolled', `p.lead_status = 'enrolled'`);
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

// ---- orders & payments --------------------------------------------------

// Created alongside the report, before anyone tries to pay, so a provider
// callback always has an order to attach to. Idempotent: regenerating or
// re-requesting a report must not open a second order for it.
async function createOrder({ reportId, parentId, amount, currency = 'UZS' }) {
  const { rows } = await query(
    `INSERT INTO orders (report_id, parent_id, amount, currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (report_id) DO NOTHING
     RETURNING *`,
    [reportId, parentId, amount, currency]
  );
  if (rows[0]) return rows[0];
  return (await query('SELECT * FROM orders WHERE report_id = $1', [reportId])).rows[0] || null;
}

async function getOrder(id) {
  const { rows } = await query('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getOrderByReport(reportId) {
  const { rows } = await query('SELECT * FROM orders WHERE report_id = $1', [reportId]);
  return rows[0] || null;
}

// The paywall's only question, asked on every report read.
async function isReportPaid(reportId) {
  const { rows } = await query(
    `SELECT 1 FROM orders WHERE report_id = $1 AND state = 'paid' LIMIT 1`,
    [reportId]
  );
  return rows.length > 0;
}

// Everything needed to hand a just-paid report to its buyer, in one query:
// the report itself, the child's name for the file, and the chat to send it
// to. The parent is taken from the order when it has one and from the child
// otherwise, since an order created on demand for an old report may not.
async function getPaidReportTarget(orderId) {
  const { rows } = await query(
    `SELECT r.*, c.nickname, c.grade, p.telegram_chat_id
       FROM orders o
       JOIN reports r  ON r.id = o.report_id
       JOIN children c ON c.id = r.child_id
       LEFT JOIN parents p ON p.id = COALESCE(o.parent_id, c.parent_id)
      WHERE o.id = $1`,
    [orderId]
  );
  return rows[0] || null;
}

async function markOrderPaid(orderId) {
  const { rows } = await query(
    `UPDATE orders SET state = 'paid', paid_at = now()
      WHERE id = $1 AND state <> 'paid' RETURNING *`,
    [orderId]
  );
  // Already paid: return the row rather than null, since a provider retrying
  // PerformTransaction is a success, not a conflict.
  if (rows[0]) return rows[0];
  return getOrder(orderId);
}

async function markOrderCancelled(orderId) {
  const { rows } = await query(
    `UPDATE orders SET state = 'cancelled' WHERE id = $1 RETURNING *`,
    [orderId]
  );
  return rows[0] || null;
}

// ---- provider transactions (Payme's shapes) -----------------------------

async function getPaymentByTxn(provider, txnId) {
  const { rows } = await query(
    'SELECT * FROM payments WHERE provider = $1 AND provider_txn_id = $2',
    [provider, txnId]
  );
  return rows[0] || null;
}

// Idempotent by (provider, provider_txn_id): Payme retries CreateTransaction
// and must get the same transaction back, not a second one.
async function createPayment({ orderId, provider = 'payme', txnId, providerTime, amount, createTime }) {
  const { rows } = await query(
    `INSERT INTO payments (order_id, provider, provider_txn_id, provider_time, amount, state, create_time)
     VALUES ($1,$2,$3,$4,$5,1,$6)
     ON CONFLICT (provider, provider_txn_id) DO NOTHING
     RETURNING *`,
    [orderId, provider, txnId, providerTime || null, amount, createTime]
  );
  if (rows[0]) return rows[0];
  return getPaymentByTxn(provider, txnId);
}

async function performPayment(paymentId, performTime) {
  const { rows } = await query(
    `UPDATE payments SET state = 2, perform_time = $2 WHERE id = $1 RETURNING *`,
    [paymentId, performTime]
  );
  return rows[0] || null;
}

async function cancelPayment(paymentId, { state, reason, cancelTime }) {
  const { rows } = await query(
    `UPDATE payments SET state = $2, reason = $3, cancel_time = $4 WHERE id = $1 RETURNING *`,
    [paymentId, state, reason, cancelTime]
  );
  return rows[0] || null;
}

// An order may only ever hold one live (created or performed) transaction.
// Without this a second provider transaction could be opened against an order
// that is already being paid.
async function activePaymentForOrder(orderId) {
  const { rows } = await query(
    'SELECT * FROM payments WHERE order_id = $1 AND state IN (1, 2) LIMIT 1',
    [orderId]
  );
  return rows[0] || null;
}

// Payme's GetStatement: every transaction whose create_time falls in the range.
async function paymentsBetween(fromMs, toMs) {
  const { rows } = await query(
    'SELECT * FROM payments WHERE create_time >= $1 AND create_time <= $2 ORDER BY create_time',
    [fromMs, toMs]
  );
  return rows;
}

// ---- reminders -----------------------------------------------------------
//
// Three queries, one per situation, each returning only parents who can and
// should be messaged. The shared conditions are deliberately repeated in every
// query rather than layered on afterwards: this is a job that sends real
// messages to real people, and "who is eligible" should be readable in one
// place per case rather than assembled from three.
//
// Common to all of them:
//   - the parent has a Telegram chat (nothing else can be messaged)
//   - they have not opted out
//   - the moment is recent enough to still be worth mentioning (giveUpDays)
//   - we have not already sent this exact reminder
//   - they are under the weekly cap

const REMINDER_ELIGIBLE = `
      p.telegram_chat_id IS NOT NULL
  AND p.reminders_opted_out = FALSE
  AND (SELECT count(*) FROM reminders_sent rs
        WHERE rs.parent_id = p.id AND rs.sent_at >= now() - interval '7 days') < $3`;

// Started an assessment and stopped partway: no report, quiet for a while.
async function remindersAbandoned({ afterHours, giveUpDays, weeklyCap, limit }) {
  const { rows } = await query(
    `SELECT p.id AS parent_id, p.telegram_chat_id, p.name,
            s.id AS session_id, s.session_token, c.nickname
       FROM sessions s
       JOIN children c ON c.id = s.child_id
       JOIN parents  p ON p.id = c.parent_id
      WHERE s.status <> 'finished'
        AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.session_id = s.id)
        AND s.started_at <= now() - ($1 || ' hours')::interval
        AND s.started_at >= now() - ($2 || ' days')::interval
        AND NOT EXISTS (
              SELECT 1 FROM reminders_sent rs
               WHERE rs.parent_id = p.id AND rs.kind = 'abandoned' AND rs.session_id = s.id)
        AND ${REMINDER_ELIGIBLE}
      ORDER BY s.started_at
      LIMIT $4`,
    [afterHours, giveUpDays, weeklyCap, limit]
  );
  return rows;
}

// Finished the assessment, has a report, never paid for it.
async function remindersUnpaid({ afterHours, giveUpDays, weeklyCap, limit }) {
  const { rows } = await query(
    `SELECT p.id AS parent_id, p.telegram_chat_id, p.name,
            s.id AS session_id, c.nickname, r.share_token, o.amount
       FROM orders o
       JOIN reports  r ON r.id = o.report_id
       JOIN sessions s ON s.id = r.session_id
       JOIN children c ON c.id = r.child_id
       JOIN parents  p ON p.id = c.parent_id
      WHERE o.state = 'pending'
        AND r.created_at <= now() - ($1 || ' hours')::interval
        AND r.created_at >= now() - ($2 || ' days')::interval
        AND NOT EXISTS (
              SELECT 1 FROM reminders_sent rs
               WHERE rs.parent_id = p.id AND rs.kind = 'unpaid' AND rs.session_id = s.id)
        AND ${REMINDER_ELIGIBLE}
      ORDER BY r.created_at
      LIMIT $4`,
    [afterHours, giveUpDays, weeklyCap, limit]
  );
  return rows;
}

// Logged in through the bot and then never ran an assessment at all.
async function remindersNeverStarted({ afterHours, giveUpDays, weeklyCap, limit }) {
  const { rows } = await query(
    `SELECT p.id AS parent_id, p.telegram_chat_id, p.name
       FROM parents p
      WHERE p.telegram_linked_at <= now() - ($1 || ' hours')::interval
        AND p.telegram_linked_at >= now() - ($2 || ' days')::interval
        AND NOT EXISTS (
              SELECT 1 FROM children ch
               JOIN sessions s ON s.child_id = ch.id
              WHERE ch.parent_id = p.id)
        AND NOT EXISTS (
              SELECT 1 FROM reminders_sent rs
               WHERE rs.parent_id = p.id AND rs.kind = 'never_started')
        AND ${REMINDER_ELIGIBLE}
      ORDER BY p.telegram_linked_at
      LIMIT $4`,
    [afterHours, giveUpDays, weeklyCap, limit]
  );
  return rows;
}

// Claim a reminder BEFORE sending it. The unique index means a concurrent or
// repeated run loses the race and gets null back, so the message is not sent
// twice — a reminder that was recorded but failed to send is a far better
// outcome than one delivered twice.
async function claimReminder({ parentId, kind, sessionId = null }) {
  const { rows } = await query(
    `INSERT INTO reminders_sent (parent_id, kind, session_id)
     VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [parentId, kind, sessionId]
  );
  return rows[0] || null;
}

// Undo a claim when the send itself failed, so the next run may try again.
async function releaseReminder(id) {
  await query('DELETE FROM reminders_sent WHERE id = $1', [id]);
}

async function optOutReminders(chatId) {
  const { rows } = await query(
    'UPDATE parents SET reminders_opted_out = TRUE WHERE telegram_chat_id = $1 RETURNING id',
    [chatId]
  );
  return rows.length > 0;
}

module.exports = {
  saveAnswers, getAnswers, getAnswerRows,
  getModuleQuestions, getModuleState, saveModuleAnswers, setModuleCompletion,
  listBooks, approvedBooks, upsertBook, importBooks, setBookApproval, deleteBook,
  listTutors, approvedTutors, upsertTutor, setTutorApproval, deleteTutor,
  createChildAndSession, getSessionById, getSessionByToken, getChildById,
  addMessage, getMessages, applyTurn, setSessionStatus,
  upsertParent, linkChildToParent, updateParentContact,
  getReportBySession, createReport, getReportByShareToken, markReportDelivered,
  getPaidReportTarget,
  getAdminByEmail, listLeads, getParent, getLeadChildren, updateLead, deleteParent, weeklyBuckets, tokenTotals,
  upsertParentByTelegram, setParentPhone, applyAuthConsent,
  createAuthRequest, getAuthRequest, bindAuthRequest, completeAuthRequest, consumeAuthRequest,
  getParentByChatId, getPendingAuthRequestForParent,
  getParentByToken, revokeParentToken,
  recordEvent, funnelCounts, funnelBySource,
  createOrder, getOrder, getOrderByReport, isReportPaid, markOrderPaid, markOrderCancelled,
  getPaymentByTxn, createPayment, performPayment, cancelPayment, activePaymentForOrder, paymentsBetween,
  remindersAbandoned, remindersUnpaid, remindersNeverStarted,
  claimReminder, releaseReminder, optOutReminders,
};
