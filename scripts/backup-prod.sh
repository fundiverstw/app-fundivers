#!/usr/bin/env bash
# One-shot logical backup of the LINKED prod database — a rollback point to take
# BEFORE a risky migration. Dumps the public schema (structure + all rows) plus
# roles, reading SUPABASE_DB_PASSWORD from .env.local like the other db:* scripts.
#
# Run via `make backup-prod` (or `npm run db:backup-prod`) so node_modules/.bin
# (dotenv, supabase) is on PATH. Must run on a machine WITH network access to the
# Supabase cloud — a sandbox/CI without egress can't reach db.<ref>.supabase.co.
# Requires the project to be linked already (`make link` if not).
#
# Output:        backups/prod_{roles,schema,data}_<timestamp>.sql   (gitignored)
# Restore order: roles -> schema -> data, e.g. psql "<prod-conn>" -f <file>
set -euo pipefail

cd "$(dirname "$0")/.."

stamp="$(date +%Y-%m-%d_%H%M%S)"
mkdir -p backups

dump() {  # $1 = label, $2 = extra flag (optional)
  local out="backups/prod_$1_${stamp}.sql"
  echo "-> $1  ->  $out"
  dotenv -e .env.local -- sh -c \
    "supabase db dump --linked --password \"\$SUPABASE_DB_PASSWORD\" ${2:-} -f '$out'"
}

echo "Backing up linked prod database (project ref from .env.local)..."
dump roles  --role-only
dump schema
dump data   --data-only

echo ""
echo "Backup complete:"
ls -lh backups/prod_*_"${stamp}".sql
echo "Restore order if ever needed: roles -> schema -> data"
