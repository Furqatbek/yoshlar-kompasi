# Running it on a Mac with Docker

Everything below is checked against this repo's `docker-compose.yml` and
`server/config.js`, not from memory.

## 1. Install Docker Desktop

```bash
brew install --cask docker
open -a Docker
```

No Homebrew? Download **Docker Desktop for Mac — Apple Silicon** (or Intel, if
your Mac is pre-2020) from docker.com and drag it to Applications.

Wait for the whale icon in the menu bar to stop animating, then check:

```bash
docker --version && docker compose version
```

Both must print a version. `docker compose` (two words) is the modern form; the
old `docker-compose` hyphenated binary is not needed.

## 2. Get the branch

```bash
git clone https://github.com/Furqatbek/yoshlar-kompasi.git
cd yoshlar-kompasi
git checkout claude/70-savol-qiziqishlar-inventari
```

## 3. Write `.env`

`.env` sits next to `docker-compose.yml` and is gitignored — it never leaves
your machine.

```bash
cat > .env <<'EOF'
# --- database (local container, these values are fine as they are) -----------
POSTGRES_USER=yik
POSTGRES_PASSWORD=yik
POSTGRES_DB=yik

# --- app --------------------------------------------------------------------
APP_PORT=8080
PUBLIC_BASE_URL=http://localhost:8080

# --- admin panel ------------------------------------------------------------
ADMIN_EMAIL=admin@markaz.uz
ADMIN_PASSWORD=change-this-now

# --- first run: no Telegram bot, no payments --------------------------------
# AUTH_REQUIRED defaults to ON and then demands a real bot, which is a slow way
# to start. Off means the form is open immediately; reports print to the log
# instead of being delivered.
AUTH_REQUIRED=false
DELIVERY_PROVIDER=console
PAYMENTS_ENABLED=false

# --- the model --------------------------------------------------------------
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-REPLACE-ME
OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1:free
EOF
```

Then set two real values:

```bash
# a proper secret, not a guessable one
echo "JWT_SECRET=$(openssl rand -base64 48)" >> .env

# edit ADMIN_PASSWORD and OPENROUTER_API_KEY by hand
open -e .env
```

Get a free OpenRouter key at `openrouter.ai/keys`. The key costs nothing and
the `:free` model slug costs nothing to call.

## 4. Start

```bash
docker compose up --build
```

The first build takes a few minutes. You want to see, in order:

```
db       | database system is ready to accept connections
app      | [migrate] applied 8 migration(s).
app      | [seed] admin created: admin@markaz.uz
app      | [seed] question bank: +70 questions, +12 sections, +4 bands, +7 report sections
app      | [yoshlar-kompasi] listening on :8080 (production)
app      | [llm] provider=openrouter model=deepseek/... prompt=v2-...
app      | [bank] 70/70 questions active across 12 sections
```

Migrations and seeding run automatically on every start and are idempotent, so
restarting never duplicates anything.

Open **http://localhost:8080** — and **http://localhost:8080/#/admin** for the
panel, with the email and password from `.env`.

## 5. What is actually running

`docker compose up` starts three containers:

| Container | What it is |
|---|---|
| `db` | PostgreSQL 16. Data lives in a named volume, so it survives restarts. |
| `app` | The Node server on `127.0.0.1:8080` — **localhost only**, never exposed to your network. |
| `cron` | Nightly backup, retention purge, LLM credit check. Idle unless you turn reminders on. |

`nginx` and `certbot` are also in the file but sit behind the `prod` profile, so
they do **not** start locally. You do not need TLS to run on your own machine.

## 6. Everyday commands

```bash
docker compose logs -f app      # follow the app log (report links print here)
docker compose ps               # what is running
docker compose restart app      # after an .env change
docker compose down             # stop, keep the data
docker compose down -v          # stop AND erase the database
docker compose up --build       # rebuild after pulling code
```

With `DELIVERY_PROVIDER=console` the report link is printed in the app log
rather than sent, so `docker compose logs -f app` is where you collect it.

## 7. When you want the real thing

Turn these on one at a time, restarting the app between each:

**Telegram login and delivery** — create a bot with `@BotFather`, then:

```
AUTH_REQUIRED=true
DELIVERY_PROVIDER=telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=your_bot
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
```

Telegram needs a **public HTTPS URL** for its webhook, which `localhost` is not.
For local testing use a tunnel (`cloudflared tunnel --url http://localhost:8080`
or `ngrok http 8080`) and set `PUBLIC_BASE_URL` to the URL it gives you.

**Payments** — `PAYMENTS_ENABLED=true` plus `PAYME_MERCHANT_ID` and
`PAYME_MERCHANT_KEY`. Test against Payme's sandbox before anything real.

## 8. If it will not start

The app refuses to boot on a bad configuration rather than running half-broken,
and the log names the missing setting. The common ones:

| Log says | Fix |
|---|---|
| `TELEGRAM_BOT_TOKEN (required while AUTH_REQUIRED is on)` | `AUTH_REQUIRED=false`, or configure a bot |
| `JWT_SECRET (>=16 chars)` | the `openssl rand` line in step 3 |
| `PUBLIC_BASE_URL` | compose sets `NODE_ENV=production`, which requires it |
| `OPENROUTER_API_KEY (required when LLM_PROVIDER=openrouter)` | paste a real key |
| port 8080 already allocated | `APP_PORT=8090` in `.env` |

**Apple Silicon:** both images are multi-arch, so nothing special is needed. If
Docker ever complains about platform, `docker compose build --pull` usually
settles it.

## 9. Does the free model actually work?

Running is one thing; producing a usable Uzbek report is another, and a free
model may not. The question is settled by measurement, not opinion.

The smoke test talks to the app over HTTP, so it runs from your Mac against the
container. If you have Node 20+ installed:

```bash
BASE_URL=http://localhost:8080 node test/live-smoke.js
```

No Node on the Mac? Run it inside the stack instead. The image does **not**
include `test/`, so mount it and join the compose network, where the app is
reachable as `app` rather than `localhost`:

```bash
docker compose run --rm \
  -v "$PWD/test:/app/test" \
  -e BASE_URL=http://app:8080 \
  app node /app/test/live-smoke.js
```

It drives one real sitting and hard-asserts the three things that matter — that
the model quotes the questions verbatim, that it emits the `[JAVOBLAR:]` answer
line (without it nothing is recorded and every area silently scores null), and
that the report comes back with twelve scored areas. Run it against the free
model and against a paid one and compare the output.
