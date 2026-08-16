#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_NAME="MyBay Open Source"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/scripts/quick-start-env.sh"
COMPOSE_CMD=()
DEPLOYMENT_TARGET="desktop"
TARGET_EXPLICIT=false
LAN_BIND_IP_ARG=""

case "${1:-}" in
  "") ;;
  --desktop) DEPLOYMENT_TARGET="desktop"; TARGET_EXPLICIT=true ;;
  --lan) DEPLOYMENT_TARGET="lan"; TARGET_EXPLICIT=true; LAN_BIND_IP_ARG="${2:-}" ;;
  --server) DEPLOYMENT_TARGET="server"; TARGET_EXPLICIT=true ;;
  -h|--help)
    printf 'Usage: %s [--desktop|--lan [IP]|--server]\n' "$0"
    printf '  --desktop  Local computer deployment (default)\n'
    printf '  --lan      Local-network deployment bound to one host IPv4 address\n'
    printf '  --server   Public server deployment with Traefik and HTTPS\n'
    exit 0
    ;;
  *) printf '[ERROR] Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac

info() { printf '\n[%s] %s\n' "$1" "$2"; }
fail() { printf '\n[ERROR] %s\n' "$1" >&2; exit 1; }
warn() { printf '\n[WARN] %s\n' "$1" >&2; }

on_error() {
  local exit_code=$?
  printf '\n[ERROR] Deployment stopped near line %s (exit code %s).\n' "${BASH_LINENO[0]:-unknown}" "$exit_code" >&2
  if [ ${#COMPOSE_CMD[@]} -gt 0 ]; then
    printf '[INFO] Recent container logs:\n' >&2
    "${COMPOSE_CMD[@]}" logs --tail 80 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap on_error ERR

printf '\n============================================================\n'
printf ' %s - guided Docker deployment\n' "$PROJECT_NAME"
printf '============================================================\n'

[ -f docker-compose.yml ] || fail "docker-compose.yml was not found. Run this script from the MyBay project directory."
[ -f .env.example ] || fail ".env.example was not found. The project upload may be incomplete."

if [ "$TARGET_EXPLICIT" != "true" ] && [ -f .env ]; then
  case "$(grep -E '^DEPLOYMENT_MODE=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r\n')" in
    server) DEPLOYMENT_TARGET="server" ;;
    lan) DEPLOYMENT_TARGET="lan" ;;
  esac
fi

if [ "$DEPLOYMENT_TARGET" = "desktop" ] && [ "$(uname -s 2>/dev/null || true)" = "Linux" ]; then
  printf '\nMyBay is starting in Desktop mode.\n\n'
  printf 'Instance URLs will use *.localhost.\n\n'
  printf 'If this machine is a public VPS/server, use:\n\n'
  printf './quick-start.sh --server\n\n'
fi
info "1/6" "Checking Docker and system dependencies..."
command -v docker >/dev/null 2>&1 || fail "Docker was not found. Install Docker Engine or Docker Desktop first: https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || fail "Docker is installed but the Docker daemon is not running, or the current user cannot access it. Start Docker and retry."

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  fail "Docker Compose was not found. Install the Docker Compose v2 plugin and retry."
fi
if [ "$DEPLOYMENT_TARGET" = "server" ]; then
  [ -f docker-compose.server.yml ] || fail "docker-compose.server.yml was not found. The project upload may be incomplete."
  [ -f deploy/traefik/dynamic.yml ] || fail "deploy/traefik/dynamic.yml was not found. The project upload may be incomplete."
  COMPOSE_CMD+=(-f docker-compose.yml -f docker-compose.server.yml)
fi

command -v openssl >/dev/null 2>&1 || fail "openssl was not found. Install openssl and retry."

AVAILABLE_KB="$(df -Pk . 2>/dev/null | awk 'NR==2 {print $4}' || true)"
if [ -n "$AVAILABLE_KB" ] && [ "$AVAILABLE_KB" -lt 10485760 ]; then
  warn "Less than 10 GB of free disk space is available. Docker images and Agent files may fill the disk."
fi

info "2/6" "Preparing persistent data and environment configuration..."
mkdir -p data
if ! chmod 700 data 2>/dev/null; then
  warn "Could not restrict data/ permissions to 700. Review the directory permissions manually."
fi
if [ ! -f .env ]; then
  cp .env.example .env
  printf '[OK] Created .env from .env.example.\n'
else
  printf '[OK] Existing .env was preserved.\n'
fi
if ! chmod 600 .env 2>/dev/null; then
  warn "Could not restrict .env permissions to 600. Review the file permissions manually."
fi

get_env_value() {
  quick_start_get_env_value ".env" "$1"
}

set_env_value() {
  quick_start_set_env_value ".env" "$1" "$2"
}

# Upgrade existing installations without overriding an explicit false.
# Keep Quick Start host requirements limited to Docker, Compose, openssl and POSIX tools.
if [ -z "$(get_env_value MYBAY_ASYNC_CHAT_RUNS_ENABLED)" ]; then
  set_env_value "MYBAY_ASYNC_CHAT_RUNS_ENABLED" "true"
fi

if [ -z "$(get_env_value MYBAY_CONTROL_PANEL_DNS)" ]; then
  HOST_DNS="$(awk '/^nameserver[[:space:]]+/ { if ($2 !~ /^(127\.|::1$)/) { print $2; exit } }' /etc/resolv.conf 2>/dev/null || true)"
  if [ -n "$HOST_DNS" ]; then
    set_env_value "MYBAY_CONTROL_PANEL_DNS" "$HOST_DNS"
    printf '[OK] Detected host DNS for the control-panel container: %s
' "$HOST_DNS"
  fi
fi

prompt_env_value() {
  local key="$1"
  local label="$2"
  local current
  local value
  current="$(get_env_value "$key")"
  if [ -n "$current" ] && [ "$current" != "localhost" ]; then
    printf '%s [%s]: ' "$label" "$current" >&2
  else
    printf '%s: ' "$label" >&2
    current=""
  fi
  if [ ! -t 0 ]; then
    [ -n "$current" ] || fail "$key is required for non-interactive server deployment. Set it in .env and retry."
    value="$current"
  else
    read -r value
    [ -n "$value" ] || value="$current"
  fi
  [ -n "$value" ] || fail "$key is required."
  printf '%s' "$value"
}

validate_domain() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]
}

