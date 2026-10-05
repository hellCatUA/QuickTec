# No `# syntax=` directive on purpose.
#
# It tells BuildKit to fetch an external Dockerfile frontend from Docker Hub,
# and because the usual tag is a floating `1`, it re-checks the registry on
# every build rather than trusting the copy it already has. A host with no
# route to the internet then fails before reading line two of this file —
# which is exactly the host this app is deployed on, behind Tailscale, where
# an outage or a move is an ordinary afternoon.
#
# Nothing here needs that frontend: no heredocs, no `RUN --mount`, no
# `COPY --link`. The frontend built into Docker handles all of it. Add the
# directive back only alongside a feature that actually requires it, and know
# that doing so makes every build need the network.

# Debian slim rather than Alpine: sharp's prebuilt libvips binaries are glibc,
# and photo processing is on the critical path for this app.
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# openssl before `npm ci`, not after, and not only in the image that runs the
# engine.
#
# Prisma downloads its engines during install and picks which build by sniffing
# the platform's OpenSSL. The slim image ships no `openssl`, so the sniff falls
# through to a default of 1.1.x — while the migrator image, where openssl *is*
# installed, asks for 3.0.x at runtime, finds no such file, and downloads the
# right one from binaries.prisma.sh on every single deploy.
#
# That was invisible for as long as the host could reach the internet. The
# first deploy without a route out died on `getaddrinfo EAI_AGAIN
# binaries.prisma.sh`, before it had read a line of SQL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

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

# The schema engine is a native binary that links OpenSSL, and the slim image
# ships without it, so it is installed here to run the engine — and in `deps`
# as well, to download the matching one. Installing it in only one of the two
# is what made every deploy reach for the network; see the note there.
# psql is here for one job: reading back whether a failed migration applied
# anything, so a deploy that lost a race for a lock can be retried rather than
# needing somebody to unstick it by hand.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssl ca-certificates postgresql-client \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules

# Name the engine rather than let Prisma work it out again.
#
# Given this path, Prisma uses the file and asks the network nothing; given a
# path that is not there, it stops with "provided path can't be resolved"
# instead of quietly fetching a replacement. A deploy that needs the public
# internet should be a loud failure on the build that introduced it, not a
# dependency nobody knows about until the day the line goes down.
ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x

COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/lib/permissions.ts /app/src/lib/location-defaults.ts ./src/lib/
COPY --from=builder /app/prisma.config.ts /app/package.json /app/tsconfig.json ./
COPY --from=builder /app/scripts/migrate.sh ./scripts/migrate.sh

# The way back in when nobody can sign in — `npm run signin:local`, run as
# `docker compose run --rm migrate npm run signin:local -- --email …`.
#
# It lives in this image because this is the one that has the database URL,
# tsx and the Prisma client, and needs no session: the case it exists for is
# NextCloud being unreachable, which is also the case where nobody can get
# into the app to do anything from a screen. It needs exactly these files and
# nothing else; the command was documented for a whole release before anybody
# noticed none of them were here, and it would have failed with "Cannot find
# module" on the one day it was wanted.
COPY --from=builder /app/scripts/local-signin.ts ./scripts/local-signin.ts
COPY --from=builder /app/src/lib/db.ts /app/src/lib/audit.ts \
     /app/src/lib/password.ts /app/src/lib/password-rules.ts ./src/lib/
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

# The font the photo stamp is drawn in. This image installs none of its own,
# and text with no font to render it in draws nothing at all — the stamp's
# background appears and the date and site number do not, which is a photo
# nobody can tie to a job. Carried rather than assumed, so the same bytes are
# used here and in development.
COPY --from=builder --chown=nextjs:nodejs /app/assets ./assets

# Photos and generated exports live on a bind mount; create the path so the
# first write does not fail on a fresh host.
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
