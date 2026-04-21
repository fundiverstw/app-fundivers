.PHONY: help start stop status reset diff link pull push dump-data verify

help:
	@echo "Supabase local dev targets:"
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
