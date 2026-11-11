# Sourced by the UI-audit scripts: the audit database, its uploads, its own
# port. Nothing here touches the test database the suites use (`quicktec`), and
# everything the scripts write goes under .audit/ at the repository root, which
# git ignores.
#
# The Postgres it expects is the development one: version 16 on port 5433 with
# its socket in /tmp and trust authentication, as set up in CLAUDE.md. Point
# PG_BIN and PGDATA_DIR elsewhere if yours lives somewhere else.
REPO="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
AUDIT_OUT="$REPO/.audit"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PGDATA_DIR="${PGDATA_DIR:-/var/lib/postgresql/qtdata}"
set -a
. "$REPO/.env"
DATABASE_URL="postgresql://quicktec@localhost:5433/quicktec_audit?schema=public"
UPLOADS_DIR="$REPO/data/uploads-audit"
AUTH_URL="http://127.0.0.1:3100"
BASE_URL="http://127.0.0.1:3100"
CHROMIUM_PATH="${CHROMIUM_PATH:-/opt/pw-browsers/chromium}"
QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1
set +a

# Starts the development Postgres if it is not answering.
audit_postgres_up() {
  if ! psql -h /tmp -p 5433 -U postgres -Atc "select 1" >/dev/null 2>&1; then
    su postgres -c "$PG_BIN/pg_ctl -D $PGDATA_DIR -o '-p 5433 -k /tmp' -l $PGDATA_DIR/log.txt start" >/dev/null 2>&1
    for i in 1 2 3 4 5 6 7 8 9 10; do
      psql -h /tmp -p 5433 -U postgres -Atc "select 1" >/dev/null 2>&1 && break
      sleep 1
    done
  fi
}
