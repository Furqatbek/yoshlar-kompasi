# Yosh Iste'dodlar Kompasi

An AI-assisted strengths assessment for primary-school children (grades 1–4) in
Uzbek. An adult (parent or teacher) reads questions aloud, records the child's
answers, and Claude produces a personalized report: a strengths profile, a
"where they are now" read across three tracks, a Gardner multiple-intelligences
map, a RIASEC interests compass, growth-mindset and self-regulation
observations, a 3–6 month roadmap, study tips and sport recommendations. The
centre gets a lead panel with reports, statuses, notes, a weekly funnel and an
LLM cost estimate.

This repository contains both halves of the product:

- **Frontend** — a single-file app (`Kompas.dc.html`) built on the `x-dc`
  runtime (`support.js`) and the *Modernist* design system (`_ds/`). It is a
  hash-routed SPA that talks to the backend over `/api` and `/admin`.
- **Backend** (`server/`) — Node + Express + PostgreSQL. It is the Claude proxy
  (holds the API key), the system of record (sessions, messages, reports,
  leads), the lead/consent gate, report delivery, and the admin API.

Built to the `uploads/backend-spec.md` specification.

---

## Architecture

```
Browser (Kompas.dc.html + support.js + _ds)
   │  fetch /api/* (session token)   fetch /admin/* (httpOnly cookie)
   ▼
Express (server/)
   ├─ routes/auth      Telegram login: nonce · poll · me · logout
   ├─ routes/sessions  create · messages · resume · contact · report
   ├─ routes/reports   public report by share_token
   ├─ routes/track     anonymous funnel beacons (landing, setup, …)
   ├─ routes/admin     login · leads · lead · stats · funnel · CSV
   ├─ routes/telegram  bot webhook: login deep-link · contact · delivery
   ├─ services/claude  → Anthropic OR OpenRouter (LLM_PROVIDER; key server-side,
   │                     system prompt sent as a cached breakpoint)
   ├─ services/prompt  system prompt = uploads/*.md + protocol + json rule
   └─ db (pg)          parents · children · sessions · messages · reports ·
                       admins · auth_requests · parent_tokens · analytics_events
   ▼
PostgreSQL
```

In production (`prod` compose profile) nginx terminates TLS in front of the app,
a certbot sidecar renews certificates, and a `cron` container runs nightly
backups, the monthly retention purge and a daily LLM-credit check.

The API key never reaches the browser. The model only ever sees the child's
nickname, grade, age and the session messages — never a parent's name or phone,
and never the form's goal/notes fields (those stay in the database).

---

## Quick start (Docker)

