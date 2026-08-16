# Environment Variables

Copy `.env.example` to `.env` before starting. Prefer `quick-start.sh`, which generates required secrets and consistent deployment settings.

## Security and Administrator

| Variable | Purpose | Default/requirement |
| --- | --- | --- |
| `LOCAL_ADMIN_USERNAME` | Local console administrator | `admin` |
| `LOCAL_ADMIN_PASSWORD` | Administrator password | Replace the example value |
| `JWT_SECRET` | Local session-signing secret | At least 32 bytes |
| `ENCRYPTION_KEY` | AES-256 key for stored credentials | 64 hexadecimal characters |
| `MYBAY_INTERNAL_ROUTING_SECRET` | Authentication for internal control-plane/Agent routes | 64 hexadecimal characters |

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
openssl rand -hex 32
```

Plan credential migration before changing `ENCRYPTION_KEY`; otherwise existing encrypted values may become unreadable. Never commit `.env`.

## Deployment Mode and URLs

| Variable | Purpose | Default |
| --- | --- | --- |
| `DEPLOYMENT_MODE` | Access scenario: `desktop`, `lan`, or `server` | `desktop` |
| `PROXY_MODE` | Instance routing: `local`, `lan`, or `traefik` | `local` |
| `PORT` | Control-panel port | `3000` |
| `CONTROL_PANEL_BIND_IP` | Host address for the control panel | `127.0.0.1` |
| `DEPLOYMENT_LAN_BIND_IP` | Selected host IPv4 for LAN mode | Empty |
| `LOCAL_INSTANCE_ACCESS_HOST` | Host used in local/LAN instance URLs | Derived when empty |
| `BASE_DOMAIN` | Compatibility base domain for local routing | `localhost` |
| `PUBLIC_APP_URL` | Public control-panel URL used by the server | `http://localhost:3000` |
| `VITE_PUBLIC_APP_URL` | Public control-panel URL embedded in the frontend | `http://localhost:3000` |
| `TRUST_PROXY` | Trust reverse-proxy forwarding headers | `false`; enable as required in server mode |

`VITE_PUBLIC_APP_URL` is a build-time variable. Rebuild the control panel after changing it.

## Public Server and Traefik

| Variable | Purpose | Server example |
| --- | --- | --- |
| `CONTROL_PANEL_DOMAIN` | Real console hostname without scheme or path | `console.example.com` |
| `MYBAY_INSTANCE_ROOT_DOMAIN` | Root domain for Agent hostnames | `agents.example.com` |
| `LETSENCRYPT_EMAIL` | Let's Encrypt notification email | Required |
| `TRAEFIK_NETWORK` | Shared Traefik network | `traefik_proxy` |
| `TRAEFIK_CONTAINER_NAME` | Traefik container name | `traefik` |
| `INSTANCE_PUBLIC_PROTOCOL` | Protocol used in public instance URLs | `https` in server mode |
| `CONTROL_PLANE_INTERNAL_URL` | Docker-internal control-plane callback URL | Normally generated |
| `INSTANCE_AUTH_INTERNAL_URL` | Docker-internal Agent authentication URL | Normally generated |

Server mode requires `DEPLOYMENT_MODE=server`, `PROXY_MODE=traefik`, and `docker-compose.server.yml`. Do not include `https://` in `CONTROL_PANEL_DOMAIN`.

## Instance Resource Guards

These are local host-protection defaults, not hosted billing quotas:

| Variable | Purpose | Default |
| --- | --- | --- |
| `MAX_INSTANCE_COUNT` | Maximum number of instances | `10` |
| `DEFAULT_INSTANCE_MEMORY` | Default memory limit for new instances | `1024m` |
| `DEFAULT_INSTANCE_CPUS` | Default CPU limit for new instances | `1` |
| `DEFAULT_INSTANCE_DISK_MB` | Default disk guard for new instances | `4096` |

Adjust them for the host before deployment. Changing defaults does not mutate existing containers; save and redeploy existing instances when necessary.

## Local Storage

| Variable | Purpose | Default |
| --- | --- | --- |


| `MYBAY_SQLITE_PATH` | On-machine SQLite database file | `data/mybay.sqlite` |
| `LOCAL_DATA_DIR` | Instance, upload, and log directory | `data` |
| `CHAT_ATTACHMENT_MAX_FILES` | Maximum attachments per message; `0` or `unlimited` disables the count limit | `20` |
| `CHAT_ATTACHMENT_MAX_FILE_MB` | Per-file upload guard in MB; `0` or `unlimited` disables the size limit | `100` |
| `CHAT_ATTACHMENT_ALLOWED_EXTENSIONS` | Comma-separated extensions; `*` allows any extension | PDF, Office, text, JSON/log, and common image formats |

Attachment settings are local host-protection controls, not product or license quotas. Quick/Assist reads UTF-8 text attachments only; Agent mode can work with the wider configured set through filesystem tools. Even when attachment limits are disabled, instance disk guards, upload path checks, and known-format content validation remain active.

All platform state is persisted in the SQLite file on the current machine.

## Agent and Docker

| Variable | Purpose | Default |
| --- | --- | --- |
| `MY_BAY_GITHUB_REPO` | Upstream Agent repository | `nousresearch/hermes-agent` |
| `MY_BAY_IMAGE` | Default image for new instances | `nousresearch/hermes-agent` |
| `MY_BAY_INCLUDE_PRERELEASE` | Include prerelease versions | `false` |
| `MY_BAY_PORT_START` | Dynamic host-port range start | `10100` |
| `MY_BAY_PORT_END` | Dynamic host-port range end | `19999` |
| `MYBAY_CONTROL_PANEL_DNS` | DNS server used by the control-panel container for OAuth and QR-provider APIs | Detected by Quick Start; manual default `1.1.1.1` |
| `MYBAY_CONTAINER_DNS` | DNS servers for Agent containers | `1.1.1.1,8.8.8.8` |
| `TEMPLATE_CENTER_ENABLED` | Enable the optional template/Blueprint workflow extension | `false` |
| `SCHEDULER_RUNNER_ENABLED` | Enable its local scheduled-workflow runner (requires template workflows) | `false` |
| `MYBAY_ADVANCED_RESOURCE_CONFIG_ENABLED` | Enable optional manual per-instance resource policy management | `false` |

LAN mode may require firewall access to the dynamic port range. Server mode routes through Traefik on 80/443 and should not expose that range publicly.
