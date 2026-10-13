#!/usr/bin/env bash
# Read-only PostgreSQL preview. No Docker daemon, deployment or database writes.
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
COMMON_OPTS=()
while (( $# )); do
  case "$1" in
    --env-file)
      shift
      [[ $# ]] || die '--env-file needs a path'
      ENV_FILE=$1 ;;
    -h|--help)
      print_help 'Preview PostgreSQL tuning without starting the database.' \
        'scripts/tune.sh [--env-file PATH]' '--env-file PATH       read this configuration file'
      exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done
require_env_file
postgres_tune --print