info "3/6" "Generating secure local secrets when needed..."
JWT_SECRET_VALUE="$(get_env_value JWT_SECRET)"
if [ "$(printf %s "$JWT_SECRET_VALUE" | wc -c)" -lt 32 ] || [ "$JWT_SECRET_VALUE" = "replace-with-a-random-32-byte-secret" ]; then
  set_env_value "JWT_SECRET" "$(openssl rand -base64 48 | tr -d '\n')"
fi

ENCRYPTION_KEY_VALUE="$(get_env_value ENCRYPTION_KEY)"
if ! [[ "$ENCRYPTION_KEY_VALUE" =~ ^[0-9a-fA-F]{64}$ ]]; then
  set_env_value "ENCRYPTION_KEY" "$(openssl rand -hex 32)"
fi

ROUTING_SECRET_VALUE="$(get_env_value MYBAY_INTERNAL_ROUTING_SECRET)"
if ! [[ "$ROUTING_SECRET_VALUE" =~ ^[0-9a-fA-F]{64}$ ]]; then
  set_env_value "MYBAY_INTERNAL_ROUTING_SECRET" "$(openssl rand -hex 32)"
fi

ADMIN_PASSWORD_VALUE="$(get_env_value LOCAL_ADMIN_PASSWORD)"
GENERATED_ADMIN_PASSWORD=""
if [ -z "$ADMIN_PASSWORD_VALUE" ] || [ "$ADMIN_PASSWORD_VALUE" = "change-me-now" ]; then
  GENERATED_ADMIN_PASSWORD="mybay_$(openssl rand -hex 16)"
  set_env_value "LOCAL_ADMIN_PASSWORD" "$GENERATED_ADMIN_PASSWORD"
fi

