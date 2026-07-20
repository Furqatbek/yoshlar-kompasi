# Build context is the repository ROOT (see docker-compose.yml).
FROM node:22-alpine

# pg_dump for the in-stack backup cron (same image runs app and cron).
RUN apk add --no-cache postgresql16-client

ENV NODE_ENV=production
WORKDIR /app/server

# Install production dependencies first for better layer caching.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Backend source (includes vendored React under server/vendor).
COPY server/ ./

# Frontend + prompt sources live one level up (repo root).
COPY Kompas.dc.html ../Kompas.dc.html
COPY support.js ../support.js
COPY _ds ../_ds
COPY uploads ../uploads
COPY robots.txt favicon.svg ../

# Assemble the static frontend into server/public.
RUN npm run build:web

EXPOSE 8080

# Run DB migrations (idempotent) and seed the admin, then start.
CMD ["sh", "-c", "node db/migrate.js && node db/seed.js && node index.js"]
