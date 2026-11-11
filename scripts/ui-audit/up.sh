#!/bin/sh
# Brings the audit environment up: Postgres on 5433 and the built app on 3100
# against the audit database. Safe to run again; `up.sh restart` restarts the
# app, which is what to do after a new build.
#
#   sh scripts/ui-audit/up.sh [restart]
. "$(git rev-parse --show-toplevel)/scripts/ui-audit/env.sh"
cd "$REPO"
mkdir -p "$AUDIT_OUT/logs"

audit_postgres_up
psql -h /tmp -p 5433 -U postgres -Atc "select 'postgres up'" 2>&1 | head -1

if [ "$1" = "restart" ]; then
  fuser -k 3100/tcp >/dev/null 2>&1
  sleep 1
fi

if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/signin 2>/dev/null)" != "200" ]; then
  cp -r .next/static .next/standalone/.next/ 2>/dev/null
  cp -r public .next/standalone/ 2>/dev/null
  (cd .next/standalone && PORT=3100 HOSTNAME=127.0.0.1 nohup node server.js > "$AUDIT_OUT/logs/audit-server.log" 2>&1 &)
  for i in $(seq 1 40); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/signin 2>/dev/null)" = "200" ] && break
    sleep 1
  done
fi
echo "audit app $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/signin)"
