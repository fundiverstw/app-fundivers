#!/usr/bin/env bash
# Typecheck every Deno edge function.
#
# `tsc -b` does not see supabase/functions/ — those files use jsr:/npm:/https:
# specifiers Node cannot resolve, so they are excluded from the TS projects.
# That leaves a whole class of bug invisible until deploy, where it surfaces as
# the function 503-ing on boot: a bad import path, a missing .ts extension on a
# relative import, a renamed export in _shared/.
#
# Deno's own checker is the only thing that reads these files the way the edge
# runtime does. It is deliberately pointed at scripts/deno-check.json rather
# than a config inside supabase/functions/, which the Supabase runtime would
# also read, and that config sets nodeModulesDir=none so a check can never
# rewrite the repo's npm-managed node_modules.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v deno >/dev/null 2>&1; then
  echo "check-edge: deno is not installed — see https://deno.land/#installation" >&2
  exit 1
fi

# Every function's entrypoint. _shared/ is not listed: it has no entrypoint of
# its own and is reached through the imports below, so a break in it fails the
# function that uses it (which is the failure that matters).
mapfile -t entrypoints < <(find supabase/functions -mindepth 2 -maxdepth 2 -name 'index.ts' | sort)

if [ ${#entrypoints[@]} -eq 0 ]; then
  echo "check-edge: no edge functions found" >&2
  exit 1
fi

echo "check-edge: checking ${#entrypoints[@]} edge functions"
deno check --config scripts/deno-check.json "${entrypoints[@]}"
