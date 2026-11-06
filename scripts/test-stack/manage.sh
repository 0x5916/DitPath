#!/usr/bin/env bash
# Disposable full-stack DitPath acceptance environment. Never touches the
# production Compose project or any resource outside this script's project.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRONTEND="$REPO_ROOT/frontend"
COMPOSE_FILE="$SCRIPT_DIR/compose.yaml"
RUNTIME="$SCRIPT_DIR/runtime"
STACK_ENV="$RUNTIME/stack.env"
PROJECT="ditpath-final-acceptance"
FRONTEND_REBUILT=0

usage() {
  cat <<'EOF'
Usage: scripts/test-stack/manage.sh COMMAND [options]

Commands:
  start           Start the stack; build only when its build is missing.
                  Existing test data is preserved.
  reset --yes     Stop and remove ONLY this project's containers, network,
                  database volume and runtime credentials, then start fresh.
  status          Show container health, URLs, database readiness and counts.
  logs [service]  Follow frontend/backend/database logs (or one service).
  stop            Stop the containers; preserve the database and credentials.
  clean --yes     Stop and remove ONLY this project's containers, network,
                  database volume and runtime credentials.
  accounts        Print the disposable account credentials.
  sample          Add optional forum and training sample data.
  check-api       Run real API acceptance checks (adds synthetic data).
  check-guided    Complete one real guided lesson in Chromium.
  smoke           Run browser smoke checks against the running stack.

The destructive commands print the exact project-scoped resources first.
They never use docker system prune, docker volume prune, or a broad rm.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_node() {
  if [[ -x /opt/homebrew/opt/node/bin/node ]]; then
    PATH="/opt/homebrew/opt/node/bin:$PATH"
    export PATH
  fi
  command -v node >/dev/null 2>&1 || die "Node 26 is required"
  local major
  major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  (( major >= 26 )) || die "Node 26 is required; found $(node --version)"
}

source_revision() {
  local revision
  revision="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
  if ! git -C "$REPO_ROOT" diff --quiet -- backend; then
    revision="${revision}-dirty"
  fi
  printf '%s' "$revision"
}

run_compose() {
  SOURCE_REVISION="$(source_revision)" \
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$STACK_ENV" "$@"
}

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$STACK_ENV" | head -n 1
}

ensure_environment() {
  mkdir -p "$RUNTIME"
  chmod 700 "$RUNTIME"
  if [[ -f "$STACK_ENV" ]]; then
    return
  fi
  if [[ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ]]; then
    die "Test containers exist without $STACK_ENV; run reset --yes to recreate safely"
  fi

  local password jwt frontend_port api_port db_port
  password="$(openssl rand -hex 24)"
  jwt="$(openssl rand -base64 48 | tr -d '\n')"
  frontend_port="${TEST_FRONTEND_PORT:-13000}"
  api_port="${TEST_API_PORT:-18080}"
  db_port="${TEST_DB_PORT:-15432}"

  umask 077
  cat >"$STACK_ENV" <<EOF
POSTGRES_USER=ditpath_acceptance
POSTGRES_PASSWORD=$password
POSTGRES_DB=ditpath_acceptance
JWT_SECRET=$jwt
TEST_FRONTEND_PORT=$frontend_port
TEST_API_PORT=$api_port
TEST_DB_PORT=$db_port
EOF
  chmod 600 "$STACK_ENV"
}

render_nginx() {
  python3 - "$FRONTEND/nginx.conf" "$RUNTIME/nginx.conf" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
anchor = "    location / {\n"
if source.count(anchor) != 1:
    raise SystemExit("Review frontend/nginx.conf: expected exactly one location / block")
proxy = """    # Test stack only: same-origin API through the frontend container.
    location /v1/ {
        proxy_pass http://backend:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }

"""
Path(sys.argv[2]).write_text(source.replace(anchor, proxy + anchor))
PY
  chmod 644 "$RUNTIME/nginx.conf"
}

frontend_fingerprint() {
  printf '%s:%s' \
    "$(git -C "$REPO_ROOT" rev-parse HEAD)" \
    "$(git -C "$REPO_ROOT" status --porcelain -- frontend | shasum -a 256 | awk '{print $1}')"
}

