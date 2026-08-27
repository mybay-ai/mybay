# Troubleshooting MyBay Open Source

Use this guide to identify which layer is failing before changing configuration. MyBay reports control-plane startup, Agent container state, chat readiness, model connectivity, messaging channels, and file previews separately.

## Start with a safe diagnostic snapshot

Run these commands from the repository root:

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
docker ps -a --filter "name=mybay-agent"
```

For one Agent, open its **Details** view and record the deployment log, runtime log, readiness report, and error code. Preserve the timestamp and deployment mode.

Before sharing output, remove API keys, passwords, cookies, authorization headers, `.env`, internal routing secrets, private addresses, real domains, and user files.

## Read the state correctly

| Reported state | Meaning | Next check |
| --- | --- | --- |
| Deploying | The control plane is still creating resources | Deployment log and Docker activity |
| Instance running, chat initializing | The container runs but the chat API has not completed startup | Agent runtime log and chat readiness |
| Instance running, chat needs configuration | Docker is healthy; the model, authentication, route, or channel is not | The exact readiness reason |
| Instance and chat ready | The local Web conversation path passed | Send a small test message |
| Deployment failed | A Docker image, network, port, container, or readiness step failed | Deployment error code and detail |
| Chat authentication or routing failed | The container may be healthy, but MyBay cannot use the chat API | Internal API and routing credentials |

A green Docker `Running` state alone does not prove that chat is available. Likewise, an optional Dashboard on port `9119` is not the chat API on port `8642`.

## The console at port 3000 is unavailable

Check the Compose service first:

```bash
docker compose ps
docker compose logs --tail=200 mybay-local
```

On Windows, inspect the listener without stopping anything:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

Common causes are Docker not running, the control-plane container exiting, port 3000 already being used, invalid required secrets, or an unreadable data directory. Identify the owner of the port before changing `PORT`. Do not terminate an unrelated process blindly.

In Desktop mode, open `http://localhost:3000` on the Docker host. A `.localhost` Agent address is not intended for another LAN device.

## Docker Hub token, image pull, or IPv6 timeout

Errors such as `failed to fetch anonymous token`, `auth.docker.io/token`, `dial tcp`, or `IMAGE_PULL_FAILED` happen before MyBay is built. They indicate Docker registry connectivity, DNS, proxy, firewall, rate-limit, or image-reference problems rather than an application compilation error.

1. Confirm Docker Desktop or Docker Engine can reach Docker Hub.
2. Check Docker's own proxy and DNS configuration, not only the browser proxy.
3. Verify that a firewall or security product is not blocking `registry-1.docker.io` or `auth.docker.io`.
4. If the error selected an unreachable IPv6 address, fix host/Docker IPv6 routing or DNS preference according to the local network policy.
5. Confirm the image and tag exist.
6. Retry the same Quick Start command after connectivity is restored; the existing `.env` is preserved.

Do not edit the Dockerfile merely because the first line reports the failed base-image fetch.

## Model test returns `Forbidden`

`Forbidden` is normally a provider response, not a deployment-port error.

Check:

- The deployment uses the intended saved credential rather than an old or empty key.
- The key is active and allowed to access the selected model.
- The model identifier is supported by that account and provider.
- The Base URL belongs to the selected provider and has the required path format.
- A custom endpoint is reachable from the Agent container network.
- Provider region, organization, project, or IP restrictions permit the request.

Retest with a small model request. Do not paste the API key into logs or screenshots. If manual and saved credentials behave differently, reselect the credential and verify that the UI reports the expected credential source before saving.

## Container runs but chat is unavailable

Use the exact readiness reason:

### `CHAT_API_NOT_ENABLED`

The instance did not enable the internal chat API or it has not finished starting. The generated runtime configuration must enable the API server on port `8642`. Restarting only the optional Dashboard does not fix this condition.

### `HERMES_API_AUTH_FAILED`

The control plane reached the Agent API, but the internal API credential was rejected. Save the instance configuration through MyBay and restart the Agent so both sides use the same generated value.

### `INTERNAL_ROUTE_AUTH_FAILED` or `internal_routing`

The control plane and Agent do not agree on the internal routing secret. Verify `MYBAY_INTERNAL_ROUTING_SECRET`, rebuild the control-plane service with the same configuration, and redeploy affected instances. Do not reveal the secret while comparing configuration.

### Model or channel configuration unavailable

Keep the container running while correcting the relevant configuration. A model or external messaging-channel failure should not be presented as a Docker deployment failure.

## Feishu or Lark adapter is unavailable

