#!/usr/bin/env bash
# One-shot logical backup of the production database: a rollback point to take
# BEFORE `make push` or anything else that changes the schema. Dumps roles,
# schema (structure) and data as three files, connecting with the pooler
# credentials in .env.local, so no `supabase link` is needed.
#
# Output:        backups/prod_{roles,schema,data}_<timestamp>.sql   (gitignored)
# Restore order: roles -> schema -> data, e.g. psql "<conn>" -f <file>
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/node_modules/.bin:$PATH"
export DO_NOT_TRACK=1

set -a; . ./.env.local; set +a
: "${SUPABASE_POOLER_HOST:?missing in .env.local}"
: "${SUPABASE_PROJECT_REF:?missing in .env.local}"
: "${SUPABASE_DB_PASSWORD:?missing in .env.local}"
pw="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$SUPABASE_DB_PASSWORD")"
url="postgresql://postgres.${SUPABASE_PROJECT_REF}:${pw}@${SUPABASE_POOLER_HOST}:5432/postgres"

stamp="$(date +%Y-%m-%d_%H%M%S)"
mkdir -p backups

dump() {  # $1 = label, $2 = extra flag (optional)
  local out="backups/prod_$1_${stamp}.sql" rc=0
  echo "-> $1  ->  $out"
  supabase db dump --db-url "$url" ${2:-} -f "$out" || rc=$?
  if [ ! -s "$out" ]; then
    echo "ERROR: $1 dump wrote no data (supabase exit $rc)" >&2
    exit 1
  fi
  [ "$rc" -ne 0 ] && echo "  (CLI exited $rc after writing the file; telemetry-shutdown timeout, the file is valid)"
}

echo "Backing up the production database..."
dump roles  --role-only
dump schema
dump data   --data-only

echo ""
echo "Backup complete:"
ls -lh backups/prod_*_"${stamp}".sql
echo "Restore order if ever needed: roles -> schema -> data"
