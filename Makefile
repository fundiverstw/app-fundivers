# FunDivers TW runs the FunDive platform (node_modules/fundive). Every target
# here is a thin wrapper over the `fundive` CLI; the platform holds the code,
# the migrations and the edge functions, this repo holds the shop's config,
# branding and infrastructure names.
#
# Env files, as before the move:
#   .env.local       SUPABASE_* production credentials (db, functions, backups)
#                    and the local-stack VITE_* values for `make dev`
#   .env.production  CLOUDFLARE_* credentials and the production VITE_* values;
#                    a production build reads it automatically

FUNDIVE = npx fundive

.PHONY: help install dev build preview deploy deploy-app deploy-push deploy-functions push adopt backup-prod

help:
	@echo "make install          install the pinned platform (package.json)"
	@echo "make dev              dev server against the local Supabase stack"
	@echo "make build            production build into dist/"
	@echo "make deploy           SPA + push worker + edge functions"
	@echo "make deploy-app       just the SPA worker (app-fundiverstw)"
	@echo "make deploy-push      just the push cron worker (fundivers-push)"
	@echo "make deploy-functions just the edge functions (sets FUNDIVE_CONFIG)"
	@echo "make push             apply the platform's new migrations to production"
	@echo "make adopt            dry run of the one-time registry adoption (docs/cutover.md)"
	@echo "make backup-prod      dump production roles/schema/data into backups/"

install: ; @npm install

dev:     ; @$(FUNDIVE) dev
build:   ; @$(FUNDIVE) build
preview: ; @$(FUNDIVE) preview

# Cloudflare credentials come from .env.production, sourced into the deploy's
# own environment so a missing one fails here, before anything is built.
REQUIRE_CF = if [ ! -f .env.production ]; then echo "ERROR: .env.production not found (see .env.example)"; exit 1; fi; \
	set -a; . ./.env.production; set +a; \
	if [ -z "$$CLOUDFLARE_API_TOKEN" ] || [ -z "$$CLOUDFLARE_ACCOUNT_ID" ]; then \
	  echo "ERROR: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env.production"; exit 1; \
	fi

deploy: deploy-app deploy-push deploy-functions

deploy-app:
	@$(REQUIRE_CF)
	@$(FUNDIVE) build
	@set -a; . ./.env.production; set +a; $(FUNDIVE) deploy

deploy-push:
	@$(REQUIRE_CF)
	@set -a; . ./.env.production; set +a; $(FUNDIVE) deploy push

deploy-functions: ; @$(FUNDIVE) functions deploy

push: ; @$(FUNDIVE) db push

adopt: ; @$(FUNDIVE) db adopt --baseline 20260708090000 --applied-through 20261029120000

backup-prod: ; @bash scripts/backup-prod.sh
