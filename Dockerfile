# bm-hr — container image for Google Cloud Run (asia-southeast1, next to Supabase).
# Same three-stage shape as bm-sales: build the API with dev deps, build the
# SPA, run with prod deps only. Non-root.

# ---- api builder --------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
# npm install (not ci): the lock is generated on Windows and lacks Linux-only
# optional binaries (esbuild) that `npm ci` would demand.
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- client (SPA) -------------------------------------------------------------
FROM node:22-slim AS client
WORKDIR /client
COPY client/package*.json ./
RUN npm install --no-audit --no-fund
COPY client/ .
RUN npm run build

# ---- runner -------------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist
# Bundled SPA, served as static from /app/public by src/app.ts.
COPY --from=client /client/dist ./public
# Migrations are applied out-of-band (`npm run db:migrate` from a trusted
# machine), never from this image. See DEPLOY.md.
RUN useradd --system --uid 1001 bmhr && chown -R bmhr:bmhr /app
USER bmhr
EXPOSE 8080
ENV PORT=8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
