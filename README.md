# Yosh Iste'dodlar Kompasi

An AI-assisted strengths assessment for primary-school children (grades 1–4) in
Uzbek. An adult (parent or teacher) reads questions aloud, records the child's
answers, and Claude produces a personalized report — a strengths profile, a
"where they are now" read across three tracks, a 3–6 month roadmap, study tips
and sport recommendations. The centre gets a lead panel with reports, statuses,
notes and a weekly funnel.

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
   ├─ routes/sessions  create · messages · resume · contact · report
   ├─ routes/reports   public report by share_token
   ├─ routes/admin     login · leads · lead · stats · CSV
   ├─ routes/telegram  delivery webhook
   ├─ services/claude  → api.anthropic.com/v1/messages   (key server-side)
   ├─ services/prompt  system prompt = uploads/*.md + protocol + json rule
   └─ db (pg)          parents · children · sessions · messages · reports · admins
   ▼
PostgreSQL
```

The API key never reaches the browser. The model only ever sees the child's
nickname, grade, age and answers — never a parent's name or phone.

---

## Quick start (Docker)

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
| `DELIVERY_PROVIDER` | no | `console` (default) or `telegram` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | if telegram | Bot credentials |
| `TELEGRAM_WEBHOOK_SECRET` | no | Verifies webhook calls |
| `CONSENT_TEXT_VERSION` | no | Stamped on each recorded consent |
| `MAX_TURNS` / `MAX_MESSAGE_CHARS` | no | Abuse caps (60 / 2000) |
| `RL_MESSAGES_PER_MIN` / `RL_SESSIONS_PER_DAY` / `RL_ADMIN_LOGIN_PER_MIN` | no | Rate limits |

---

## API

Parent-facing (session token in the `X-Session-Token` header):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/sessions` | Create child + session, greeting + first questions |
| POST | `/api/sessions/:id/messages` | Adult's turn (`{content}` or `{retry:true}`) |
| GET | `/api/sessions/:id` | Resume: full state |
| POST | `/api/sessions/:id/contact` | The report gate (parent + consent) |
| POST | `/api/sessions/:id/report` | Generate, parse, store, deliver |
| GET | `/api/reports/:share_token` | Public report data (no login) |

Admin (httpOnly JWT cookie):

`POST /admin/login` · `POST /admin/logout` · `GET /admin/me` ·
`GET /admin/leads` · `GET /admin/leads/:id` · `PATCH /admin/leads/:id` ·
`DELETE /admin/leads/:id` (right-to-erasure, cascades) ·
`GET /admin/stats` · `GET /admin/export/leads.csv`

Health: `GET /healthz`, `GET /readyz` (checks the DB).

Clean links `/(hisobot|mashgulot)/:token` 302-redirect into the hash-routed SPA.

---

## Report delivery (Telegram)

Phase 1 ships Telegram (spec's recommended channel for Uzbekistan) with a
`console` fallback that just logs the link.

1. Create a bot with @BotFather; set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
   `DELIVERY_PROVIDER=telegram`.
2. Register the webhook (once):
   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=$PUBLIC_BASE_URL/api/telegram/webhook" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```
3. On the report screen the parent taps **Telegram orqali olish** → the bot's
   `/start <token>` handler sends the report link and becomes a re-engagement
   channel for the centre.

SMS (Eskiz) can be added later behind the same `services/delivery` interface.

---

## Security & compliance

- API key and DB credentials are environment variables; never in the client.
- Session tokens are 256-bit; report share tokens 144-bit. Admin passwords are
  bcrypt-hashed; the admin panel is cookie-gated and login is rate-limited.
- Abuse controls on the "free Claude" surface: 60-turn / 2000-char caps,
  ~20 messages/min per session, ~5 new sessions/day per IP, and an "off-topic →
  decline" instruction in the system prompt.
- **Children's data minimization** — the schema has no column for surname,
  address, school number or photo, and the model never receives parent contact
  fields. Only nickname + answers cross the border to Anthropic.
- **Uzbekistan data localization** — host Postgres with an in-country provider
  (Docker Compose makes this portable), and have a local specialist review the
  consent texts and the fact that AI processing runs on foreign servers.
- Honor deletion requests now: `DELETE /admin/leads/:id` (a button on the lead
  detail page) removes the parent and cascades to their children, sessions,
  messages and reports.
- Enforce a retention window with `make purge` (or `npm run purge`) —
  `RETENTION_MONTHS` (default 24) deletes children/sessions/reports whose last
  session activity is older than the window, plus any orphaned parent. Schedule
  it from cron.

---

## Operations

- **Backups:** `make backup` (nightly via cron recommended); `make restore F=…`.
- **Retention:** `make purge` on a cron (respects `RETENTION_MONTHS`).
- **Monitoring:** watch three numbers — sessions finished/day, average tokens
  per session (input/output tokens are logged per session), and delivery success.
  `GET /readyz` for liveness.
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
server/
  index.js              Express app, static serving, redirects
  config.js             env config
  db/                   pool, migrations, migrate + seed runners, repo (all SQL)
  routes/               sessions, reports, admin, telegram
  services/             claude, prompt, reportParse, delivery/{telegram,console}
  middleware/           auth, rateLimit, security, errorHandler
  utils/                phone, tokens, validate, leadStatus, reportUrl, http
  scripts/build-web.js  assembles server/public
  vendor/               React + ReactDOM UMD (pinned)
docker-compose.yml  Makefile  .env.example
```