build_frontend() {
  [[ -d "$FRONTEND/node_modules/.bin" ]] || (cd "$FRONTEND" && npm ci)
  local marker="$FRONTEND/build/.ditpath-final-acceptance-build"
  local frontend_port expected
  frontend_port="$(env_value TEST_FRONTEND_PORT)"
  expected="api=/v1 origin=http://127.0.0.1:$frontend_port fingerprint=$(frontend_fingerprint)"
  if [[ -f "$marker" && "$(cat "$marker")" == "$expected" ]]; then
    return
  fi

  printf 'building frontend for /v1 and http://127.0.0.1:%s\n' "$frontend_port"
  (
    cd "$FRONTEND"
    PUBLIC_API_BASE=/v1 \
      PUBLIC_GOOGLE_CLIENT_ID= \
      PRERENDER_ORIGIN="http://127.0.0.1:$frontend_port" \
      npm run build
  )
  printf '%s\n' "$expected" >"$marker"
  FRONTEND_REBUILT=1
}

build_backend() {
  local image
  image="ditpath-final-acceptance-backend:$(source_revision)"
  if docker image inspect "$image" >/dev/null 2>&1; then
    return
  fi
  printf 'building backend image %s\n' "$image"
  run_compose build backend
}

wait_for_url() {
  local url="$1" label="$2" attempts="${3:-60}" count=1
  while (( count <= attempts )); do
    if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    count=$((count + 1))
  done
  die "$label did not become ready at $url"
}

wait_for_stack() {
  local api_port frontend_port
  api_port="$(env_value TEST_API_PORT)"
  frontend_port="$(env_value TEST_FRONTEND_PORT)"
  wait_for_url "http://127.0.0.1:$api_port/v1/health" "backend"
  wait_for_url "http://127.0.0.1:$frontend_port/en" "frontend"
  wait_for_url "http://127.0.0.1:$frontend_port/v1/health" "same-origin API proxy"
}

provision_accounts_if_missing() {
  if [[ ! -f "$RUNTIME/accounts.json" ]]; then
    node "$SCRIPT_DIR/provision.mjs" accounts --runtime "$RUNTIME"
  fi
}

stack_status() {
  local api_port frontend_port health=0 frontend_ok=0 db_ok=0
  api_port="$(env_value TEST_API_PORT)"
  frontend_port="$(env_value TEST_FRONTEND_PORT)"

  echo "Compose project: $PROJECT"
  echo "Containers:"
  docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
    --format '  {{.Names}}  {{.Status}}  {{.Ports}}'
  echo "Volume:"
  docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | sed 's/^/  /'

  if curl --fail --silent --show-error --max-time 3 \
    "http://127.0.0.1:$api_port/v1/health"; then
    echo
    health=1
  else
    echo "backend health: unavailable"
  fi
  if curl --fail --silent --show-error --max-time 3 \
    "http://127.0.0.1:$frontend_port/v1/health" >/dev/null; then
    echo "same-origin API proxy: healthy"
  else
    echo "same-origin API proxy: unavailable"
  fi
  if curl --fail --silent --show-error --max-time 3 \
    "http://127.0.0.1:$frontend_port/en" >/dev/null; then
    echo "frontend: healthy"
    frontend_ok=1
  else
    echo "frontend: unavailable"
  fi
  if run_compose exec -T db pg_isready \
    -U "$(env_value POSTGRES_USER)" -d "$(env_value POSTGRES_DB)" >/dev/null 2>&1; then
    echo "database: ready"
    db_ok=1
  else
    echo "database: unavailable"
  fi

  if (( db_ok )); then
    local db_user db_name
    db_user="$(env_value POSTGRES_USER)"
    db_name="$(env_value POSTGRES_DB)"
    echo "Rows:"
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$STACK_ENV" \
      exec -T db psql -U "$db_user" -d "$db_name" -tAc \
      "SELECT 'users', count(*) FROM users UNION ALL SELECT 'forum_threads', count(*) FROM forum_threads UNION ALL SELECT 'training_sessions', count(*) FROM training_sessions;" \
      2>/dev/null | sed 's/|/: /' | sed 's/^/  /' || true
  fi

  cat <<EOF

Frontend:      http://127.0.0.1:$frontend_port/en
Backend API:   http://127.0.0.1:$api_port/v1
Health:        http://127.0.0.1:$api_port/v1/health
Proxy health:  http://127.0.0.1:$frontend_port/v1/health
Accounts:      $RUNTIME/accounts.json (mode 600)
Database:      postgresql://127.0.0.1:$(env_value TEST_DB_PORT)/$(env_value POSTGRES_DB)

Commands:
  scripts/test-stack/manage.sh start
  scripts/test-stack/manage.sh reset --yes
  scripts/test-stack/manage.sh status
  scripts/test-stack/manage.sh logs [frontend|backend|db]
  scripts/test-stack/manage.sh stop
  scripts/test-stack/manage.sh clean --yes
  scripts/test-stack/manage.sh sample
  scripts/test-stack/manage.sh check-api
  scripts/test-stack/manage.sh check-guided
  scripts/test-stack/manage.sh smoke
EOF

  (( health && frontend_ok && db_ok ))
}

