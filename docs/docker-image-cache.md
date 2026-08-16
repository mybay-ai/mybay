# Docker image download and local cache

MyBay does not download Hermes Agent images into the project directory. Images are pulled by the Docker daemon and stored in Docker's managed data area.

## Sync releases vs. pull an image

- **Sync releases** refreshes Hermes Agent release metadata and capabilities. It does not download image layers.
- **Pull image** downloads the selected official image into the local Docker cache.
- Deploying or auditing a version that is not cached may also pull it on demand.

The dashboard reports `Not downloaded`, `Queued`, `Pulling image...`, `Cached locally`, or `Pull failed` in the selected interface language.

## Where images are stored

- **Docker Engine on Linux:** the daemon data root is usually `/var/lib/docker`. Confirm it with `docker info --format '{{.DockerRootDir}}'`.
- **Docker Desktop on Windows (WSL 2):** image layers are normally inside Docker Desktop's managed virtual disk, commonly `%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`. The exact location can vary with the Docker Desktop version and disk settings.
- **Docker Desktop on macOS:** image layers live inside Docker Desktop's Linux VM disk rather than the MyBay project directory.

Do not edit or delete Docker Desktop's virtual disk directly. Removing it affects all Docker images, containers, volumes, and build cache—not only Hermes Agent data.

## Inspect and clean up safely

```bash
docker image ls nousresearch/hermes-agent
docker image inspect nousresearch/hermes-agent:<tag>
docker system df
```

Remove a specific unused image through Docker Desktop or the Docker CLI:

```bash
docker image rm nousresearch/hermes-agent:<tag>
```

Docker will refuse removal while a dependent container still uses the image unless forced removal is requested. Avoid broad prune commands unless you have reviewed everything they will remove.
