# Deploy Your First Agent in 10 Minutes

This guide takes a new MyBay Open Source installation from Docker startup to the first local Agent conversation. It uses only the self-hosted community edition and your own model API key (BYOK).

## 1. Choose an access mode

| Mode | Use it when | Console access |
| --- | --- | --- |
| Desktop | Docker and the browser run on the same machine | `http://localhost:3000` |
| LAN | Other devices on one trusted local network need access | The Docker host's fixed LAN IPv4 address |
| Server | You have public DNS and want HTTPS access | Your configured console domain |

Start with Desktop mode unless you already need LAN or public-server access. The preflight checks for Desktop, LAN, and Server modes remain part of the deployment flow.

## 2. Prepare Docker and clone MyBay

Install Docker Desktop on Windows or macOS, or Docker Engine with Docker Compose v2 on Linux. Confirm that the Docker engine is running, then clone the repository:

```bash
git clone https://github.com/mybay-ai/mybay.git
cd mybay
```

Host Node.js is not required for the Docker deployment.

## 3. Start the local control plane

### Windows PowerShell

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\quick-start.ps1 -InstallPrerequisites
```

If Docker Desktop is already installed and running, `-InstallPrerequisites` can be omitted.

### macOS or Linux

```bash
chmod +x quick-start.sh
./quick-start.sh
```

The launcher checks Docker, creates or preserves `.env`, generates missing local secrets and the administrator password, and starts the Compose services. Do not commit or share `.env`.

When startup finishes, open:

```text
http://localhost:3000
```

If the page is unavailable, run:

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
```

## 4. Sign in

Use the local administrator credentials generated or preserved in `.env`:

```text
LOCAL_ADMIN_USERNAME
LOCAL_ADMIN_PASSWORD
```

The default username is `admin` unless it was changed. Keep the password private and do not include it in screenshots or issue reports.

## 5. Add a BYOK model credential

Open **Credentials** in the control plane and add a credential for the model provider you want to use.

Provide:

- A recognizable credential name.
- The provider and API key.
- A custom Base URL only when the provider requires one.

Save the credential, then use the model connection test in the deployment flow. A URL that works in the host browser may still be unreachable from the Agent container; custom endpoints must be reachable from the Docker network.

## 6. Deploy the first Agent

Open the Agent deployment center and select **Deploy Agent**.

1. Complete the deployment preflight for the current access mode.
2. Enter a clear instance name and set independent access credentials.
3. Confirm the container and port configuration.
4. Select the model provider, model, and saved BYOK credential.
5. Run the model connection test before continuing.
6. Use the Web channel for the first validation. External IM channels can be added after local chat works.
7. Review the summary and create the instance through the existing deployment entry.

MyBay distinguishes container state from chat readiness. A running container can still be initializing its chat API or waiting for valid model/channel configuration.

## 7. Verify readiness

Before sending the first message, confirm these checkpoints:

- The instance container is running.
- Runtime state is synchronized with the local database.
- Chat readiness reports ready, not merely container running.
- The selected model credential passes its connection test.
- The Web channel is available for the initial local conversation.

If the instance is running but chat is still initializing, allow the startup checks to finish. If the UI reports authentication, internal-route, model, or channel errors, open the instance diagnostics instead of redeploying blindly.

## 8. Start a conversation

Open the instance chat workspace and select your instance. Before requesting a file, open the **Quick mode** selector beside the message input and switch to **Agent mode**. Quick mode only replies with model-generated text; it does not run tools or save files. Agent mode runs the task through Hermes.

Send a small test request, for example:

```text
Create and save mybay-first-task.html in the current workspace. Make it a self-contained HTML status page with no external resources, include MYBAY-FIRST-TASK-OK in the body, and return a link to the file. Do not change other files.
```

During the run you can inspect streaming output, execution steps, elapsed time, generated-file cards, file changes, and the Result workspace. Select the generated file to preview or download it. Preview support depends on the file type and, for video, the browser-supported codec.

Refresh the page once after completion to confirm that the conversation and final output recover without duplicate streamed text.

## 9. Use LAN or Server mode when needed

For a trusted LAN, bind one exact IPv4 address owned by the Docker host:

```powershell
.\quick-start.ps1 -Mode lan -LanBindIp 192.168.1.20
```

```bash
./quick-start.sh --lan 192.168.1.20
```

Do not use `0.0.0.0` as the advertised LAN address.

For a public server, configure the console DNS record, wildcard Agent DNS record, ports 80/443, and then run:

```powershell
.\quick-start.ps1 -Mode server
```

```bash
./quick-start.sh --server
```

Switching modes changes generated URLs, port bindings, and proxy labels. Run preflight again and redeploy existing instances after a mode change.

## 10. Diagnose a failed checkpoint

Collect local status before changing configuration:

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
docker ps -a --filter "name=mybay-agent"
```

Common meanings:

- `Forbidden`: verify the selected credential, API key, model access, and provider Base URL.
- `CHAT_API_NOT_ENABLED`: the instance chat API is not enabled or has not finished starting.
- `HERMES_API_AUTH_FAILED`: check the instance chat authentication configuration.
- `INTERNAL_ROUTE_AUTH_FAILED` or `internal_routing`: rebuild with a consistent `MYBAY_INTERNAL_ROUTING_SECRET`, then redeploy the affected instance.
- Container running but chat unavailable: inspect chat readiness, model configuration, channel configuration, and Agent logs separately.
- Docker Hub token or image-pull timeout: verify Docker's registry connectivity, proxy/DNS settings, and retry the same launcher after connectivity is restored.
- Port 3000 unavailable: identify the process or container already listening on that port before changing the MyBay port.

Never publish API keys, passwords, cookies, authorization headers, `.env`, private addresses, user files, or internal routing secrets with logs.

## Next steps

- [Local, LAN, and Server deployment](./local-deployment.md)
- [Environment variable reference](./env.md)
- [Security guide](./security.md)
- [Docker image cache and cleanup](./docker-image-cache.md)
- [Self-host operations and recovery](./self-host-operations.md)
- [Troubleshooting index](./troubleshooting.md)
