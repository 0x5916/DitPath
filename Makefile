# DitPath operational helpers.
#
# Every target delegates to a script in scripts/. The scripts are the source of
# truth so that `make` is never the only way to do something, and so the logic
# stays testable on its own.
#
# Examples:
#   make                      # list targets
#   make check                # validate .env
#   make deploy               # first-time install
#   make deploy YES=1         # ... without prompting for the JWT secret
#   make update               # backup, pull, rebuild, verify
#   make update DRY_RUN=1     # show what an update would do
#   make update REF=v1.2.0    # update to a specific ref
#   make backup KEEP=30       # keep 30 dumps
#   make restore FILE=backups/opencw_20260928T101500Z.sql.gz
#   make status               # health, versions, disk usage

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

SCRIPTS := scripts

DRY_RUN ?= 0
YES ?= 0
NO_BACKUP ?= 0
KEEP ?=
FILE ?=
REF ?=
TIMEOUT ?=
# Pass these as quoted arguments; automatic export would expand literal Make syntax.
unexport FILE REF KEEP TIMEOUT

_DRY := $(if $(filter 1 true yes,$(DRY_RUN)),--dry-run,)
_YES := $(if $(filter 1 true yes,$(YES)),--yes,)
_NO_BACKUP := $(if $(filter 1 true yes,$(NO_BACKUP)),--no-backup,)
shell_quote = '$(subst ','"'"',$(1))'
_KEEP := $(if $(value KEEP),--keep $(call shell_quote,$(value KEEP)),)
_FILE := $(if $(value FILE),--file $(call shell_quote,$(value FILE)),)
_REF := $(if $(value REF),--ref $(call shell_quote,$(value REF)),)
_TIMEOUT := $(if $(value TIMEOUT),--timeout $(call shell_quote,$(value TIMEOUT)),)

.PHONY: help check tune deploy update backup restore status

help:
	@printf '%s\n' \
	  'DitPath deployment helpers' \
	  '' \
	  'Usage: make <target> [VAR=value]' \
	  '' \
	  'Targets:' \
	  '  help                     show this help (the default target)' \
	  '  check                    validate .env and report every problem at once' \
	  '  tune                     preview PostgreSQL settings and shared-memory capacity' \
	  '  deploy                   build and start the stack, then wait for health' \
	  '  update                   snapshot, back up, pull, rebuild, verify' \
	  '  backup                   pg_dump into backups/ and rotate old dumps' \
	  '  restore                  restore a dump (recreates the database by default)' \
	  '  status                   service health, versions, backups and disk usage' \
	  '' \
	  'Variables:' \
	  '  DRY_RUN=1                print the commands that would run, change nothing' \
	  '  YES=1                    do not prompt for confirmations' \
	  '  KEEP=N                   backup retention (default 14, or $$BACKUP_RETENTION)' \
	  '  FILE=path                dump to restore (default: newest in backups/)' \
	  '  REF=revision             git branch, tag or commit to update to' \
	  '  NO_BACKUP=1              skip the pre-update backup' \
	  '  TIMEOUT=seconds          service wait budget for deploy/update (default 240)' \
	  '' \
	  'Run any script directly for its full option list, e.g. scripts/restore.sh --help'

check:
	@$(SCRIPTS)/check-env.sh

tune:
	@$(SCRIPTS)/tune.sh

deploy:
	@$(SCRIPTS)/deploy.sh $(_DRY) $(_YES) $(_TIMEOUT)

update:
	@$(SCRIPTS)/update.sh $(_DRY) $(_YES) $(_TIMEOUT) $(_REF) $(_NO_BACKUP) $(_KEEP)

backup:
	@$(SCRIPTS)/backup.sh $(_DRY) $(_KEEP)

restore:
	@$(SCRIPTS)/restore.sh $(_DRY) $(_YES) $(_FILE) $(_KEEP)

status:
	@$(SCRIPTS)/status.sh
