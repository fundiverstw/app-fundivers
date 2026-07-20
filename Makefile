.PHONY: help dev studio mail start stop status reset diff link pull push dump-data backup-prod repair-history verify test test-only security lint lint-fix typecheck deploy deploy-app deploy-push deploy-functions wix-sync wix-sync-pull

help:
	@echo "Local dev:"
	@echo "  make dev         — start Vite against the local supabase stack"
	@echo "  make studio      — open Supabase Studio (DB browser) in your browser"
	@echo "  make mail        — open Inbucket (local email inbox) in your browser"
	@echo ""
	@echo "Supabase stack:"
	@echo "  make start       — boot local stack"
	@echo "  make stop        — tear down local stack"
	@echo "  make status      — print local URLs + keys"
	@echo "  make reset       — wipe local db and reapply migrations + seed.sql"
	@echo "  make diff        — show schema drift between local db and migrations"
	@echo "  make link        — link repo to cloud project"
	@echo "  make pull        — pull cloud schema into a new migration"
	@echo "  make push        — push local migrations to cloud"
	@echo "  make dump-data   — dump cloud data into supabase/seed.sql"
	@echo "  make backup-prod — snapshot the linked PROD db (schema+data+roles) to backups/ — run on a networked machine, before a risky migration"
	@echo "  make repair-history — one-time: reconcile the prod migration registry to the squashed baseline (run before the first push after squashing)"
	@echo "  make verify      — check local is in sync with cloud (schema + row counts)"
	@echo ""
	@echo "Testing:"
	@echo "  make test        — the gate: typecheck + lint + every local test (unit + component + integration + security)"
	@echo "  make test-only   — just the test run, skipping typecheck and lint"
	@echo "  make security    — run only the black-box attacker probes in tests/security/"
	@echo "  make lint        — run eslint over the SPA + tests"
	@echo "  make lint-fix    — run eslint with --fix to auto-correct what it can"
	@echo "  make typecheck   — run tsc --noEmit (no build, just type validation)"
	@echo ""
	@echo "Deploy:"
	@echo "  make deploy            — deploy both workers (SPA + push cron) + edge functions"
	@echo "  make deploy-app        — deploy just the SPA (app-fundiverstw)"
	@echo "  make deploy-push       — deploy just the push cron (fundivers-push)"
	@echo "  make deploy-functions  — deploy all supabase edge functions in supabase/functions/"
	@echo ""
	@echo "Wix CMS (Supabase -> Wix):"
	@echo "  make wix-sync         — push-based full sync via the wix_sync_all() RPC (all collections; TABLE=events for one)"
	@echo "  make wix-sync-pull    — fallback: have Wix pull from Supabase (POST /_functions/syncSupabase)"

start:      ; @npm run db:start
stop:       ; @npm run db:stop
status:     ; @npm run db:status
reset:
	@# The CLI's post-reset "Restarting containers..." step often returns 502
	@# while migrations + seeds did apply cleanly — Kong/PostgREST are still
	@# pointing at the pre-reset DB. Restart them unconditionally so the
	@# stack is usable on the next command, then propagate the CLI's exit
	@# code so genuine migration failures still surface.
	@npm run db:reset; status=$$?; \
	  docker restart supabase_rest_app-fundivers supabase_kong_app-fundivers >/dev/null 2>&1 || true; \
	  exit $$status
diff:       ; @npm run db:diff
link:       ; @npm run db:link
pull:       ; @npm run db:pull
push:       ; @npm run db:push
dump-data:  ; @npm run db:dump-data
backup-prod: ; @npm run db:backup-prod
repair-history: ; @npm run db:repair-history
verify:     ; @bash scripts/verify-sync.sh
test:       typecheck lint test-only
test-only:  ; @npm run test:all
security:   ; @npx vitest run --project security
lint:       ; @npm run lint
lint-fix:   ; @npm run lint:fix
typecheck:  ; @npx tsc -b

