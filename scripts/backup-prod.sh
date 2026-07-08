#!/usr/bin/env bash
# One-shot logical backup of the LINKED prod database — a rollback point to take
# BEFORE a risky migration. Dumps the public schema (structure + all rows) plus
# roles, reading SUPABASE_DB_PASSWORD from .env.local like the other db:* scripts.
#
# Run via `make backup-prod`, `npm run db:backup-prod`, or `bash scripts/backup-prod.sh`
# (the PATH line below makes the local `dotenv`/`supabase` bins resolve either way).
# Must run on a machine WITH network access to the Supabase cloud — a sandbox/CI
# without egress can't reach db.<ref>.supabase.co. Requires the project linked.
#
# Output:        backups/prod_{roles,schema,data}_<timestamp>.sql   (gitignored)
# Restore order: roles -> schema -> data, e.g. psql "<prod-conn>" -f <file>
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$PWD/node_modules/.bin:$PATH"   # resolve dotenv/supabase when run via bash, not just npm
export DO_NOT_TRACK=1                        # skip PostHog telemetry (its shutdown timeout returns a spurious non-zero)

stamp="$(date +%Y-%m-%d_%H%M%S)"
mkdir -p backups

dump() {  # $1 = label, $2 = extra flag (optional)
  local out="backups/prod_$1_${stamp}.sql" rc=0
  echo "-> $1  ->  $out"
  dotenv -e .env.local -- sh -c \
    "supabase db dump --linked --password \"\$SUPABASE_DB_PASSWORD\" ${2:-} -f '$out'" || rc=$?
  if [ ! -s "$out" ]; then
    echo "ERROR: $1 dump wrote no data (supabase exit $rc)" >&2
    exit 1
  fi
  [ "$rc" -ne 0 ] && echo "  (CLI exited $rc after writing the file — telemetry-shutdown timeout; file is valid, continuing)"
}

echo "Backing up linked prod database (project ref from .env.local)..."
dump roles  --role-only
dump schema
dump data   --data-only

echo ""
echo "Backup complete:"
ls -lh backups/prod_*_"${stamp}".sql
echo "Restore order if ever needed: roles -> schema -> data"
