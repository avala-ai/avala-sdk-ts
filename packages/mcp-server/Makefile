# MCP server eval harness.
#
#   make eval                 run every runnable task, 5 trials each, against cassettes
#   make eval TASK=read-ops   run one task, suite or category
#   make eval TRIALS=1        override the trial count
#   make eval-record          re-record cassettes from the real API (needs AVALA_API_KEY)
#   make eval-test            the CI-side leakage gate over committed cassettes
#
# The runner drives a real model, so `make eval` costs money. `make eval-test`
# does not — it is pure static analysis of what is committed.

PKG_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
TRIALS ?= 5
CONCURRENCY ?= 8

# `--task` is only passed when TASK is set, so an unset TASK runs everything.
TASK_ARG := $(if $(TASK),--task $(TASK),)

.PHONY: eval eval-record eval-test build

## The eval drives `dist/index.js` — the shipped binary, not the TypeScript
## sources — so a stale build would evaluate yesterday's tool surface.
build:
	cd $(PKG_DIR)../sdk && bun run build
	cd $(PKG_DIR) && bun run build

eval: build
	cd $(PKG_DIR) && bun eval/runner.ts --trials $(TRIALS) --concurrency $(CONCURRENCY) $(TASK_ARG)

eval-record: build
	cd $(PKG_DIR) && bun eval/runner.ts --live --trials 1 --concurrency 1 $(TASK_ARG)

eval-test:
	cd $(PKG_DIR) && bunx vitest run test/evalCassettes.test.ts
