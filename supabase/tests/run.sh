#!/usr/bin/env bash
# Apply every migration to a fresh local database, then run the SQL tests.
#   PGHOST=/var/tmp/pgt PGPORT=5499 PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-masea_test}
dropdb --if-exists "$DB" && createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/00_supabase_shim.sql
for f in migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null || { echo "FAILED: $f"; exit 1; }
done
echo "migrations: OK ($(ls migrations/*.sql | wc -l))"
for t in tests/[1-9]*.sql; do
  [ -e "$t" ] || continue
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t" || { echo "TEST FAILED: $t"; exit 1; }
  echo "test: OK $t"
done
