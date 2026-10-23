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

Copy the ready-made file. Do **not** retype it and do **not** open it in
TextEdit — TextEdit saves `.env.txt` or adds rich-text formatting, and Compose
then silently finds nothing.

```bash
cp .env.local.example .env
echo "JWT_SECRET=$(openssl rand -base64 48)" >> .env
nano .env     # set OPENROUTER_API_KEY, then Ctrl-O, Enter, Ctrl-X
```

Get a free key at `openrouter.ai/keys`. The key costs nothing and the `:free`
model slug costs nothing to call.

### Check Compose can actually see it

This is the single most useful command here, because a missing `.env` does not
look like a missing `.env` — it looks like a dozen unrelated settings being
wrong at once:

```bash
docker compose config | grep -E 'AUTH_REQUIRED|LLM_PROVIDER|PUBLIC_BASE_URL|ADMIN_EMAIL'
```

You want to see `AUTH_REQUIRED: "false"`, `LLM_PROVIDER: openrouter`,
`PUBLIC_BASE_URL: http://localhost:8080` and your admin email. If you see
`AUTH_REQUIRED: "true"` or a blank email, `.env` is not being read — see §8.

`.env.local.example` carries every setting already correct for localhost; the
sections below explain what is in it and why.

### The three defaults that are wrong for local HTTP

| Setting | Default | Why it bites | Local value |
|---|---|---|---|
| `COOKIE_SECURE` | `true` (because `NODE_ENV=production`) | Safari refuses a Secure cookie over `http://` — admin login bounces back with no error | `false` |
| `AUTH_REQUIRED` | `true` | the app refuses to boot without a real Telegram bot | `false` at first |
| `RL_SESSIONS_PER_DAY` | `20` | per IP, per day — you will hit it on an afternoon of testing | `100` |

### Everything else, and what it does

Left out of the block above because the default is correct, or because it only
applies once you go live:

| Setting | Default | Notes |
|---|---|---|
| `NODE_ENV` | — | compose hardcodes `production`; do not override |
| `PORT` | — | compose hardcodes `8080` inside the container; map it with `APP_PORT` |
| `DATABASE_URL` | — | compose builds it from the `POSTGRES_*` values |
| `TELEGRAM_BOT_TOKEN` | empty | required once `AUTH_REQUIRED=true` |
| `TELEGRAM_BOT_USERNAME` | empty | required once `AUTH_REQUIRED=true`, no `@` |
| `TELEGRAM_WEBHOOK_SECRET` | empty | required with the bot; an unset secret means an unauthenticated webhook |
| `AUTH_NONCE_TTL_MINUTES` | `15` | how long a login deep link stays valid |
| `AUTH_TOKEN_TTL_DAYS` | `90` | how long a parent stays logged in |
| `PAYME_MERCHANT_ID` / `_KEY` | empty | required once `PAYMENTS_ENABLED=true` |
| `PAYME_CHECKOUT_URL` | `https://checkout.paycom.uz` | change only for the sandbox |
| `OPENROUTER_SITE_URL` | empty | optional attribution |
| `BILLING_ALERT_MIN_USD` | `5` | cron warns below this credit balance |
| `REMIND_ABANDONED_HOURS` | `24` | and `REMIND_UNPAID_HOURS`, `REMIND_NEVER_STARTED_HOURS` |
| `REMIND_GIVE_UP_DAYS` | `14` | stop chasing after this long |
| `REMIND_MAX_PER_WEEK` | `2` | per parent |
| `REMIND_QUIET_FROM` / `_TO` | `21` / `9` | no messages at night |
| `REMIND_TZ_OFFSET` | `5` | Tashkent, for the quiet hours |
| `REMIND_MAX_PER_RUN` | `200` | batch ceiling per cron pass |
| `DOMAIN` | `localhost` | nginx only, and nginx does not start locally |

`.env.example` in the repo root is the full annotated reference, and
`test/unit/compose-env.test.js` asserts that every setting documented there is
actually passed through to the container that reads it — so this list cannot
quietly drift out of date.

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