> **Step-by-step guide with verification and troubleshooting:**
> [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — covers local, production
> (nginx + TLS), updates, domain changes and the deploy checklist.

Prerequisites: Docker + Docker Compose, and an LLM key — either an Anthropic API
key (default) or an [OpenRouter](https://openrouter.ai) key (see below).

```bash
cp .env.example .env
# edit .env — set at least:
#   ANTHROPIC_API_KEY (or LLM_PROVIDER=openrouter + OPENROUTER_API_KEY),
#   JWT_SECRET (openssl rand -base64 48),
#   ADMIN_EMAIL, ADMIN_PASSWORD, POSTGRES_PASSWORD
#   PUBLIC_BASE_URL (your https origin, for report links)

make up          # builds the image, starts postgres + app, runs migrations + seed
make logs        # follow logs
```

Open http://localhost:8080. The admin panel is at `/#/admin` (log in with
`ADMIN_EMAIL` / `ADMIN_PASSWORD`).

Stop with `make down`. Data persists in the `db_data` volume.

> For local http testing set `COOKIE_SECURE=false` in `.env`, otherwise the
> admin login cookie won't be stored over plain http.

### Production deployment (nginx + TLS, one server)

DNS first: point an A-record for your domain at the server. Then:

```bash
# 1. One-time certificate (port 80 must be free; stack down is fine)
make cert DOMAIN=kompas.example.uz EMAIL=you@example.com

# 2. In .env set:
#    DOMAIN=kompas.example.uz
#    PUBLIC_BASE_URL=https://kompas.example.uz
#    (plus the usual secrets)

# 3. Bring up the full stack (app + db + nginx + certbot + cron)
make prod-up
make prod-logs
```

What you get:

- **nginx** terminates HTTPS on 80/443 (HTTP redirects to HTTPS), proxies to
  the app with a 300s read timeout (report generation), gzips static assets.
  The app container itself binds to 127.0.0.1 only — never directly reachable.
- **Automatic certificate renewal**: a certbot sidecar renews via webroot every
  12h; nginx reloads itself every 6h to pick up renewed certs. No cron needed.
- **In-stack cron** (also runs with plain `make up`): nightly DB backup to
  `./backups` (pruned after `BACKUP_KEEP_DAYS`, default 14), monthly retention
  purge, daily OpenRouter credit check (`BILLING_ALERT_MIN_USD`). Watch it with
  `docker compose logs cron`.

To change the domain later: update `DOMAIN` + `PUBLIC_BASE_URL` in `.env`, run
`make cert` for the new name, `make prod-up`.

**Prefer raw `docker compose` (no make)?** Add `COMPOSE_PROFILES=prod` to
`.env` — then plain `docker compose up -d --build` includes nginx + certbot:

```bash
# one-time certificate (port 80 free; run before the first start)
docker compose run --rm -p 80:80 --entrypoint certbot certbot \
  certonly --standalone -d kompas.example.uz -m you@example.com --agree-tos --no-eff-email

docker compose up -d --build          # start/update everything
docker compose logs -f app nginx cron # watch app + proxy + scheduled jobs
docker compose exec cron sh /app/server/scripts/backup.sh   # manual backup now
gunzip -c backups/yik-XXXX.sql.gz | docker compose exec -T db psql -U yik yik  # restore
```

### Using a managed / in-country Postgres instead

Set `DATABASE_URL` in `.env` (add `?sslmode=require` if needed) and remove the
`db` service and `depends_on` from `docker-compose.yml`.

### Using OpenRouter instead of Anthropic direct

If you can't fund the Anthropic API Console directly (some regions/cards are
rejected there — note this is separate from your Claude chat subscription), you
can route the same conversation through [OpenRouter](https://openrouter.ai):

```bash
# in .env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...              # from https://openrouter.ai/keys
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6   # any slug from /models
```

Add credits to your OpenRouter account, then `make up` (or `make restart`). The
app is provider-agnostic — prompts, report parsing, caps and privacy guarantees
are identical; only the HTTP endpoint changes. The prompt is tuned for Claude,
so an `anthropic/*` slug tracks the direct behaviour most closely, but any
OpenRouter model works. Only `ANTHROPIC_API_KEY` **or** `OPENROUTER_API_KEY` is
required — whichever matches `LLM_PROVIDER`.

> **Slug format matters.** OpenRouter uses namespaced `vendor/model` slugs with
> **dot** versions (`anthropic/claude-sonnet-4.6`). The bare Anthropic id
> `claude-sonnet-4-6` is **not** a valid OpenRouter model and is rejected with
> *"… is not a valid model id"*. Sessions created before switching providers are
> handled automatically — the server ignores a stored model id that doesn't
> belong to the active provider and falls back to `OPENROUTER_MODEL`.

---

## Local development (no Docker)

Requires Node 20+ and a reachable PostgreSQL.

```bash
cd server
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/yik
export ANTHROPIC_API_KEY=sk-ant-...
export JWT_SECRET=$(openssl rand -base64 48)
export ADMIN_EMAIL=admin@markaz.uz ADMIN_PASSWORD=secret COOKIE_SECURE=false
npm run migrate
npm run seed
npm run build:web    # assembles server/public from the frontend
npm run dev          # http://localhost:8080
```

`build:web` copies `Kompas.dc.html`, `support.js`, `_ds/` and the vendored React
into `server/public/`, preloading React so nothing is fetched from a CDN at
runtime.

---

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `LLM_PROVIDER` | no | `anthropic` (default) or `openrouter` |
| `ANTHROPIC_API_KEY` | if anthropic | Claude API key (server-side only) |
| `ANTHROPIC_MODEL` | no | Default `claude-sonnet-4-6`; override per account |
| `OPENROUTER_API_KEY` | if openrouter | OpenRouter key (server-side only) |
| `OPENROUTER_MODEL` | no | Default `anthropic/claude-sonnet-4.6`; any `vendor/model` [slug](https://openrouter.ai/models) |
| `JWT_SECRET` | yes | Signs the admin session cookie (≥16 chars) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | yes | Seeded admin account (bcrypt-hashed) |
| `PUBLIC_BASE_URL` | prod | Origin used to build report links for delivery |
| `COOKIE_SECURE` | no | `true` in prod; `false` for local http |
| `DELIVERY_PROVIDER` | no | `console` (default) or `telegram`. With Telegram login on (below) every parent has already started the bot, so the deep-link limitation no longer applies |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | if telegram or auth | Bot credentials |
| `TELEGRAM_WEBHOOK_SECRET` | no | Verifies webhook calls |
| `AUTH_REQUIRED` | no | `true` (default) — an assessment cannot start until the adult logs in through the bot. `false` reverts to the old anonymous flow |
| `AUTH_REQUIRE_PHONE` | no | `true` (default) — the bot asks for the phone with a Share-contact button; the number arrives Telegram-verified |
| `AUTH_NONCE_TTL_MINUTES` / `AUTH_TOKEN_TTL_DAYS` | no | Login-link and browser-login lifetimes (15 / 90) |
| `CONSENT_TEXT_VERSION` | no | Stamped on each recorded consent |
| `MAX_TURNS` / `MAX_MESSAGE_CHARS` | no | Abuse caps (60 / 2000) |
| `MIN_ANSWERS_FOR_REPORT` | no | Real answers required before a report (default 1, floored at 1) |
| `RL_MESSAGES_PER_MIN` / `RL_SESSIONS_PER_DAY` / `RL_ADMIN_LOGIN_PER_MIN` | no | Rate limits |
| `CONVERSATION_MAX_TOKENS` / `REPORT_MAX_TOKENS` | no | Generation budgets (1500 / 4500) |
| `REPORT_TIMEOUT_MS` | no | Report LLM-call timeout (180000; any extra proxy must allow ≥ this) |
| `PRICE_INPUT_PER_MTOK` / `PRICE_OUTPUT_PER_MTOK` | no | $/1M tokens for the admin cost estimate (3 / 15) |
| `BILLING_ALERT_MIN_USD` | no | Daily credit-check alert threshold (5) |
| `RETENTION_MONTHS` | no | Data retention window for the monthly purge (24) |
| `ANALYTICS_RETENTION_DAYS` | no | Funnel-event retention, pruned by the same purge job (180) |
| `DOMAIN` / `LETSENCRYPT_DIR` | prod profile | nginx TLS domain + certificate dir (`./letsencrypt`) |
| `BACKUP_KEEP_DAYS` | no | Local backup retention (14) |

---

## API

Login (Telegram; see [Parent authorization](#parent-authorization)):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/telegram/start` | Issue a single-use nonce + `t.me/…?start=auth_<nonce>` deep link |
| GET | `/api/auth/telegram/status?nonce=` | Poll: `pending` → `awaiting_phone` → `authorized` (+ `parent_token`) / `expired` |
| GET | `/api/auth/me` | Resolve an `x-parent-token` to the parent |
| POST | `/api/auth/logout` | Revoke that browser token (the Telegram link stays) |

Parent-facing — the unguessable 256-bit session token IS the credential and the
`:token` path segment (no header; the session URL `/mashgulot/:token` resumes
from any device):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/sessions` | Create child + session (needs `x-parent-token` when `AUTH_REQUIRED`, and `consent: true`), greeting + first questions |
| POST | `/api/sessions/:token/messages` | Adult's turn (`{content}` or `{retry:true}`) |
| GET | `/api/sessions/:token` | Resume: full state |
| POST | `/api/sessions/:token/contact` | Contact gate (parent name, optional phone + consents) |
| POST | `/api/sessions/:token/report` | Generate, parse, store (refused with `insufficient_engagement` until the child has actually answered) |
| GET | `/api/reports/:share_token` | Public report data (no login) |
| POST | `/api/track` | Anonymous funnel beacon (`{visitor_id, stage}`); always 204, client-observable stages only |

Admin (httpOnly JWT cookie):

`POST /admin/login` · `POST /admin/logout` · `GET /admin/me` ·
`GET /admin/leads` · `GET /admin/leads/:id` · `PATCH /admin/leads/:id` ·
`DELETE /admin/leads/:id` (right-to-erasure, cascades) ·
`GET /admin/stats` · `GET /admin/funnel?days=7|30|90` ·
`GET /admin/export/leads.csv`

Health: `GET /healthz`, `GET /readyz` (checks the DB).

Clean links `/(hisobot|mashgulot)/:token` 302-redirect into the hash-routed SPA.

---

## Parent authorization

With `AUTH_REQUIRED=true` (the default) an assessment cannot begin until the
adult has logged in through the Telegram bot. This is deliberate: a phone number
typed into a form is a number you may call, but a **started bot chat is standing
permission to message** — which is what makes the report, reminders and the
centre's announcements deliverable at all.

```
Browser                       Server                      Telegram
  │ POST /api/auth/telegram/start
  │──────────────────────────▶│ nonce + t.me/bot?start=auth_<nonce>
  │◀──────────────────────────│
  │ shows "Telegramni ochish", polls status every 2s
  │                            │      /start auth_<nonce>
  │                            │◀───────────────────────────│  adult presses Start
  │                            │ upsert parent by chat id,
  │                            │ bind nonce → awaiting_phone
  │                            │ ─ asks for the phone with a
  │                            │   [Share contact] keyboard ▶│
  │                            │◀───────────────────────────│  adult taps it
  │ status: authorized + parent_token   (phone arrives VERIFIED by Telegram)
  │◀──────────────────────────│
  │ stores the token in localStorage; the child form unlocks
```

The nonce is single-use and expires after `AUTH_NONCE_TTL_MINUTES`; the browser
token lives for `AUTH_TOKEN_TTL_DAYS` and can be revoked with
`POST /api/auth/logout`. One Telegram account is one `parents` row
(`telegram_chat_id` is uniquely indexed), so a returning adult skips the phone
step entirely and their existing marketing consent is preserved. Set
`AUTH_REQUIRE_PHONE=false` to finish the login on `/start` alone.

Setup: create a bot with @BotFather, set `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_BOT_USERNAME`, and register the webhook once:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=$PUBLIC_BASE_URL/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

In production the app refuses to boot if authorization is on and the bot is not
configured — better a loud failure at startup than a login screen nobody can get
past. For local work without a bot, `AUTH_REQUIRED=false` restores the anonymous
flow.

---

## Funnel analytics

Admin panel → **Statistika** → "Qayerda yo'qotyapmiz?" answers one question: of
everyone who opened the site, where do they stop before enrolling?

The other tables can only see people who got far enough to create a session, so
the largest losses — someone reading the landing page and closing the tab, or
starting the Telegram login and never finishing it — were invisible. These ten
stages close that gap:

| # | Stage | Recorded by |
|---|---|---|
| 1 | Opened the site | browser |
| 2 | Opened the setup screen | browser |
| 3 | Pressed the Telegram login button | browser |
| 4 | Finished the Telegram login | server |
| 5 | Filled in the child's details | browser |
| 6 | Started the assessment | server |
| 7 | Child gave a first answer | server |
| 8 | Report produced | server |
| 9 | Opened the report | browser |
| 10 | Enrolled | `parents.lead_status` |

**The split matters.** A browser can only POST the stages it alone can witness
(`/api/track`, rate-limited, nothing else accepted). Every stage that proves
real progress is written by the server from the request that did it, so the
numbers the centre plans around cannot be inflated by a client claiming to have
finished a report.

**Counting.** The funnel counts *distinct visitors* per stage, not events, so
reloads and double-fired beacons cannot skew it. Two figures are called out: the
step that loses the **most people** (nearly always near the top, because that is
where the people are) and the step that loses the **largest share** of those who
reach it — the second is usually the one with something fixable in it. The sale
itself is excluded from that second figure, since far fewer people enrol than
read a report and it would otherwise win every time; it keeps its own row and
the enrolment rate is a headline number.

**Privacy.** A visitor id is a random UUID the browser generates for itself and
keeps in `localStorage`. It is not derived from an IP, a fingerprint or anything
anyone typed, it never leaves this origin, and no third-party analytics service
is involved. No IP address, user agent or child data is stored. `Do Not Track`
disables the whole thing, id included. Deleting a lead cascades to their events,
and the retention job prunes the rest after `ANALYTICS_RETENTION_DAYS`. The
privacy page (`/#/maxfiylik`) discloses this in Uzbek.

`utm_source` (or the referring host) is kept as a first-touch label so the
"Qayerdan kelishgan" table can show which channels convert.

---

## Report delivery

**The primary delivery IS the app**: when the assessment finishes, the report
opens on screen, is stored server-side, and the parent can save it as PDF or
copy the share link.

With Telegram login on, delivery is also reliable: every parent reached the
assessment through the bot, so `DELIVERY_PROVIDER=telegram` pushes the report
straight to their chat by `telegram_chat_id` — no deep-link dance, no
prior-subscription problem. (That problem is why login exists: before it, a
bot deep-link silently did nothing for anyone who had not already started the
bot.) The report screen still offers **Telegram orqali olish** for parents from
the older anonymous flow, and the admin panel keeps a report link per lead for
manual follow-up.

SMS (Eskiz.uz) can be added later behind the same `services/delivery`
interface.

---

## Security & compliance

- API key and DB credentials are environment variables; never in the client.
- Session tokens are 256-bit; report share tokens 144-bit. Admin passwords are
  bcrypt-hashed; the admin panel is cookie-gated and login is rate-limited.
- Abuse controls on the "free Claude" surface: 60-turn / 2000-char caps,
  ~20 messages/min per session, ~5 new sessions/day per IP, and an "off-topic →
  decline" instruction in the system prompt.
- **Children's data minimization** — the schema has no column for surname,
  address, school number or photo. Only the child's nickname, grade, age and
  the session messages are sent to the LLM provider (Anthropic direct or via
  OpenRouter); parent contact fields and the form's goal/notes fields never
  leave the server.
- **Server-side gates** — creating a session requires the adult assertion
  (`consent: true`, HTTP 400 otherwise); a report is refused until the child
  has actually answered (`insufficient_engagement`), so no fabricated
  assessments; the prompt additionally forbids inventing observations.
- **Uzbekistan data localization** — host Postgres with an in-country provider
  (Docker Compose makes this portable), and have a local specialist review the
  consent texts and the fact that AI processing runs on foreign servers.
- **Analytics without tracking** — the funnel stores a random per-browser id,
  a stage name and a first-touch source. No IP, no user agent, no fingerprint,
  no third-party analytics service, and nothing a child or parent typed.
  `Do Not Track` switches it off entirely.
- Honor deletion requests now: `DELETE /admin/leads/:id` (a button on the lead
  detail page) removes the parent and cascades to their children, sessions,
  messages, reports and funnel events.
- Retention runs automatically (in-stack cron, monthly): `RETENTION_MONTHS`
  (default 24) deletes children/sessions/reports whose last session activity is
  older than the window, plus any orphaned parent; the same job prunes funnel
  events past `ANALYTICS_RETENTION_DAYS` (default 180). `make purge` runs it
  manually.

---

## Operations

- **Reverse proxy timeouts:** the bundled nginx config already allows 300s for
  the long report call. If you put anything ELSE in front (Cloudflare, another
  proxy), its read timeout must also exceed `REPORT_TIMEOUT_MS` (180s default).
- **Backups are automatic** (in-stack cron, nightly → `./backups`, pruned after
  `BACKUP_KEEP_DAYS`). Your two jobs: copy dumps off the server (rclone/scp — a
  backup on the same disk dies with the disk) and test a restore monthly.
  Manual: `docker compose exec cron sh /app/server/scripts/backup.sh`; restore
  with `make restore F=…`.
- **Cost / billing alerts:** the admin panel (Statistika → LLM xarajati) shows
  total tokens and estimated spend (tune `PRICE_INPUT_PER_MTOK` /
  `PRICE_OUTPUT_PER_MTOK` to your model's prices). the in-stack cron also runs a daily credit
  check — watch `docker compose logs cron` for `[billing] ALERT` lines, which
  fire when the remaining OpenRouter balance drops below
  `BILLING_ALERT_MIN_USD`. Top up before sessions start dying mid-assessment.
- **Uptime monitoring (optional at small scale):** a free pinger (UptimeRobot)
  on `GET /healthz` + `GET /readyz` takes 5 minutes to set up whenever traffic
  grows enough to care.
- **Error tracking:** logs are stdout-only (`make logs`). Minimum: enable Docker
  log rotation (`logging: driver: json-file, options: {max-size: "10m",
  max-file: "5"}`) and grep for `[error]`. Recommended: self-hosted GlitchTip
  (Sentry-compatible, keeps error payloads off US SaaS) or Sentry with PII
  scrubbing on — our logs are already id-only, never child data.
- **Scheduled jobs are in-stack** (the `cron` service; see
  `deploy/cron/root`): nightly backup 02:15 UTC, monthly purge, daily billing
  check. `docker compose logs cron` shows every run — glance at it weekly, and
  make sure a `[backup] wrote` line appears daily.
- **Before every deploy / prompt change:** run the live smoke test against the
  real model (`BASE_URL=... node test/live-smoke.js`, costs a few cents) — stub
  tests prove the plumbing, only this proves the model still follows the
  prompt contract.
- **Prompt versioning:** every session stamps `prompt_version` (a hash of the
  assembled prompt), so old reports stay explainable after prompt edits.
- **Scaling:** rate limiting is in-memory (single instance). For multiple app
  instances, move it behind Redis and run the DB separately.

---

## Project structure

```
Kompas.dc.html          frontend SPA (rewired to the API)
support.js  _ds/        x-dc runtime + Modernist design system
uploads/                prompt sources (instructions + question bank) + specs
robots.txt  favicon.svg crawler/browser basics (copied into public/ by build:web)
server/
  index.js              Express app, static serving, redirects
  config.js             env config (provider switch, budgets, prices, gates)
  db/                   pool, migrations, migrate + seed + purge, repo (all SQL)
  routes/               auth, sessions, reports, track, admin, telegram
  services/             claude (Anthropic/OpenRouter dispatcher), prompt,
                        reportParse, funnel, delivery/{telegram,console}
  middleware/           auth, rateLimit, security, errorHandler
  utils/                phone, tokens, validate, leadStatus, reportUrl, http,
                        visitor
  scripts/              build-web, backup.sh, billing-check
  vendor/               React + ReactDOM UMD (pinned)
deploy/
  nginx/                TLS reverse-proxy template (${DOMAIN}-parameterized)
  cron/                 in-stack crontab (backup / purge / billing check)
test/                   unit, API, browser and live-smoke suites (see test/README.md)
.github/workflows/      CI: unit + API suites against real Postgres, stubbed LLM
docker-compose.yml  Makefile  .env.example
```

---

## Testing

`test/README.md` has the full guide. Summary: `bash test/run-api-tests.sh`
(with a throwaway `DATABASE_URL`) runs the unit + API suites against a real
Postgres with a stubbed LLM — the same thing CI runs on every push. Browser
suites verify the UI under the production CSP, and `test/live-smoke.js` runs
one REAL model session before deploys/prompt changes.
