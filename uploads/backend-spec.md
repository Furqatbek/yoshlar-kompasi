# Backend specification — Yosh Iste'dodlar Kompasi

## 1. The backend's four jobs

1. **Claude proxy.** Hold the API key, attach the system prompt (instructions + question bank), forward conversations to the Claude API, return replies. The key never leaves the server.
2. **Persistence.** Store sessions, messages, and reports so a session survives refreshes and device changes, and so a child's history accumulates across months.
3. **Lead capture.** Attach a parent's contact to a completed session, record consent properly, and deliver the report to their phone — the delivery is the value exchange that makes giving a phone number feel fair.
4. **Admin.** Give the school/centre staff a panel: leads with their reports, statuses, notes, export, and basic funnel metrics.

## 2. API endpoints

All parent-facing endpoints are authenticated by an unguessable session token issued at session creation (stored in the browser; also embedded in resume links). Admin endpoints require login.

| Method | Path | Purpose |
|---|---|---|
| POST | /api/sessions | Create session from setup form `{nickname, grade, age?, goal?, notes?}` → creates child + session, calls Claude for the greeting + first batch → `{session_id, session_token, messages}` |
| POST | /api/sessions/:id/messages | Adult's message `{content}` → append, call Claude with full history, store reply → `{reply}` |
| GET | /api/sessions/:id | Resume: full state `{child, messages, status}` (token required) |
| POST | /api/sessions/:id/contact | The report gate: `{parent_name, phone, email?, marketing_consent}` → create or find parent by phone, link child to parent, record consent text version + timestamp |
| POST | /api/sessions/:id/report | Generate report (final Claude call), parse structured block, store, mark session finished, trigger SMS/Telegram delivery → `{report_url}` |
| GET | /api/reports/:share_token | Public report page data (unguessable token, no login) |
| POST | /admin/login | Admin auth (rate-limited, password hashed with bcrypt/argon2) |
| GET | /admin/leads | List: filter by status, date, grade; each row = parent, children count, sessions, last report |
| GET | /admin/leads/:id | Parent + children + all sessions + report links + notes |
| PATCH | /admin/leads/:id | Update `{lead_status, admin_notes}` |
| GET | /admin/stats | Funnel: sessions started / finished / contacts left / reports delivered, by week |
| GET | /admin/export/leads.csv | CSV export for the sales side |

## 3. Database schema

PostgreSQL recommended (any relational DB works). UUIDs for all public-facing ids.

**parents** — id, name, phone (unique, normalized E.164), email (nullable), marketing_consent (bool), consent_text_version, consented_at, lead_status (enum: new / contacted / interested / enrolled / closed), admin_notes (text), created_at.

**children** — id, parent_id (nullable FK — a session starts before the contact gate, so the child exists first and gets linked to a parent at the gate), nickname, grade (1–4), age (nullable), goal (nullable), notes (nullable), created_at. Never store surname, address, school number, or photos — the system prompt already forbids asking for them; the schema should make storing them impossible.

**sessions** — id, child_id (FK), session_token (unique, random 32+ bytes), status (enum: active / paused / finished / abandoned), prompt_version, model, turn_count, input_tokens, output_tokens, started_at, finished_at.

**messages** — id, session_id (FK), role (user / assistant), content (text), created_at. A separate table (rather than a JSON blob on the session) keeps analytics and debugging easy; cap content at ~2,000 characters at the API layer.

**reports** — id, session_id (FK), child_id (FK), content_md (text), level_logic, level_psych, level_activity (each enum: shakllanmoqda / meyorda / kuchli, nullable), sports (jsonb array), partial (bool — early finish), share_token (unique), created_at.

**admins** — id, email, password_hash, role, created_at.

The child history feature falls out of this schema for free: `children → sessions → reports` ordered by date is the progress timeline, and a repeat assessment after 3–6 months is just a new session on an existing child.

## 4. Claude integration

