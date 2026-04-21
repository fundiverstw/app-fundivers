#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local not found"; exit 1
fi
set -a; . ./.env.local; set +a

: "${SUPABASE_PROJECT_REF:?missing in .env.local}"
: "${SUPABASE_DB_PASSWORD:?missing in .env.local}"
: "${SUPABASE_POOLER_HOST:?missing in .env.local}"

CONTAINER=supabase_db_app-fundivers
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "ERROR: local stack not running ($CONTAINER). Run: make start"; exit 1
fi

echo "━━━ 1/2 Schema migration parity ━━━"
npx supabase migration list --linked
echo

echo "━━━ 2/2 Row counts (public + auth) ━━━"

# Build a single UNION ALL query that counts every table in public + auth.
GEN_UNION_SQL="SELECT string_agg(
  format('SELECT %L AS tbl, count(*)::bigint AS n FROM %I.%I',
         schemaname||'.'||tablename, schemaname, tablename),
  ' UNION ALL ')
FROM pg_tables
WHERE schemaname IN ('public','auth');"

UNION_BODY=$(docker exec "$CONTAINER" psql -U postgres -d postgres -tAc "$GEN_UNION_SQL")
COUNT_SQL="SELECT tbl||E'\t'||n FROM ($UNION_BODY) q ORDER BY 1;"

LOCAL=$(docker exec "$CONTAINER" psql -U postgres -d postgres -tAc "$COUNT_SQL")
CLOUD=$(docker exec -e PGPASSWORD="$SUPABASE_DB_PASSWORD" "$CONTAINER" \
  psql -h "$SUPABASE_POOLER_HOST" -p 5432 \
       -U "postgres.${SUPABASE_PROJECT_REF}" -d postgres -tAc "$COUNT_SQL")

printf '%-40s %10s %10s\n' 'table' 'local' 'cloud'
printf '%-40s %10s %10s\n' '----------------------------------------' '----------' '----------'
join -t $'\t' -a1 -a2 -e '-' -o '0,1.2,2.2' \
  <(printf '%s\n' "$LOCAL" | sort) \
  <(printf '%s\n' "$CLOUD" | sort) \
  | awk -F'\t' '{printf "%-40s %10s %10s\n", $1, $2, $3}'

echo
if [[ "$(printf '%s\n' "$LOCAL" | sort)" == "$(printf '%s\n' "$CLOUD" | sort)" ]]; then
  echo "Result: row counts match"
else
  echo "Result: row counts differ"
fi
