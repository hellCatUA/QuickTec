#!/bin/sh
# Runs the suites one after another against the TEST database (`quicktec`, from
# .env) and the test server on :3000 — not the audit database — and leaves one
# line per suite in .audit/logs/suites.txt, with each suite's full output
# beside it.
#
#   sh scripts/serve.sh &            # or: sh scripts/dev-serve.sh, after a build
#   sh scripts/ui-audit/suites.sh [suite ...]    # default: all of them, in order
#
# The order matters: `verify` deletes the job the browser suites drive, so
# `fixtures` follows it. verify:auth is not here — it needs a server of its own
# (see CLAUDE.md).
REPO="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO"
export CHROMIUM_PATH="${CHROMIUM_PATH:-/opt/pw-browsers/chromium}" QUICKTEC_ALLOW_DESTRUCTIVE_VERIFY=1
LOGS="$REPO/.audit/logs"
mkdir -p "$LOGS"
OUT="$LOGS/suites.txt"
: > "$OUT"

if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/signin 2>/dev/null)" != "200" ]; then
  echo "test server on :3000 is not up" | tee -a "$OUT"
  exit 1
fi

run() {
  name="$1"
  log="$LOGS/suite-$(echo "$name" | tr ':' '-').log"
  npm run "$name" > "$log" 2>&1
  code=$?
  echo "$name exit=$code pass=$(grep -c '^PASS' "$log") fail=$(grep -c '^FAIL' "$log")" >> "$OUT"
}

SUITES="$*"
[ -z "$SUITES" ] && SUITES="verify fixtures verify:ui verify:approvals verify:pay verify:forms verify:draft verify:form-pages verify:images verify:profiles verify:signin verify:deliverables verify:budget"
for suite in $SUITES; do
  run "$suite"
done
echo "done" >> "$OUT"
cat "$OUT"
