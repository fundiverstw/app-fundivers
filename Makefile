.PHONY: help dev studio mail start stop status reset diff link pull push dump-data verify test lint lint-fix typecheck check deploy deploy-app deploy-push deploy-functions

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
	@echo "  make verify      — check local is in sync with cloud (schema + row counts)"
	@echo ""
	@echo "Testing:"
	@echo "  make test        — run every local test (unit + component + integration)"
	@echo "  make lint        — run eslint over the SPA + tests"
	@echo "  make lint-fix    — run eslint with --fix to auto-correct what it can"
	@echo "  make typecheck   — run tsc --noEmit (no build, just type validation)"
	@echo "  make check       — typecheck + lint + test, in that order; pre-deploy gate"
	@echo ""
	@echo "Deploy:"
	@echo "  make deploy            — deploy both workers (SPA + push cron)"
	@echo "  make deploy-app        — deploy just the SPA (app-fundiverstw)"
	@echo "  make deploy-push       — deploy just the push cron (fundivers-push)"
	@echo "  make deploy-functions  — deploy all supabase edge functions in supabase/functions/"

start:      ; @npm run db:start
stop:       ; @npm run db:stop
status:     ; @npm run db:status
reset:      ; @npm run db:reset
diff:       ; @npm run db:diff
link:       ; @npm run db:link
pull:       ; @npm run db:pull
push:       ; @npm run db:push
dump-data:  ; @npm run db:dump-data
verify:     ; @bash scripts/verify-sync.sh
test:       ; @npm run test:all
lint:       ; @npm run lint
lint-fix:   ; @npm run lint:fix
typecheck:  ; @npx tsc -b
check:      typecheck lint test

deploy: deploy-app deploy-push

deploy-app: ; @npm run deploy

deploy-push:
	@if [ ! -d workers/push/node_modules ]; then \
	  echo "Installing workers/push deps…"; \
	  cd workers/push && npm install; \
	fi
	@cd workers/push && npm run deploy

deploy-functions: ; @npm run functions:deploy

dev:
	@if ! docker ps --format '{{.Names}}' | grep -q supabase_db_app-fundivers; then \
	  echo "Local supabase stack not running — starting it first…"; \
	  npm run db:start; \
	fi
	@npm run dev

studio: ; @command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:64323 || echo "Open http://127.0.0.1:64323"
mail:   ; @command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:64324 || echo "Open http://127.0.0.1:64324"
