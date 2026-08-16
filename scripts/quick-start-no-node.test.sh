#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
. "$SCRIPT_DIR/quick-start-env.sh"

if grep -Eq '(^|[[:space:];])node([[:space:]]|$)' quick-start.sh; then
  printf '[FAIL] quick-start.sh still invokes host Node.js.\n' >&2
  exit 1
fi

grep -Fq 'set_env_value "MYBAY_ASYNC_CHAT_RUNS_ENABLED" "true"' quick-start.sh
grep -Fq 'command -v docker' quick-start.sh
grep -Fq 'command -v openssl' quick-start.sh
grep -Fq 'HEALTH_HOST="$LAN_BIND_IP_VALUE"' quick-start.sh
grep -Fq 'http://${HEALTH_HOST}:${APP_PORT}/api/health' quick-start.sh
grep -Fq 'chmod 600 .env' quick-start.sh
grep -Fq 'chmod 700 data' quick-start.sh
grep -Fq 'up -d --build --remove-orphans' quick-start.sh
! grep -Fq "printf 'Admin password: %s" quick-start.sh

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
TEST_ENV="$TEST_ROOT/.env"

assert_env() {
  local key="$1"
  local expected="$2"
  local actual
  actual="$(quick_start_get_env_value "$TEST_ENV" "$key")"
  [ "$actual" = "$expected" ] || {
    printf '[FAIL] Expected %s=%s, got %s\n' "$key" "$expected" "$actual" >&2
    exit 1
  }
}

cp "$PROJECT_ROOT/.env.example" "$TEST_ENV"
quick_start_apply_deployment_env "$TEST_ENV" server "" 3000 console.old.example agents.old.example ops@example.com
quick_start_apply_deployment_env "$TEST_ENV" desktop localhost 3000
assert_env DEPLOYMENT_MODE desktop
assert_env PROXY_MODE local
assert_env TRUST_PROXY false
assert_env INSTANCE_PUBLIC_PROTOCOL http
assert_env PUBLIC_APP_URL http://localhost:3000
assert_env VITE_PUBLIC_APP_URL http://localhost:3000
assert_env VITE_MYBAY_PLATFORM_ORIGIN http://localhost:3000
assert_env CONTROL_PANEL_DOMAIN ""
assert_env MYBAY_INSTANCE_ROOT_DOMAIN ""
assert_env LETSENCRYPT_EMAIL ""
assert_env CONTROL_PLANE_INTERNAL_URL ""
assert_env INSTANCE_AUTH_INTERNAL_URL ""

quick_start_apply_deployment_env "$TEST_ENV" server "" 3000 console.old.example agents.old.example ops@example.com
quick_start_apply_deployment_env "$TEST_ENV" lan 192.168.1.20 3000
assert_env DEPLOYMENT_MODE lan
assert_env PROXY_MODE lan
assert_env TRUST_PROXY false
assert_env CONTROL_PANEL_BIND_IP 192.168.1.20
assert_env PUBLIC_APP_URL http://192.168.1.20:3000
assert_env VITE_PUBLIC_APP_URL http://192.168.1.20:3000
assert_env INSTANCE_PUBLIC_PROTOCOL http
assert_env CONTROL_PANEL_DOMAIN ""

quick_start_apply_deployment_env "$TEST_ENV" server "" 3000 console.new.example agents.new.example release@example.com
assert_env DEPLOYMENT_MODE server
assert_env PROXY_MODE traefik
assert_env TRUST_PROXY true
assert_env CONTROL_PANEL_DOMAIN console.new.example
assert_env MYBAY_INSTANCE_ROOT_DOMAIN agents.new.example
assert_env PUBLIC_APP_URL https://console.new.example
assert_env INSTANCE_PUBLIC_PROTOCOL https

printf '[PASS] quick-start.sh has no host Node.js invocation and retains Docker/openssl preflight checks.\n'