Logs such as `requirements not met`, `adapter creation failed`, or `No adapter available for Feishu` mean that the running Agent image lacks the required Feishu runtime dependencies or the adapter configuration is incomplete.

The local open-source deployment prepares a verified Feishu-compatible image from `Dockerfile.feishu` when Feishu/Lark is selected. On the first deployment, this local image build can take several minutes.

Check:

1. The selected Hermes version declares Feishu/Lark capability.
2. `Dockerfile.feishu` exists in the installed project.
3. Docker can pull the base image and install dependencies.
4. The Docker host has enough free disk space for the derived image.
5. The deployment log confirms that Feishu dependencies were verified.
6. The App ID, App Secret, service region, permissions, event subscription, allowed users, and allowed chats match the Feishu/Lark application.

After correcting the cause, redeploy or save and restart the instance so it uses the verified image. Do not install packages manually inside a running container; those changes are lost when the container is recreated.

If Feishu can already receive and send messages, review each diagnostic item separately. An unused optional Web Dashboard or gateway route should not be confused with Feishu channel failure.

## Hot update reports save failure

If saving a model/API change reports `"[object Object]" is not valid JSON`, first confirm that the browser and server are running the same current build. Rebuild or restart the control plane, perform a hard browser refresh, reopen instance settings, and retry with either one saved credential or one manually entered key.

If the current build still fails, preserve the response status, error code, timestamp, and sanitized server log. Do not repeatedly change multiple model, channel, and password fields in the same diagnostic attempt.

## HTML preview is blank or cannot be operated

Use the **Source** and **Page** views to separate a rendering problem from an empty file.

Check:

- The selected file is the generated container artifact under the instance workspace, commonly `outputs/<type>/<project>/...`, not a path invented for the Windows host.
- The HTML is non-empty and contains a complete document or valid application entry.
- Referenced CSS, JavaScript, images, fonts, and media exist in the same generated project.
- A TypeScript or TSX source file has been compiled into browser-ready HTML and JavaScript.
- The page does not require a development server, localhost-only Vite route, missing `node_modules`, or an external CDN/API.

HTML runs in a security sandbox. Network connections, nested frames, objects, and form submissions are intentionally restricted. For a reliable preview, ask the Agent to produce a self-contained local build and place its entry point and assets under one project directory.

Use **Reload preview** after the Agent finishes writing all dependencies. If the preview diagnostic lists missing assets, regenerate or copy those assets rather than weakening the sandbox.

## MP4 or MOV preview says the format is unsupported

MyBay can stream `.mp4` and `.mov` with byte-range responses, but the extension does not identify the internal video/audio codec. Browser support still depends on the codec.

Commonly compatible output is MP4 with H.264 video, AAC audio, `yuv420p`, and fast-start metadata. HEVC/H.265, ProRes, unusual audio codecs, or some MOV combinations may not play in the current browser.

If `ffprobe` is installed, inspect the file locally:

```bash
ffprobe -hide_banner input.mov
```

If conversion is appropriate and `ffmpeg` is available:

```bash
ffmpeg -i input.mov -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart output.mp4
```

Also verify that the file is complete and non-zero, then reload the preview. This does not change MyBay's upload limits or validation rules.

## A Chinese filename is garbled

Refresh the current build and upload the file again to verify that the original UTF-8 filename is preserved. Historical records created before filename normalization may retain their stored display name. Compare the attachment card, generated-file card, download name, and workspace file name.

Do not rename the file by guessing the corrupted characters. Preserve the original file and collect a sanitized example filename, browser version, and request timestamp if the problem persists.

## A refreshed conversation duplicates or changes output

Wait until the run reaches a terminal state, then refresh once. The recovered server snapshot should not append already processed stream events, events from another `runId`, or an old pending assistant message.

If output changes after refresh, record the conversation ID, run ID, request ID, event sequence, terminal state, and timestamps without including message contents that may be sensitive. Check whether the Agent container restarted during the run.

## Before opening an issue

Include:

- MyBay version or commit.
- Desktop, LAN, or Server mode.
- Operating system and Docker version.
- Browser and version when the UI or preview is involved.
- Exact error code and timestamp.
- Sanitized control-plane and Agent log excerpts.
- Whether the problem reproduces with a new instance or conversation.

Exclude all credentials, secrets, private infrastructure details, and user data.

Related guides:

- [Deploy your first Agent](./QUICKSTART.md)
- [Local, LAN, and Server deployment](./local-deployment.md)
- [Environment variables](./env.md)
- [Security](./security.md)