# Cloudflare Worker deploys read their creds (CLOUDFLARE_API_TOKEN,
# CLOUDFLARE_ACCOUNT_ID) and the cloud VITE_* build vars from .env.production,
# so a deploy is non-interactive and reproducible — no `wrangler login`, no
# GitHub Actions secrets needed. REQUIRE_CF fails fast with a clear message when
# those creds are missing; it sources .env.production in its own sub-shell so
# nothing leaks into the vite build (which loads .env.production itself).
REQUIRE_CF = if [ ! -f .env.production ]; then echo "ERROR: .env.production not found — see docs/deployment.md"; exit 1; fi; \
	set -a; . ./.env.production; set +a; \
	if [ -z "$$CLOUDFLARE_API_TOKEN" ] || [ -z "$$CLOUDFLARE_ACCOUNT_ID" ]; then \
	  echo "ERROR: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env.production"; \
	  echo "  Token (Edit Cloudflare Workers template): https://dash.cloudflare.com/profile/api-tokens"; \
	  exit 1; \
	fi

deploy: deploy-app deploy-push deploy-functions

deploy-app:
	@$(REQUIRE_CF)
	@npm run build
	@set -a; . ./.env.production; set +a; npx wrangler deploy

deploy-push:
	@$(REQUIRE_CF)
	@if [ ! -d workers/push/node_modules ]; then \
	  echo "Installing workers/push deps…"; \
	  (cd workers/push && npm install); \
	fi
	@set -a; . ./.env.production; set +a; cd workers/push && npx wrangler deploy

deploy-functions: ; @npm run functions:deploy

# Push-based full Wix sync (Supabase -> Wix): re-emit every catalog/event row
# through the wix_sync_all() RPC, which POSTs each to the Wix webhook. Reads the
# cloud URL + service-role key from .env.production (the RPC is service-role
# only). TABLE=<name> syncs one collection instead of all. This hits PRODUCTION
# Wix; the DB's wix_sync_token vault secret must be set or the RPC errors.
wix-sync:
	@if [ ! -f .env.production ]; then echo "ERROR: .env.production not found — see docs/deployment.md"; exit 1; fi
	@set -a; . ./.env.production; set +a; \
	  if [ -z "$$VITE_SUPABASE_URL" ] || [ -z "$$SUPABASE_SERVICE_ROLE_KEY" ]; then \
	    echo "ERROR: set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.production"; exit 1; \
	  fi; \
	  echo "Pushing $(if $(TABLE),collection '$(TABLE)',all collections) from Supabase to Wix via wix_sync_all()…"; \
	  curl -sS --fail-with-body -X POST \
	    -H "apikey: $$SUPABASE_SERVICE_ROLE_KEY" \
	    -H "Authorization: Bearer $$SUPABASE_SERVICE_ROLE_KEY" \
	    -H 'Content-Type: application/json' \
	    -w '\nHTTP %{http_code}\n' \
	    -d '$(if $(TABLE),{"p_table":"$(TABLE)"},{})' \
	    "$$VITE_SUPABASE_URL/rest/v1/rpc/wix_sync_all"

# Fallback (Wix -> Supabase pull): have the Wix site re-read every collection in
# its SYNC_TABLES from Supabase. Prefer `make wix-sync` (push); this exists for
# recovery if the push path ever drifts. .env.local is sourced on demand.
wix-sync-pull:
	@if [ -f .env.local ] && [ -z "$$WIX_SYNC_TOKEN" ]; then \
	  set -a && . ./.env.local && set +a; \
	fi; \
	if [ -z "$$WIX_SYNC_TOKEN" ]; then \
	  echo "WIX_SYNC_TOKEN is not set in your shell or .env.local. See ignore/wix/README.md."; \
	  exit 1; \
	fi; \
	echo "Triggering Wix re-sync of every collection in SYNC_TABLES…"; \
	curl -sS --fail-with-body -X POST \
	  -H 'Content-Type: application/json' \
	  -H "x-sync-token: $$WIX_SYNC_TOKEN" \
	  -w '\nHTTP %{http_code}\n' \
	  https://fundiverstw.com/_functions/syncSupabase

dev:
	@if ! docker ps --format '{{.Names}}' | grep -q supabase_db_app-fundivers; then \
	  echo "Local supabase stack not running — starting it first…"; \
	  npm run db:start; \
	fi
	@npm run dev

studio: ; @command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:64323 || echo "Open http://127.0.0.1:64323"
mail:   ; @command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:64324 || echo "Open http://127.0.0.1:64324"