## 7b. Is it slow — and is it even the build you think?

"Slow" is three different problems and they have different answers. Ask the
server what it did:

```bash
curl -s localhost:8080/healthz
```

```json
{"ok":true,"started_at":"…","model_called_on_start":false,"questions_sent_with_session":true}
```

Those two flags are statements about the code that is running, not settings.
`model_called_on_start: true` or a missing `questions_sent_with_session` means
the container is older than this document — `git pull && docker compose up
--build`. `started_at` says when this container booted; if it predates your last
rebuild, the rebuild did not take.

Then find out where the time goes. Every API response carries a `Server-Timing`
header with the server's own share of it:

```bash
curl -s -o /dev/null -D- -X POST localhost:8080/api/sessions \
  -H 'content-type: application/json' \
  -d '{"consent":true,"nickname":"Sinov","grade":2}' | grep -i server-timing
```

`app;dur=15` means the server took 15ms and everything else the browser waited
for was the network or the page itself. Starting a sitting is a database insert
— it makes no model call — so anything above about 100ms here is the database
or the container, not the application. Requests over 500ms also print a
`[slow]` line in `docker compose logs app` (tune with `SLOW_REQUEST_MS`).

If the server is fast and the page still feels slow, it is the page: open
DevTools → Network, reload, and read the transfer sizes. A cold load is about
180 KB over 13 requests.

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
| several unrelated settings missing at once (`ADMIN_EMAIL` blank, `AUTH_REQUIRED` still on, `ANTHROPIC_API_KEY` demanded although you chose OpenRouter) | **`.env` is not being read at all.** It is one cause, not five — see below |
| `pull access denied for yoshlar-kompasi-app` | fixed in the compose file; `git pull` if you cloned before this. It meant the `cron` service had no build block and Docker tried to fetch a local-only image name from the registry |

### When `.env` is not being read

The signature is a cluster of unrelated complaints: the admin seed skips,
`AUTH_REQUIRED` is still on, `PUBLIC_BASE_URL` is missing, and the app asks for
`ANTHROPIC_API_KEY` even though you set `LLM_PROVIDER=openrouter`. Every one of
those is a value `.env` supplies, so the file — not the settings — is the fault.

```bash
pwd                        # must be the folder containing docker-compose.yml
ls -la .env                # must exist, and be exactly ".env"
ls -la .env*               # looking for a stray ".env.txt" from TextEdit
file .env                  # want "ASCII text", not "rich text"
wc -l .env                 # should be ~45 lines, not 0 or 3
```

The usual causes, in order of how often they happen:

1. **TextEdit saved `.env.txt`.** macOS hides known extensions, so it looks
   right in Finder. `mv .env.txt .env`.
2. **Wrong folder.** Compose reads `.env` from the directory you run it in, not
   from the repo root. `cd` to where `docker-compose.yml` is.
3. **The heredoc did not finish.** If a `cat > .env <<'EOF'` block was pasted
   into a shell that swallowed part of it, the file is short or empty. Start
   over with `cp .env.local.example .env`.

Compose never errors on a missing `.env` — it warns about the handful of
variables that have no default and silently uses defaults for everything else,
which is why the symptom looks like several separate problems.

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

It answers all seventy questions as a child with a deliberate shape — high on
building and science, low on tidiness — and then asks for the report. One model
call, a few cents at most: the app serves the questions and does the scoring,
so the only thing the model writes is the report itself.

That is what to read. The test hard-asserts the structure (twelve scored areas,
the right sections, scores that match the answers it gave) and prints WARN lines
for the judgement calls a weak model fails: does the report write about the
areas the child actually scored highest on, does it stay inside what seventy
agreement ratings can show, is it Uzbek. Then it prints the link. Open it.

Run it against the free model and against a paid one and compare the two
reports side by side — that is the decision, and nothing else settles it.

`.env.local.example` sets `PAYMENTS_ENABLED=false`, so the link shows the whole
report. With payments on you would see only the free sections.
