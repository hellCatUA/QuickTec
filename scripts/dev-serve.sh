#!/bin/sh
# Serves the production build on port 3000, for the browser suites.
#
# `next start` cannot run this app: the build is output: "standalone", and Next
# refuses, pointing at .next/standalone/server.js instead. That server expects
# the static assets and public/ beside it, which the build does not copy, so
# without this the app comes up unstyled and every visual check is meaningless.
#
# Also frees the port first. The standalone server renames its process to
# "next-server (vX)", so an earlier run is not where you go looking for it, and
# starting over it fails with EADDRINUSE rather than replacing it.
set -e
cd "$(dirname "$0")/.."

cp -r .next/static .next/standalone/.next/ 2>/dev/null || true
cp -r public .next/standalone/ 2>/dev/null || true

fuser -k 3000/tcp 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true

waited=0
while ss -lnt 2>/dev/null | grep -q ':3000 '; do
  waited=$((waited + 1))
  if [ "$waited" -gt 20 ]; then
    echo "port 3000 is still held; stop whatever has it and try again" >&2
    exit 1
  fi
  sleep 1
done

set -a
. ./.env
set +a
cd .next/standalone
exec env PORT="${PORT:-3000}" HOSTNAME="${HOSTNAME:-127.0.0.1}" node server.js
