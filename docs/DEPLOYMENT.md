# Deployment Guide — Yoshlar Kompasi

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
[llm] provider=openrouter model=anthropic/claude-sonnet-4.6 prompt=v1-...
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
- A domain with a DNS **A record** pointing at the server's IP. Wait until
  `dig +short your.domain.uz` returns the server IP before requesting a
  certificate.

### 2.2 Configure

```bash
git clone <repo> /opt/yoshlar-kompasi && cd /opt/yoshlar-kompasi
cp .env.example .env
```

`.env` — production minimum:

```bash
COMPOSE_PROFILES=prod                          # plain `docker compose up` includes nginx+certbot
DOMAIN=kompas.example.uz
PUBLIC_BASE_URL=https://kompas.example.uz      # must match DOMAIN

LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.6

JWT_SECRET=<openssl rand -base64 48>
ADMIN_EMAIL=admin@markaz.uz
ADMIN_PASSWORD=<strong>
POSTGRES_PASSWORD=<strong>
COOKIE_SECURE=true                             # (default in prod)

BILLING_ALERT_MIN_USD=5                        # daily credit-check threshold
```

Leave the rate limits at their defaults for production
(`RL_SESSIONS_PER_DAY=5` per IP, etc.) — they are the abuse brake on your
LLM spend.

### 2.3 One-time certificate

Port 80 must be free (stack not started yet, or `docker compose down`):

```bash
docker compose run --rm -p 80:80 --entrypoint certbot certbot \
  certonly --standalone -d kompas.example.uz -m you@example.com --agree-tos --no-eff-email
# or: make cert DOMAIN=kompas.example.uz EMAIL=you@example.com
```

Certificates land in `./letsencrypt/live/<domain>/`. **Renewal is automatic
afterwards** — the certbot sidecar renews via webroot every 12 h and nginx
reloads itself every 6 h.

### 2.4 Start

```bash
docker compose up -d --build        # or: make prod-up
docker compose logs -f app nginx cron
```

### 2.5 Verify (do all four)

1. **Boot line** — `docker compose logs app | tail` shows
   `[llm] provider=... model=... prompt=v1-...` with the values you expect.
   A stale prompt hash means a stale image — rebuild.
2. **TLS + redirect** — `curl -I http://kompas.example.uz` returns
   `301 → https://…`; `curl -sf https://kompas.example.uz/healthz` returns
   `{"ok":true}`; `/readyz` confirms the DB.
3. **Live smoke (real model, ~$0.10)** — from any machine with Node:
   ```bash
   BASE_URL=https://kompas.example.uz node test/live-smoke.js
   ```
   All PASS; read the printed report link yourself. This is the only check
   that proves the real model still follows the prompt.
4. **Admin** — log in at `https://kompas.example.uz/#/admin`, open
   Statistika: the LLM-xarajati block should show the smoke session's tokens.

### 2.6 Updating (every deploy after the first)

```bash
cd /opt/yoshlar-kompasi
git pull
docker compose up -d --build
```

Then re-run the verify steps (at minimum the boot line; the live smoke after
any prompt change). Tell testers to hard-refresh (Ctrl+Shift+R) after frontend
changes.

### 2.7 Changing the domain later

1. Point the new DNS A record at the server.
2. `docker compose down`, request a certificate for the new name (§2.3).
3. Update `DOMAIN` + `PUBLIC_BASE_URL` in `.env`.
4. `docker compose up -d --build`.

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
5. **Certificate + start**: exactly §2.3–§2.4 with your domain.
6. **Verify from OUTSIDE** — use mobile data, not your own Wi-Fi (hairpin NAT
   makes inside-the-LAN tests unreliable), then run the §2.5 checks.

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
| Session starts but no greeting / "Mashg'ulot topilmadi" | The first LLM call failed — `docker compose logs app` shows the real cause (bad key, no credits, bad model). The UI offers "Qayta urinish" once fixed. |
| `[billing] ALERT` in cron logs / sessions failing with provider errors | OpenRouter balance below threshold or exhausted. Top up; sessions retry cleanly. |
| Admin login does nothing on plain HTTP | `COOKIE_SECURE=true` blocks the cookie over http. Set `false` for local http; keep `true` in production. |
| Certificate issuance fails | Port 80 occupied (stop the stack first) or DNS not propagated yet (`dig +short` must return the server IP). |
| Frontend looks stale after deploy | Browser cache — hard refresh (Ctrl+Shift+R). `index.html` is served no-cache, but a tab may hold old JS. |
| Boot log shows an old `prompt=v1-...` hash after editing `uploads/*.md` | Prompt files are baked into the image at build time — `docker compose up -d --build` (a plain restart is not enough). |
| `make up` errors about DOMAIN | Only `prod-up` requires DOMAIN. For local, remove `COMPOSE_PROFILES=prod` from `.env`. |

---

## 6. Deploy checklist (print this)

```
Before:   [ ] .env secrets set     [ ] OpenRouter balance OK
Deploy:   [ ] git pull             [ ] docker compose up -d --build
Verify:   [ ] boot line: provider/model/prompt as expected
          [ ] https://DOMAIN/healthz + /readyz OK
          [ ] live smoke PASS (after prompt changes)  [ ] read one report
After:    [ ] logs quiet for 10 min: docker compose logs -f app
```