project_resources() {
  echo "This command will remove ONLY project '$PROJECT':"
  echo "  containers:"
  docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
    --format '    {{.Names}} ({{.ID}})'
  echo "  volumes:"
  docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" \
    | sed 's/^/    /'
  echo "  networks:"
  docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" \
    | sed 's/^/    /'
  echo "  runtime: $RUNTIME"
}

remove_runtime() {
  case "$RUNTIME" in
    "$SCRIPT_DIR/runtime") ;;
    *) die "refusing to remove unexpected runtime path: $RUNTIME" ;;
  esac
  rm -rf -- "$RUNTIME"
}

down_stack() {
  if [[ -f "$STACK_ENV" ]]; then
    run_compose down -v --remove-orphans
    return
  fi
  local containers volumes networks item
  containers="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")"
  if [[ -n "$containers" ]]; then
    # shellcheck disable=SC2086
    docker rm -f $containers
  fi
  volumes="$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")"
  for item in $volumes; do docker volume rm "$item"; done
  networks="$(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT")"
  for item in $networks; do docker network rm "$item"; done
}

start_stack() {
  require_node
  ensure_environment
  render_nginx
  build_frontend
  build_backend
  run_compose up -d
  if (( FRONTEND_REBUILT )); then
    # A static build replaces the bind-mounted directory. Recreate the nginx
    # container so it mounts the new directory inode rather than the stale one.
    run_compose up -d --force-recreate --no-deps frontend
  fi
  wait_for_stack
  provision_accounts_if_missing
  stack_status
}

command="${1:-}"
case "$command" in
  start)
    start_stack
    ;;
  reset)
    [[ "${2:-}" == "--yes" ]] || die "reset is destructive; rerun with reset --yes"
    project_resources
    down_stack
    remove_runtime
    start_stack
    ;;
  status)
    [[ -f "$STACK_ENV" ]] || die "test stack is not initialized; run start"
    stack_status
    ;;
  logs)
    [[ -f "$STACK_ENV" ]] || die "test stack is not initialized; run start"
    shift
    run_compose logs --tail=100 -f "$@"
    ;;
  stop)
    [[ -f "$STACK_ENV" ]] || die "test stack is not initialized"
    run_compose stop
    ;;
  clean)
    [[ "${2:-}" == "--yes" ]] || die "clean is destructive; rerun with clean --yes"
    project_resources
    down_stack
    remove_runtime
    echo "Removed only project '$PROJECT'. Built images were retained for reuse."
    ;;
  accounts)
    [[ -f "$RUNTIME/accounts.json" ]] || die "no accounts; run start"
    node "$SCRIPT_DIR/provision.mjs" show --runtime "$RUNTIME"
    ;;
  sample)
    [[ -f "$STACK_ENV" ]] || die "test stack is not initialized; run start"
    node "$SCRIPT_DIR/provision.mjs" sample --runtime "$RUNTIME"
    ;;
  check-api)
    [[ -f "$STACK_ENV" ]] || die "test stack is not initialized; run start"
    node "$SCRIPT_DIR/check-api.mjs" --runtime "$RUNTIME"
    ;;
  check-guided)
    [[ -f "$STACK_ENV" ]] || die "test stack is not initialized; run start"
    node "$SCRIPT_DIR/check-guided.mjs" --runtime "$RUNTIME"
    ;;
  smoke)
    [[ -f "$STACK_ENV" ]] || die "test stack is not initialized; run start"
    node "$SCRIPT_DIR/smoke.mjs" --runtime "$RUNTIME"
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac
