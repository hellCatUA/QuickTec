#!/bin/sh
# Applies migrations and seeds, with a bound on how long it will wait for a lock.
#
# A schema change needs ACCESS EXCLUSIVE on the tables it touches, and the app
# container is still serving while this runs — `docker compose up` starts the
# migrator alongside the old app rather than instead of it. One open
# transaction on the wrong table and the ALTER waits forever; worse, once it is
# queued every other query on that table queues behind it, so the running app
# freezes too and never releases what the migration is waiting for.
#
# lock_timeout turns that from a deploy that hangs until somebody notices into
# one that fails in seconds and says why. The old app carries on serving in the
# meantime, which is the point of not having stopped it.
set -e

: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${MIGRATE_LOCK_TIMEOUT:=15s}"

# Postgres reads `options` as session startup flags. Prisma passes the
# parameter through to the connection, so this applies to the migration engine
# itself rather than to anything we would have to remember to wrap.
case "$DATABASE_URL" in
  *lock_timeout*) ;;
  *\?*) DATABASE_URL="${DATABASE_URL}&options=-c%20lock_timeout%3D${MIGRATE_LOCK_TIMEOUT}" ;;
  *)    DATABASE_URL="${DATABASE_URL}?options=-c%20lock_timeout%3D${MIGRATE_LOCK_TIMEOUT}" ;;
esac
export DATABASE_URL

# A migration that timed out on a lock leaves a row behind saying it failed,
# and Prisma then refuses every later deploy until somebody marks it resolved.
# Without this, giving up on the lock would only trade a deploy that hangs for
# one that is stuck permanently.
#
# Only ever swept up when applied_steps_count is 0 — nothing ran, so there is
# nothing to undo. A failure that got partway through is a real question about
# the state of the database and stays for a person to answer.
sweep_clean_failure() {
  # psql rejects Prisma's own query parameters — `schema` is not a libpq one —
  # so it gets the bare URL. Nothing here needs them.
  if ! name=$(psql "${DATABASE_URL%%\?*}" -Atc "
    SELECT migration_name FROM \"_prisma_migrations\"
    WHERE finished_at IS NULL
      AND rolled_back_at IS NULL
      AND applied_steps_count = 0
    ORDER BY started_at DESC LIMIT 1;")
  then
    # Said out loud rather than swallowed: a sweep that silently does nothing
    # is how a deploy stays stuck with no sign of why.
    echo "Could not check for a failed migration to clear." >&2
    return 0
  fi

  [ -n "$name" ] || return 0

  echo "Clearing the record of ${name}, which failed before applying anything."
  npx prisma migrate resolve --rolled-back "$name"
}

sweep_clean_failure

if npx prisma migrate deploy; then
  npx prisma db seed
  exit 0
fi

# Leave the database in a state the next deploy can simply retry.
sweep_clean_failure

cat >&2 <<EOF

------------------------------------------------------------------------
The migration did not go through. If the log above says "lock timeout", it
waited ${MIGRATE_LOCK_TIMEOUT} for a table and gave up.

Almost always that is the previous release still serving: the app holds a
connection to a table the migration has to rewrite. Stop it, then deploy:

    docker compose stop app
    docker compose up -d --build

Nothing has been half-applied — each migration runs in its own transaction,
and the record of the attempt has been cleared so the next run starts fresh.

To see who was holding the table:

    docker compose exec db psql -U \${POSTGRES_USER:-quicktec} \\
      -d \${POSTGRES_DB:-quicktec} -c "SELECT pid, state, \\
      now()-xact_start AS age, pg_blocking_pids(pid) AS blocked_by, \\
      left(query,80) FROM pg_stat_activity ORDER BY xact_start;"
------------------------------------------------------------------------
EOF
exit 1
