#!/bin/sh
# Applies the handoff schema plus the app functions, then runs the handoff's own
# database-level acceptance harness (§16). Every result line must say PASS.
set -e

PSQL=$(command -v psql || echo /opt/homebrew/opt/postgresql@16/bin/psql)
URL=${TEST_DATABASE_URL:-postgresql://postgres@127.0.0.1:55432/onmic_test}

if [ ! -x "$PSQL" ]; then
  echo "psql not found. Install PostgreSQL client tools, or set PATH."
  exit 1
fi

"$PSQL" "$URL" -q -v ON_ERROR_STOP=1 -f handoff/supabase/schema.sql >/dev/null
"$PSQL" "$URL" -q -v ON_ERROR_STOP=1 -f supabase/app.sql >/dev/null

OUT=$("$PSQL" "$URL" -f handoff/supabase/tests.sql 2>&1)
echo "$OUT" | grep -E "PASS:|FAIL|settlement|confirmed=" || true

if echo "$OUT" | grep -q "FAIL"; then
  echo "database acceptance harness FAILED"
  exit 1
fi
echo "database acceptance harness: all PASS"