**System prompt assembly.** At startup (or per request), concatenate `loyiha-korsatmalari-uz.md` + `savollar-banki-1-4-sinflar-uz.md` into one system string. Keep both files versioned in your repo; stamp `prompt_version` on every session so old reports remain explainable after prompt edits. Two lines must be added to the instructions file for the product to work end-to-end: the blockquote rule from the frontend spec ("Bolaga o'qib beriladigan matnni blockquote (>) qilib yozing"), and the structured-report rule below.

**Conversation calls.** `POST https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, body `{model, max_tokens: 1500, system, messages}` where `messages` is the full stored history plus the new turn. Timeout ~60 s; on failure return a retryable error to the frontend without losing the user's message (store it first, call Claude second).

**Report call.** When the frontend requests the report, append a fixed user turn: "Mashg'ulot yakunlandi. To'liq hisobotni tayyorlang." with `max_tokens: 3000`. Add this rule to the system prompt: after the report, output one fenced ```json block: `{"levels": {"mantiq": "...", "psixologiya": "...", "harakat": "..."}, "sports": ["...", "..."]}` using only the values shakllanmoqda / meyorda / kuchli. The backend parses that block into the structured columns and strips it from `content_md` before storing. This is what lets the admin panel filter leads by level and sport without re-reading reports.

**Model.** Start with `claude-sonnet-4-6`; if volume makes cost matter, A/B test `claude-haiku-4-5-20251001` on Uzbek quality. Log input/output tokens per call onto the session — the token columns are your cost dashboard.

**Caps.** Max 60 turns per session (the assessment needs ~25–35), max 2,000 characters per user message, one report generation per session. When a cap is hit, the API returns a "please finish and generate the report" response.

## 5. Lead capture logic

The gate sits between the last question and the report: the frontend calls `/contact` first, then `/report`. Deduplicate parents by normalized phone — a second child from the same parent attaches to the existing parent record, which is exactly what a school wants to see ("this family has two kids assessed"). Record consent as data, not a boolean alone: which consent text version they saw, and when. Marketing consent is its own optional checkbox, never bundled with the assessment consent, and its absence must not block report delivery.

**Report delivery.** Send the report link (`/hisobot/:share_token`) by SMS via a local gateway (e.g., Eskiz) or — often better in Uzbekistan — a Telegram bot: the parent taps a deep link, the bot sends the report and becomes a re-engagement channel for the centre ("3 oy o'tdi — qayta baholab ko'ramizmi?"). Phase 1 can ship with SMS only.

## 6. Security and abuse

The dangerous scenario specific to this product: your `/messages` endpoint is, functionally, free Claude access, and someone will eventually try to use it that way. Mitigations, cheapest first: the system prompt keeps the model on-task (add an explicit "politely decline off-topic requests" line if abuse appears); the 60-turn and 2,000-character caps bound the damage; rate-limit ~20 requests/min per session and ~5 new sessions/day per IP; if abuse persists, require SMS OTP verification of the parent's phone at session start instead of at the gate. Log token spend per session and alert on outliers.

Standard hygiene: API key and DB credentials in environment variables; HTTPS everywhere; session tokens long and random; parameterized queries; admin panel behind login with hashed passwords and its own rate limit; no children's data in application logs (log ids, not nicknames or answers).

## 7. Children's data and compliance

Design principle: sensitive data stays in your database; the AI only ever sees the nickname, grade, age, and answers — never the parent's name or phone. Do not include parent contact fields in anything sent to the Claude API.

Retention and rights: define a retention period (for example, delete sessions and reports 12–24 months after last activity), provide a deletion path (a parent asks, an admin deletes the parent record cascade), and state all of it on the privacy page. Uzbekistan's personal data law includes consent requirements and a data-localization rule — plan to host the database with an in-country provider, and have a local specialist review your consent texts and the fact that AI processing happens on foreign servers. Minimizing what crosses the border (nicknames and answers only) is your strongest practical position.

## 8. Operations

Nightly DB backups; a staging environment with a separate Claude API key; structured logs keyed by session id; a config flag for prompt_version rollout; monitoring on three numbers — sessions finished per day, average tokens per session, and report delivery success rate. When those three are healthy, the product is healthy.
