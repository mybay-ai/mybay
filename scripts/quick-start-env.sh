#!/usr/bin/env bash

quick_start_get_env_value() {
  local env_path="$1"
  local key="$2"
  grep -E "^${key}=" "$env_path" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\r\n"
}

quick_start_set_env_value() {
  local env_path="$1"
  local key="$2"
  local value="$3"
  if grep -q "^${key}=" "$env_path"; then
    if [ "$(uname -s)" = "Darwin" ]; then
      sed -i "" "s|^${key}=.*|${key}=${value}|" "$env_path"
    else
      sed -i "s|^${key}=.*|${key}=${value}|" "$env_path"
    fi
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$env_path"
  fi
}

quick_start_assert_encryption_key_generation_safe() {
  local data_store_path="$1"
  if [ -s "$data_store_path" ]; then
    printf '%s\n' "Existing local data was found, but ENCRYPTION_KEY is missing or invalid. Restore the original ENCRYPTION_KEY instead of generating a new one." >&2
    return 1
  fi
}

quick_start_reset_server_env() {
  local env_path="$1"
  local public_url="$2"
  quick_start_set_env_value "$env_path" "CONTROL_PANEL_DOMAIN" ""
  quick_start_set_env_value "$env_path" "BASE_DOMAIN" "localhost"
  quick_start_set_env_value "$env_path" "MYBAY_INSTANCE_ROOT_DOMAIN" ""
  quick_start_set_env_value "$env_path" "PUBLIC_APP_URL" "$public_url"
  quick_start_set_env_value "$env_path" "VITE_PUBLIC_APP_URL" "$public_url"
  quick_start_set_env_value "$env_path" "VITE_MYBAY_PLATFORM_ORIGIN" "$public_url"
  quick_start_set_env_value "$env_path" "INSTANCE_PUBLIC_PROTOCOL" "http"
  quick_start_set_env_value "$env_path" "TRAEFIK_NETWORK" "traefik_proxy"
  quick_start_set_env_value "$env_path" "TRAEFIK_CONTAINER_NAME" "traefik"
  quick_start_set_env_value "$env_path" "CONTROL_PLANE_INTERNAL_URL" ""
  quick_start_set_env_value "$env_path" "INSTANCE_AUTH_INTERNAL_URL" ""
  quick_start_set_env_value "$env_path" "LETSENCRYPT_EMAIL" ""
  quick_start_set_env_value "$env_path" "TRUST_PROXY" "false"
}

quick_start_apply_deployment_env() {
  local env_path="$1"
  local mode="$2"
  local access_host="$3"
  local port="$4"
  local control_panel_domain="${5:-}"
  local instance_root_domain="${6:-}"
  local letsencrypt_email="${7:-}"
  local public_url

  case "$mode" in
    server)
      quick_start_set_env_value "$env_path" "DEPLOYMENT_MODE" "server"
      quick_start_set_env_value "$env_path" "PROXY_MODE" "traefik"
      quick_start_set_env_value "$env_path" "PORT" "$port"
      quick_start_set_env_value "$env_path" "CONTROL_PANEL_BIND_IP" "127.0.0.1"
      quick_start_set_env_value "$env_path" "DEPLOYMENT_LAN_BIND_IP" ""
      quick_start_set_env_value "$env_path" "LOCAL_INSTANCE_ACCESS_HOST" ""
      quick_start_set_env_value "$env_path" "CONTROL_PANEL_DOMAIN" "$control_panel_domain"
      quick_start_set_env_value "$env_path" "BASE_DOMAIN" "$instance_root_domain"
      quick_start_set_env_value "$env_path" "MYBAY_INSTANCE_ROOT_DOMAIN" "$instance_root_domain"
      public_url="https://${control_panel_domain}"
      quick_start_set_env_value "$env_path" "PUBLIC_APP_URL" "$public_url"
      quick_start_set_env_value "$env_path" "VITE_PUBLIC_APP_URL" "$public_url"
      quick_start_set_env_value "$env_path" "VITE_MYBAY_PLATFORM_ORIGIN" "$public_url"
      quick_start_set_env_value "$env_path" "INSTANCE_PUBLIC_PROTOCOL" "https"
      quick_start_set_env_value "$env_path" "TRAEFIK_NETWORK" "traefik_proxy"
      quick_start_set_env_value "$env_path" "TRAEFIK_CONTAINER_NAME" "traefik"
      quick_start_set_env_value "$env_path" "CONTROL_PLANE_INTERNAL_URL" "http://mybay-local-control-panel:${port}"
      quick_start_set_env_value "$env_path" "INSTANCE_AUTH_INTERNAL_URL" "http://mybay-local-control-panel:${port}"
      quick_start_set_env_value "$env_path" "LETSENCRYPT_EMAIL" "$letsencrypt_email"
      quick_start_set_env_value "$env_path" "TRUST_PROXY" "true"
      ;;
    lan)
      public_url="http://${access_host}:${port}"
      quick_start_set_env_value "$env_path" "DEPLOYMENT_MODE" "lan"
      quick_start_set_env_value "$env_path" "PROXY_MODE" "lan"
      quick_start_set_env_value "$env_path" "CONTROL_PANEL_BIND_IP" "$access_host"
      quick_start_set_env_value "$env_path" "DEPLOYMENT_LAN_BIND_IP" "$access_host"
      quick_start_set_env_value "$env_path" "LOCAL_INSTANCE_ACCESS_HOST" "$access_host"
      quick_start_reset_server_env "$env_path" "$public_url"
      ;;
    desktop)
      public_url="http://localhost:${port}"
      quick_start_set_env_value "$env_path" "DEPLOYMENT_MODE" "desktop"
      quick_start_set_env_value "$env_path" "PROXY_MODE" "local"
      quick_start_set_env_value "$env_path" "CONTROL_PANEL_BIND_IP" "127.0.0.1"
      quick_start_set_env_value "$env_path" "DEPLOYMENT_LAN_BIND_IP" ""
      quick_start_set_env_value "$env_path" "LOCAL_INSTANCE_ACCESS_HOST" ""
      quick_start_reset_server_env "$env_path" "$public_url"
      ;;
    *) return 1 ;;
  esac
}
