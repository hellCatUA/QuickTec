#!/bin/sh
# Drops and rebuilds the audit database: migrations, seed, fixtures, demo data.
# Only ever the one called quicktec_audit, on the development Postgres.
#
#   sh scripts/ui-audit/rebuild-db.sh
set -e
. "$(git rev-parse --show-toplevel)/scripts/ui-audit/env.sh"
cd "$REPO"
P="-h /tmp -p 5433"

audit_postgres_up

dropdb $P -U postgres --if-exists --force quicktec_audit
createdb $P -U postgres -O quicktec quicktec_audit
rm -rf "$UPLOADS_DIR"
mkdir -p "$UPLOADS_DIR"

npx prisma migrate deploy 2>&1 | tail -1
npm run db:seed 2>&1 | tail -1
npm run fixtures 2>&1 | tail -1
npx tsx --tsconfig tsconfig.json scripts/ui-audit/demo-data.ts
