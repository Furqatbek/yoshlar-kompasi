# Yosh Iste'dodlar Kompasi — operations shortcuts.
# Docker targets use docker compose; local targets run the Node server directly.

COMPOSE ?= docker compose
BACKUP_DIR ?= backups

.PHONY: help
help:
	@echo "Docker:"
	@echo "  make up            build + start (app + postgres), runs migrations"
	@echo "  make down          stop"
	@echo "  make logs          tail app logs"
	@echo "  make ps            container status"
	@echo "  make backup        dump the database to $(BACKUP_DIR)/"
	@echo "  make restore F=... restore a dump file into the database"
	@echo "  make psql          open a psql shell"
	@echo "Local (no Docker):"
	@echo "  make install       npm install in server/"
	@echo "  make build-web     assemble server/public from the frontend"
	@echo "  make migrate       run DB migrations (needs DATABASE_URL)"
	@echo "  make seed          create the admin (needs ADMIN_EMAIL/PASSWORD)"
	@echo "  make purge         delete data past the retention window (cron this)"
	@echo "  make dev           run the server with --watch"

# ---- Docker ----
.PHONY: up down logs ps backup restore psql prod-up prod-down prod-logs cert
up:
	$(COMPOSE) up -d --build

# ---- Production (nginx + TLS; compose profile "prod") ----
# One-time: point DNS at this server, then `make cert DOMAIN=... EMAIL=...`,
# set DOMAIN (+ PUBLIC_BASE_URL=https://$DOMAIN) in .env, then `make prod-up`.
prod-up:
	@grep -q '^DOMAIN=..*' .env || (echo "Set DOMAIN=your.domain in .env first"; exit 1)
	@grep -q '^PUBLIC_BASE_URL=..*' .env || (echo "Set PUBLIC_BASE_URL=https://your.domain in .env first"; exit 1)
	COMPOSE_PROFILES=prod $(COMPOSE) up -d --build

prod-down:
	COMPOSE_PROFILES=prod $(COMPOSE) down

prod-logs:
	COMPOSE_PROFILES=prod $(COMPOSE) logs -f app nginx cron

# Initial certificate issuance (standalone; needs port 80 free — run BEFORE
# prod-up, or `make prod-down` first). Renewals are automatic afterwards.
cert:
	@test -n "$(DOMAIN)" || (echo "Usage: make cert DOMAIN=kompas.example.uz EMAIL=you@example.com"; exit 1)
	@test -n "$(EMAIL)" || (echo "Usage: make cert DOMAIN=kompas.example.uz EMAIL=you@example.com"; exit 1)
	docker run --rm -p 80:80 -v $$(pwd)/letsencrypt:/etc/letsencrypt certbot/certbot certonly --standalone -d $(DOMAIN) -m $(EMAIL) --agree-tos --no-eff-email

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f app

ps:
	$(COMPOSE) ps

backup:
	@mkdir -p $(BACKUP_DIR)
	$(COMPOSE) exec -T db pg_dump -U $${POSTGRES_USER:-yik} $${POSTGRES_DB:-yik} | gzip > $(BACKUP_DIR)/yik-$$(date +%Y%m%d-%H%M%S).sql.gz
	@echo "Backup written to $(BACKUP_DIR)/"

restore:
	@test -n "$(F)" || (echo "Usage: make restore F=backups/yik-XXXX.sql.gz"; exit 1)
	gunzip -c $(F) | $(COMPOSE) exec -T db psql -U $${POSTGRES_USER:-yik} $${POSTGRES_DB:-yik}

psql:
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-yik} $${POSTGRES_DB:-yik}

# ---- Local (no Docker) ----
.PHONY: install build-web migrate seed dev start billing-check
install:
	cd server && npm install

build-web:
	cd server && npm run build:web

migrate:
	cd server && npm run migrate

seed:
	cd server && npm run seed

purge:
	cd server && npm run purge

billing-check:
	cd server && npm run billing-check

dev:
	cd server && npm run dev

start:
	cd server && npm start
