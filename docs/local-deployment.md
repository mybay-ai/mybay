# Local and Server Deployment

MyBay Open Source supports desktop-only, LAN, and public-server deployment. For a first installation, use `quick-start.sh` so secrets and network settings are generated consistently.

## Requirements

- Docker Engine or Docker Desktop
- Docker Compose v2 (`docker compose`)
- Bash
- Node.js 22.16.0 or later and npm only for source development
- Access to `/var/run/docker.sock` from the control-panel container

## Mode 1: Local Desktop

Use this mode when the browser and Docker run on the same computer:

```bash
chmod +x quick-start.sh
./quick-start.sh
```

The control panel and dynamic Agent ports bind to `127.0.0.1`. Open `http://localhost:3000`. Instance addresses under `.localhost` are available only on the Docker host.

## Mode 2: LAN Sharing

Bind one exact private IPv4 address assigned to the Docker host:

```bash
./quick-start.sh --lan 192.168.1.20
```

Do not use `0.0.0.0`. Confirm that the host firewall permits the control-panel port and configured dynamic Agent port range, and that client devices can route to the selected address.

## Mode 3: Public Server with Automatic HTTPS

Prepare:

- An A/AAAA record such as `console.example.com` pointing to the server
- A wildcard record such as `*.agents.example.com` pointing to the same server
- Public TCP ports 80 and 443
- No other process occupying ports 80/443

Run:

```bash
chmod +x quick-start.sh
./quick-start.sh --server
```

The script asks for the control-panel domain, Agent root domain, and certificate email. It starts Traefik through `docker-compose.server.yml`, obtains and renews Let's Encrypt certificates, and keeps dynamic Agent host ports off public interfaces.

If DNS has not propagated, certificate issuance can fail. Fix DNS and rerun the same command; existing `.env` values and data are preserved.

## Switching Deployment Modes

Deployment mode affects URLs, Docker port bindings, and instance routing. After switching:

1. Rerun `quick-start.sh` with the target mode.
2. Sign in and rerun preflight checks.
3. Redeploy existing instances so port bindings, internal URLs, and Traefik labels are regenerated.
4. Verify chat, the Agent web console, and file previews.

Changing only `BASE_DOMAIN` does not update existing containers.

## Manual Docker Compose

Desktop mode:

```bash
cp .env.example .env
# Set the admin password and generate JWT_SECRET, ENCRYPTION_KEY,
# and MYBAY_INTERNAL_ROUTING_SECRET.
docker compose up -d --build
```

Server mode requires both Compose files:

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --build
```

Prefer `./quick-start.sh --server` unless you are comfortable configuring all server variables manually.

## Source Development

```bash
npm ci
cp .env.example .env
npm run dev
```

The project requires Node.js >= 22.16.0. Use `npm run build && npm start` for a production source build.

## Backup and Upgrade

Instance configuration, conversations, uploads, and Agent workspaces live under `data/`. Stop writes and back up the directory before upgrading:

```bash
docker compose stop
cp -a data data.backup
```

Rebuild the control panel and verify instance status after upgrading. Never commit `data/` or `.env`.

## Diagnostics

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
docker ps -a --filter "name=mybay-agent"
```

For server mode:

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml logs --tail=200 traefik
```