CONFIG_PORT="$(get_env_value PORT)"
[ -n "$CONFIG_PORT" ] || CONFIG_PORT="3000"
if [ "$DEPLOYMENT_TARGET" = "server" ]; then
  info "3/6" "Configuring public domains, HTTPS, and the Traefik gateway..."
  CONTROL_PANEL_DOMAIN_VALUE="$(prompt_env_value CONTROL_PANEL_DOMAIN 'Control panel domain (for example console.example.com)')"
  validate_domain "$CONTROL_PANEL_DOMAIN_VALUE" || fail "CONTROL_PANEL_DOMAIN must be a hostname without http://, paths, ports, or wildcard characters."

  INSTANCE_ROOT_DOMAIN_VALUE="$(prompt_env_value MYBAY_INSTANCE_ROOT_DOMAIN 'Agent root domain (for example agents.example.com)')"
  validate_domain "$INSTANCE_ROOT_DOMAIN_VALUE" || fail "MYBAY_INSTANCE_ROOT_DOMAIN must be a hostname without http://, paths, ports, or wildcard characters."

  LETSENCRYPT_EMAIL_VALUE="$(prompt_env_value LETSENCRYPT_EMAIL 'Email for HTTPS certificate notices')"
  [[ "$LETSENCRYPT_EMAIL_VALUE" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || fail "LETSENCRYPT_EMAIL is not a valid email address."

  CONFIG_PORT="3000"
  quick_start_apply_deployment_env ".env" "server" "" "$CONFIG_PORT" "$CONTROL_PANEL_DOMAIN_VALUE" "$INSTANCE_ROOT_DOMAIN_VALUE" "$LETSENCRYPT_EMAIL_VALUE"
elif [ "$DEPLOYMENT_TARGET" = "lan" ]; then
  LAN_BIND_IP_VALUE="$LAN_BIND_IP_ARG"
  [ -n "$LAN_BIND_IP_VALUE" ] || LAN_BIND_IP_VALUE="$(get_env_value DEPLOYMENT_LAN_BIND_IP)"
  [ -n "$LAN_BIND_IP_VALUE" ] || LAN_BIND_IP_VALUE="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [ -t 0 ]; then
    printf 'LAN IPv4 address [%s]: ' "$LAN_BIND_IP_VALUE"
    read -r LAN_BIND_IP_INPUT
    [ -z "$LAN_BIND_IP_INPUT" ] || LAN_BIND_IP_VALUE="$LAN_BIND_IP_INPUT"
  fi
  [[ "$LAN_BIND_IP_VALUE" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || fail "A valid LAN IPv4 address is required."
  HOST_IPV4_LIST=" $(hostname -I 2>/dev/null || true) "
  [[ "$HOST_IPV4_LIST" == *" $LAN_BIND_IP_VALUE "* ]] || fail "The LAN IP $LAN_BIND_IP_VALUE is not assigned to this host."
  quick_start_apply_deployment_env ".env" "lan" "$LAN_BIND_IP_VALUE" "$CONFIG_PORT"
else
  quick_start_apply_deployment_env ".env" "desktop" "localhost" "$CONFIG_PORT"
fi

if [ "$DEPLOYMENT_TARGET" = "lan" ]; then
  HEALTH_HOST="$LAN_BIND_IP_VALUE"
else
  HEALTH_HOST="127.0.0.1"
fi

APP_PORT="$(get_env_value PORT)"
[ -n "$APP_PORT" ] || APP_PORT=3000

if command -v ss >/dev/null 2>&1 && ss -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${APP_PORT}$"; then
  warn "Port $APP_PORT is already in use. An existing MyBay deployment may be running, or another service may conflict with it."
fi

if [ "$DEPLOYMENT_TARGET" = "server" ] && command -v ss >/dev/null 2>&1; then
  TRAEFIK_RUNNING="$(docker inspect -f '{{.State.Running}}' traefik 2>/dev/null || true)"
  if [ "$TRAEFIK_RUNNING" != "true" ]; then
    for required_port in 80 443; do
      if ss -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${required_port}$"; then
        fail "Port $required_port is already in use. Stop the existing web server or reverse proxy before starting MyBay server mode."
      fi
    done
  fi
fi

info "4/6" "Building and starting Docker services..."
"${COMPOSE_CMD[@]}" up -d --build --remove-orphans

info "5/6" "Waiting for the control panel to become ready..."
http_ready() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "http://${HEALTH_HOST}:${APP_PORT}/api/health" >/dev/null 2>&1 ||
      curl -fsS --max-time 3 "http://${HEALTH_HOST}:${APP_PORT}/" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=3 --spider "http://${HEALTH_HOST}:${APP_PORT}/" >/dev/null 2>&1
  else
    return 0
  fi
}

READY=false
for _ in $(seq 1 30); do
  if http_ready; then
    READY=true
    break
  fi
  sleep 2
done

if [ "$READY" != "true" ]; then
  "${COMPOSE_CMD[@]}" ps || true
  fail "The control panel did not become ready within 60 seconds. Run '${COMPOSE_CMD[*]} logs --tail 200' to inspect the startup error."
fi

if [ "$DEPLOYMENT_TARGET" = "server" ] && command -v curl >/dev/null 2>&1; then
  DOMAIN_RESOLVES=true
  if command -v getent >/dev/null 2>&1 && ! getent ahostsv4 "$CONTROL_PANEL_DOMAIN_VALUE" >/dev/null 2>&1; then
    DOMAIN_RESOLVES=false
    warn "The control-panel domain does not resolve yet. Point $CONTROL_PANEL_DOMAIN_VALUE and *.$INSTANCE_ROOT_DOMAIN_VALUE to this server, then wait for DNS propagation."
  fi
  if [ "$DOMAIN_RESOLVES" = "true" ]; then
    HTTPS_READY=false
    for _ in $(seq 1 30); do
      if curl -fsS --max-time 5 "https://${CONTROL_PANEL_DOMAIN_VALUE}/api/health" >/dev/null 2>&1 || curl -fsS --max-time 5 "https://${CONTROL_PANEL_DOMAIN_VALUE}/" >/dev/null 2>&1; then
        HTTPS_READY=true
        break
      fi
      sleep 2
    done
    if [ "$HTTPS_READY" != "true" ]; then
      warn "The containers are ready, but public HTTPS is not ready yet. Verify DNS, firewall ports 80/443, and run '${COMPOSE_CMD[*]} logs --tail 200 traefik'."
    else
      printf '[OK] Public HTTPS is reachable.\n'
    fi
  fi
fi

info "6/6" "Deployment completed successfully."
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
[ -n "$SERVER_IP" ] || SERVER_IP="<server-ip>"
ADMIN_USERNAME="$(get_env_value LOCAL_ADMIN_USERNAME)"
[ -n "$ADMIN_USERNAME" ] || ADMIN_USERNAME="admin"

if [ "$DEPLOYMENT_TARGET" = "server" ]; then
  printf '\nAccess URL: https://%s\n' "$CONTROL_PANEL_DOMAIN_VALUE"
  printf 'Agent domain pattern: https://<agent>.%s\n' "$INSTANCE_ROOT_DOMAIN_VALUE"
  printf 'DNS requirement: point %s and *.%s to this server before HTTPS issuance.\n' "$CONTROL_PANEL_DOMAIN_VALUE" "$INSTANCE_ROOT_DOMAIN_VALUE"
elif [ "$DEPLOYMENT_TARGET" = "lan" ]; then
  printf '\nAccess URL: http://%s:%s\n' "$LAN_BIND_IP_VALUE" "$APP_PORT"
else
  printf '\nAccess URL: http://127.0.0.1:%s\n' "$APP_PORT"
fi
printf 'Admin username: %s\n' "$ADMIN_USERNAME"
printf 'Admin password: use the value stored in the local .env file (never share this file).\n'
printf '\nUseful commands:\n'
printf '  View status: %s ps\n' "${COMPOSE_CMD[*]}"
printf '  View logs:   %s logs -f --tail 200\n' "${COMPOSE_CMD[*]}"
printf '  Restart:     %s restart\n' "${COMPOSE_CMD[*]}"
printf '  Stop:        %s down\n\n' "${COMPOSE_CMD[*]}"
