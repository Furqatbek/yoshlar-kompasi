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
	@echo "  make dev           run the server with --watch"

# ---- Docker ----
.PHONY: up down logs ps backup restore psql
up:
	$(COMPOSE) up -d --build

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
.PHONY: install build-web migrate seed dev start
install:
	cd server && npm install

build-web:
	cd server && npm run build:web

migrate:
	cd server && npm run migrate

seed:
	cd server && npm run seed

dev:
	cd server && npm run dev

start:
	cd server && npm start
