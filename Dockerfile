# syntax=docker/dockerfile:1

# Debian slim rather than Alpine: sharp's prebuilt libvips binaries are glibc,
# and photo processing is on the critical path for this app.
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next build` runs `prisma generate` via the build script. It does not need a
# reachable database, but the Prisma config reads the variable, so give it a
# placeholder that is overridden at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npm run build

# ---------------------------------------------------------------------------
# Migrator — runs once per deploy, then exits
# ---------------------------------------------------------------------------
# Keeps the Prisma CLI and dev dependencies out of the runtime image while
# still giving migrations and the seed everything they need.
FROM ${NODE_IMAGE} AS migrator
WORKDIR /app
ENV NODE_ENV=production

# The migration engine is a native binary that links OpenSSL, and the slim
# image ships without it. Prisma then guesses a version, says so loudly on
# every deploy, and picks the wrong engine on some hosts.
# psql is here for one job: reading back whether a failed migration applied
# anything, so a deploy that lost a race for a lock can be retried rather than
# needing somebody to unstick it by hand.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssl ca-certificates postgresql-client \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/lib/permissions.ts ./src/lib/permissions.ts
COPY --from=builder /app/prisma.config.ts /app/package.json /app/tsconfig.json ./
COPY --from=builder /app/scripts/migrate.sh ./scripts/migrate.sh
CMD ["sh", "./scripts/migrate.sh"]

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# `output: "standalone"` emits a self-contained server with only the modules
# actually reached by the build.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Photos and generated exports live on a bind mount; create the path so the
# first write does not fail on a fresh host.
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
