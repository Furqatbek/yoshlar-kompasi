# Deployment Guide — CareerKids

Two supported setups:

- **Local** — one command on your machine, plain HTTP on `localhost:8080`.
  For development and testing with real children in the room.
- **Production** — one server, Docker Compose with the `prod` profile:
  nginx terminates HTTPS, certbot renews certificates, an in-stack cron
  container runs backups / retention purge / billing checks.

Everything is driven by `docker compose` (the `make` targets are optional
shortcuts — every step below shows the raw compose command).

---

## 1. Local deployment (Docker)

**Prerequisites:** Docker + Docker Compose v2, an LLM key — `ANTHROPIC_API_KEY`
or an [OpenRouter](https://openrouter.ai/keys) key.

```bash
git clone <repo> && cd yoshlar-kompasi
cp .env.example .env
```

Edit `.env` — minimum for local:

```bash
# LLM (pick ONE provider)
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6   # vendor/model slug, DOT versions

# secrets
JWT_SECRET=<openssl rand -base64 48>
ADMIN_EMAIL=admin@markaz.uz
ADMIN_PASSWORD=<strong>
POSTGRES_PASSWORD=<strong>

# local http only — otherwise the admin cookie is not stored
COOKIE_SECURE=false
```

Start:

```bash
docker compose up -d --build        # or: make up
docker compose logs -f app          # or: make logs
```

**Verify** — the boot log must show, with YOUR provider/model and the current
prompt hash:

```
[yoshlar-kompasi] listening on :8080 (production)
[llm] provider=openrouter model=anthropic/claude-sonnet-4.6 prompt=v2-...
```

Open http://localhost:8080 — the assessment app. Admin panel:
http://localhost:8080/#/admin (log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`).

Stop with `docker compose down`. Data persists in the `db_data` volume;
nightly backups land in `./backups` (the `cron` container runs locally too).

### Local development without Docker (hot reload)

Requires Node 20+ and a reachable Postgres:

```bash
cd server && npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/yik
export OPENROUTER_API_KEY=sk-or-... LLM_PROVIDER=openrouter
export JWT_SECRET=$(openssl rand -base64 48)
export ADMIN_EMAIL=admin@markaz.uz ADMIN_PASSWORD=secret COOKIE_SECURE=false
npm run migrate && npm run seed
npm run build:web     # assemble server/public from the frontend
npm run dev           # --watch mode on :8080
```

Re-run `npm run build:web` after any `Kompas.dc.html` edit.

---

## 2. Production deployment (one server, nginx + TLS)

### 2.1 Server prerequisites

- A VPS/server with Docker + Docker Compose v2 (2 GB RAM is plenty).
- Firewall: ports **80** and **443** open to the world. Nothing else needs to
  be public — the app container binds to 127.0.0.1 only.
- DNS **A records** pointing at the server's IP, for the bare domain and for
  the `www.` form (people type it). Wait until `dig +short careerkids.uz` and
  `dig +short www.careerkids.uz` both return the server IP before requesting a
  certificate — certbot verifies every name on the request, and one missing
  record fails all of it.

### 2.2 The Telegram bot (first, because nothing boots without it)

`AUTH_REQUIRED` defaults to **true**: a parent logs in through the bot before
any assessment starts, and that login is what earns the right to message them
afterwards with the report. The app **refuses to boot in production** if
authorization is on and the bot is not configured, rather than serving a login
nobody can complete.

In Telegram, talk to [@BotFather](https://t.me/BotFather): `/newbot`, pick a
name and a username. Keep the token it gives you — it is a password for the bot.

You need three values in `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:AA...        # from BotFather
TELEGRAM_BOT_USERNAME=careerkids_bot   # without the @
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>   # yours to invent; registered in §2.7
```

`DELIVERY_PROVIDER=telegram` is separate and is what sends the finished report
to the parent's chat **as a PDF file**. Leave it `console` and reports are only
reachable by link.

### 2.3 Configure

```bash
git clone <repo> /opt/careerkids && cd /opt/careerkids
cp .env.example .env
```

`.env` — production minimum:

```bash
COMPOSE_PROFILES=prod                          # plain `docker compose up` includes nginx+certbot
DOMAIN=careerkids.uz
DOMAIN_ALIASES=www.careerkids.uz               # 301'd to DOMAIN; must be on the certificate
PUBLIC_BASE_URL=https://careerkids.uz          # must match DOMAIN, no trailing slash

LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6

JWT_SECRET=<openssl rand -base64 48>
ADMIN_EMAIL=admin@careerkids.uz
ADMIN_PASSWORD=<strong>
POSTGRES_PASSWORD=<strong>
COOKIE_SECURE=true                             # (default in prod)

DELIVERY_PROVIDER=telegram                     # report PDF into the parent's chat
TELEGRAM_BOT_TOKEN=...                         # §2.2
TELEGRAM_BOT_USERNAME=...
TELEGRAM_WEBHOOK_SECRET=...

BILLING_ALERT_MIN_USD=5                        # daily credit-check threshold
```

`PUBLIC_BASE_URL` is not decoration: report links, the Payme return and the
bot's deep links are all built from it. Wrong, and the links in a parent's chat
point somewhere else.

Three more worth a decision rather than a default:

- **`PAYMENTS_ENABLED`** is `false` out of the box, which gives every report
  away in full. Turn it on only with `PAYME_MERCHANT_ID` / `PAYME_MERCHANT_KEY`
  from the merchant cabinet in hand — see `the Payme block in `.env.example` and README §Payme integration`. A deployment with
  the paywall on and no merchant locks reports behind a payment nobody can make.
- **`REMINDERS_ENABLED`** is `false`; turn it on when you are willing to have
  the bot message people who stopped partway.
- **`BRAND_NAME`** and **`CONTACT_PHONES`** default to CareerKids and the two
  centre numbers. Change both or neither: the PDF is headed with the server's
  copy and the page with its own, and a report named differently from the site
  it came from is worse than either name alone.

Leave the rate limits at their defaults for production
(`RL_SESSIONS_PER_DAY=20` per IP, etc.). The one to think about is the
per-IP daily session cap: starting a sitting costs no model call, so what
it protects is your database rather than your LLM bill — the bill is the
report, which is one call per session. Raise it if a school works through a
class on one connection; `RL_MESSAGES_PER_MIN` and the per-session report
limit are the brakes on spend.

### 2.4 One-time certificate

Port 80 must be free (stack not started yet, or `docker compose down`). Ask for
every name you will serve in **one** certificate:

```bash
make cert DOMAIN=careerkids.uz EMAIL=you@example.com ALIASES='www.careerkids.uz'
# raw equivalent:
docker run --rm -p 80:80 -v "$(pwd)/letsencrypt:/etc/letsencrypt" certbot/certbot \
  certonly --standalone -d careerkids.uz -d www.careerkids.uz \
  -m you@example.com --agree-tos --no-eff-email
```

Certificates land in `./letsencrypt/live/careerkids.uz/`. Whatever you passed as
`ALIASES` belongs in `DOMAIN_ALIASES` too — nginx answers only on the names it
is given, and a name in `DOMAIN_ALIASES` that is *not* on the certificate shows
visitors a certificate warning before the redirect. **Renewal is automatic
afterwards** — the certbot sidecar renews via webroot every 12 h and nginx
reloads itself every 6 h.

### 2.5 Start

```bash
make prod-up                        # = COMPOSE_PROFILES=prod docker compose up -d --build
docker compose logs -f app nginx cron
```

### 2.6 Verify (do all five)

1. **Boot line** — `docker compose logs app | tail` shows
   `[llm] provider=... model=... prompt=v2-...` with the values you expect.
   A stale prompt hash means a stale image — rebuild.
2. **nginx is serving our config** — `docker compose logs nginx` shows
   `[nginx] config verified; reloading every 6h for certificate renewals`.
   Anything else, read §5: the one failure that looks like success is nginx
   coming up on its own stock config.
3. **TLS + redirect + canonical host**
   ```bash
   curl -sI http://careerkids.uz          | head -2   # 301 -> https://careerkids.uz/
   curl -sI https://www.careerkids.uz     | head -2   # 301 -> https://careerkids.uz/
   curl -s  https://careerkids.uz/healthz             # {"ok":true,"commit":"...",...}
   curl -s  https://careerkids.uz/readyz              # {"ok":true,"db":true}
   ```
   `commit` in `/healthz` is the build that is actually running — compare it
   with `git rev-parse --short=12 HEAD` to be sure the rebuild took.
4. **Live smoke (real model, ~$0.10)** — from any machine with Node:
   ```bash
   BASE_URL=https://careerkids.uz node test/live-smoke.js
   ```
   All PASS; read the printed report link yourself, and download the PDF from
   it. This is the only check that proves the real model still follows the
   prompt, and the only one that proves a parent gets a readable file.
5. **Admin** — log in at `https://careerkids.uz/#/admin`, open Statistika: the
   LLM-xarajati block should show the smoke session's tokens.

### 2.7 Register the Telegram webhook (once the domain is live)

Until this is done the bot receives nothing, so no login completes and no
report is delivered. Run it from anywhere, with the token and the same secret
you put in `.env`:

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://careerkids.uz/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
# expect: {"ok":true,"result":true,"description":"Webhook was set"}

curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
# check: url, pending_update_count: 0, and no last_error_message
```

The secret is compared on every update, so a mismatch is silent from
Telegram's side and shows up as 401s in `docker compose logs app`. Then test it
like a parent would: open the site, start a sitting, and confirm the bot
answers your `/start`.

### 2.8 Updating (every deploy after the first)

```bash
cd /opt/careerkids
git pull
make prod-up
```

Then re-run the verify steps (at minimum the boot line and `/healthz`'s
`commit`; the live smoke after any prompt change). Tell testers to hard-refresh
(Ctrl+Shift+R) after frontend changes.

### 2.9 Changing the domain later

1. Point the new DNS A records at the server.
2. `make prod-down`, request a certificate for the new names (§2.4).
3. Update `DOMAIN`, `DOMAIN_ALIASES` and `PUBLIC_BASE_URL` in `.env`.
4. `make prod-up`, then re-register the Telegram webhook on the new host (§2.7).

Old report links contain the old domain — they break on a domain change.

---

## 3. What runs automatically vs. what you still do

| Automatic (in-stack) | Your responsibility |
|---|---|
| Nightly DB backup → `./backups` (02:15 UTC, pruned after `BACKUP_KEEP_DAYS`=14) | Copy `./backups` OFF the server (rclone/scp); test a restore monthly |
| Monthly retention purge (`RETENTION_MONTHS`=24) | Glance at `docker compose logs cron` weekly — a `[backup] wrote` line must appear daily |
| Daily OpenRouter credit check | Top up when you see `[billing] ALERT`; keep `BILLING_ALERT_MIN_USD` ≈ a week of sessions |
| Certificate renewal + nginx reload | Nothing (verify with `curl -vI https://…` occasionally) |

Manual operations:

```bash
docker compose exec cron sh /app/server/scripts/backup.sh          # backup now
gunzip -c backups/yik-XXXX.sql.gz | docker compose exec -T db psql -U yik yik   # restore
docker compose exec cron node /app/server/scripts/billing-check.js # credit check now
docker compose exec cron node /app/server/db/purge.js              # purge now
```

---

## 4. Self-hosting on your own machine (home/office)

The production flow (§2) works from any machine that the internet can reach.
What differs is getting reachable:

1. **Public IP check (make-or-break).** Compare your router's WAN IP with
   what https://ifconfig.me shows. If they differ — or the WAN IP starts with
   `100.64–100.127`, `10.`, or `192.168.` — you are behind CGNAT and port
   forwarding cannot work. Ask your ISP for a public (ideally static) IP; in
   Uzbekistan this is a routine paid add-on.
2. **Fix the machine's LAN address** via a DHCP reservation in the router.
3. **Port-forward** WAN 80 → machine:80 and WAN 443 → machine:443. Nothing
   else — only nginx listens publicly.
4. **DNS:**
   - Static public IP: one A record at your registrar → done.
   - Dynamic IP: free dynamic DNS, e.g. DuckDNS — create `name.duckdns.org`,
     then keep it updated from the machine:
     `*/5 * * * * curl -s "https://www.duckdns.org/update?domains=name&token=TOKEN&ip="`
     Optionally CNAME a subdomain of your real domain to it.
   - If Cloudflare manages your DNS, keep the record **DNS only (grey cloud)**
     — the orange-cloud proxy's ~100 s timeout kills the report call.
5. **Certificate + start**: exactly §2.4–§2.5 with your domain.
6. **Verify from OUTSIDE** — use mobile data, not your own Wi-Fi (hairpin NAT
   makes inside-the-LAN tests unreliable), then run the §2.6 checks.

Realities of home hosting: disable sleep and enable Docker on boot
(`systemctl enable docker`; containers are `restart: unless-stopped`); if the
ISP blocks inbound 80, switch certbot to a DNS-01 challenge; the machine now
physically holds children's data — keep the OS patched, consider disk
encryption, and keep backup copies OFF the machine.

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Boot fails: `OPENROUTER_MODEL="..." is not a valid OpenRouter slug` | OpenRouter needs `vendor/model` slugs with DOT versions (`anthropic/claude-sonnet-4.6`), not Anthropic ids (`claude-sonnet-4-6`). Deliberate fail-fast at boot. |
| `POST .../report` → 504/timeout | The report is one 1–3 min LLM call. `REPORT_TIMEOUT_MS` default 180000; bundled nginx allows 300 s. If Cloudflare or another proxy sits in front, raise ITS read timeout too. |
| **The domain shows "Welcome to nginx!"** | nginx is running on the stock config that ships in its image: port 80, no TLS, no app. Every container still reports healthy, which is why this is the one failure that looks like success. The rendering of `deploy/nginx/*.template` happens inside the image's entrypoint, and that entrypoint only runs it when its first argument is `nginx` — so a `command:` on the nginx service skips it in silence. There is now a guard: `deploy/nginx/entrypoint.d/99-reload-and-verify.sh` refuses to start on an unrendered config, and `test/unit/compose-env.test.js` fails if the override comes back. If you see the welcome page, the guard is not mounted. |
| nginx crash-loops with `[nginx] FATAL: ... no TLS in it` | The guard above, doing its job: the template was not rendered. Check that `./deploy/nginx` is mounted at `/etc/nginx/templates` and that the nginx service has no `command:`. |
| nginx crash-loops with `[nginx] FATAL: ... unsubstituted placeholders` | A `${VAR}` in the template has no variable behind it in the nginx service's `environment:`. envsubst leaves an undefined one as literal text. The message names it. |
| nginx exits with `cannot load certificate .../live/careerkids.uz/fullchain.pem` | No certificate yet, or it was issued for a different name than `DOMAIN`. Run §2.4 with port 80 free. |
| Boot fails: `TELEGRAM_BOT_TOKEN (required while AUTH_REQUIRED is on)` | Deliberate: authorization runs through the bot, so a missing bot would mean a login nobody can finish. Set the three `TELEGRAM_*` values (§2.2), or set `AUTH_REQUIRED=false` to run without a login gate. |
| Login never completes / the bot ignores `/start` | The webhook is not registered, or its secret does not match. `getWebhookInfo` (§2.7) shows the URL and the last error; a secret mismatch shows as 401s in `docker compose logs app`. |
| The report finishes but no PDF arrives in Telegram | `DELIVERY_PROVIDER` is still `console` — then only the link exists. With it set to `telegram`, delivery failures are logged (`[delivery] ...`) and fall back to a message with the link, so the chat is the place to look second and the app log first. |
| Session starts but "Mashg'ulot topilmadi" | Starting a sitting no longer calls the model, so this is not an LLM failure — the session row or its token is missing. `docker compose logs app` shows the real cause; `/readyz` confirms the database is reachable. |
| `[billing] ALERT` in cron logs / sessions failing with provider errors | OpenRouter balance below threshold or exhausted. Top up; sessions retry cleanly. |
| Admin login does nothing on plain HTTP | `COOKIE_SECURE=true` blocks the cookie over http. Set `false` for local http; keep `true` in production. |
| Certificate issuance fails | Port 80 occupied (stop the stack first) or DNS not propagated yet (`dig +short` must return the server IP). |
| Frontend looks stale after deploy | Browser cache — hard refresh (Ctrl+Shift+R). `index.html` is served no-cache, but a tab may hold old JS. |
| Boot log shows an old `prompt=v2-...` hash after editing `uploads/*.md` | Prompt files are baked into the image at build time — `docker compose up -d --build` (a plain restart is not enough). |
| `make up` errors about DOMAIN | Only `prod-up` requires DOMAIN. For local, remove `COMPOSE_PROFILES=prod` from `.env`. |

---

## 6. Deploy checklist (print this)

First launch:

```
DNS:      [ ] A record: DOMAIN -> server IP   [ ] A record: www.DOMAIN -> server IP
Bot:      [ ] BotFather token + username      [ ] webhook secret generated
Config:   [ ] .env secrets set (JWT, admin, postgres, LLM key)
          [ ] DOMAIN + DOMAIN_ALIASES + PUBLIC_BASE_URL agree with each other
          [ ] decided: PAYMENTS_ENABLED, REMINDERS_ENABLED
Cert:     [ ] make cert DOMAIN=... EMAIL=... ALIASES='www....'  (port 80 free)
Start:    [ ] make prod-up
Verify:   [ ] app boot line: provider/model/prompt as expected
          [ ] nginx: "config verified"       [ ] http + www both 301 to canonical
          [ ] /healthz commit == git HEAD    [ ] /readyz ok
          [ ] webhook registered; the bot answers /start
          [ ] live smoke PASS                [ ] downloaded one report PDF
          [ ] admin login works over https
After:    [ ] logs quiet for 10 min: docker compose logs -f app nginx cron
          [ ] tomorrow: a "[backup] wrote" line in docker compose logs cron
```

Every deploy after that:

```
Deploy:   [ ] git pull             [ ] make prod-up
Verify:   [ ] boot line as expected   [ ] /healthz commit == git HEAD
          [ ] live smoke PASS (after any prompt change)
```
