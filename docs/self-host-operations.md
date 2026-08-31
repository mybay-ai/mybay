# Self-host Operations

## Doctor

```bash
npm run doctor
npm run doctor -- --json
```

Doctor checks SQLite integrity and schema metadata, Docker daemon reachability, disk availability, and whether required encryption, JWT, and internal-routing secrets are configured with valid shapes. It reports only secret status and never prints secret values.

## Backup

```bash
npm run backup
npm run backup -- --output /secure/path/mybay-backup
npm run backup:verify -- --backup /secure/path/mybay-backup
```

MyBay uses Node.js's SQLite backup API to create a consistent snapshot of the WAL-backed database. The backup directory includes:

- the SQLite snapshot;
- `data/instances` when present;
- `data/uploads` when present;
- a manifest containing the MyBay version, schema version, exclusions, and SHA-256 hashes.

Inside `data/instances`, directories named `logs`, `cache`, `.cache`, `__pycache__`, `.venv`, `venv`, and `node_modules` are excluded at every depth; their paths are recorded in `manifest.skippedPaths`. These dependencies/caches must be rebuilt after recovery. Files with these names are retained. Symbolic links with excluded directory names are skipped; other links are rejected rather than followed. If a workspace intentionally stores irreplaceable content in one of these directories, preserve it separately before maintenance. Uploads are not filtered this way.

Container images and the **control-plane `.env`** are excluded. **Instance `.env` files are included**, as are encrypted credentials in SQLite. Preserve the original control-plane `.env`, especially `ENCRYPTION_KEY`, in separate secure storage: generating a new key does not decrypt existing credentials. Backups are sensitive, not redacted diagnostic bundles. On Unix-like systems, backup directories are restricted to `0700` and regular files to `0600`; Windows uses its native ACLs, which administrators must restrict themselves.

The SQLite snapshot is transactionally consistent, but files copied from active Agents are not part of that transaction. For a coherent recovery point, stop the control plane and **all Agent writers** first; stopping only Compose does not stop dynamically created Agent containers. Record the exact container names and image digests beforehand. Do not delete containers, volumes, or old data. The output must be a new directory outside the source data tree. A failed backup may leave partial files; without a successfully verified manifest it is not a usable backup.

## Restore into a new directory

The local candidate includes an isolated restore command. It does **not** overwrite live data, restart containers, migrate schemas, or perform an application rollback. These commands require this candidate's source or an image built from it, not the already published v0.1.24 image.

```bash
npm run backup:verify -- --backup /secure/path/mybay-backup
npm run backup:restore -- --backup /secure/path/mybay-backup --output /secure/path/mybay-recovered
```

`mybay-recovered` must not exist, even as an empty directory. Restore validates format, supported schema, safe paths, checksums and SQLite integrity, copies only manifest-listed files into a new sibling staging directory, verifies the copies, then renames that directory into place. The result is `mybay-recovered/data/`. Failed restores never overwrite the requested destination; a uniquely named `.mybay-restore-*` directory may remain for diagnosis and contains sensitive data. Checksums detect corruption, not a maliciously replaced manifest; use only trusted backups.

## Docker-only / Windows Docker Desktop

Production images do not include npm. Use `node scripts/mybay-ops.mjs` inside an image built from this candidate. In particular, do not open an active Docker-managed SQLite WAL database from a host Windows Node process. Use a stopped recovery point and the Linux container environment instead. The source directory mount must allow SQLite to create its WAL/SHM auxiliary files even though the backup connection opens the database read-only. A read-only directory can fail with `unable to open database file` when those auxiliary files are absent. The helper never writes application records into the source database.

The following PowerShell example runs from the project root **after stopping the intended control plane and Agent writers**. `backups` can already exist; `backup-01` and `recovered-01` must be new. The helper has no Docker socket, network or control-plane secrets; no live application is started.

```powershell
docker build -t mybay-local:recovery-candidate .
New-Item -ItemType Directory -Force ./backups | Out-Null
docker run --rm --network none --mount "type=bind,source=$((Get-Location).Path)/data,target=/source" --mount "type=bind,source=$((Get-Location).Path)/backups,target=/recovery" mybay-local:recovery-candidate node scripts/mybay-ops.mjs backup --database /source/mybay.sqlite --output /recovery/backup-01
docker run --rm --network none --mount "type=bind,source=$((Get-Location).Path)/backups,target=/recovery" mybay-local:recovery-candidate node scripts/mybay-ops.mjs verify-backup --backup /recovery/backup-01
docker run --rm --network none --mount "type=bind,source=$((Get-Location).Path)/backups,target=/recovery" mybay-local:recovery-candidate node scripts/mybay-ops.mjs restore --backup /recovery/backup-01 --output /recovery/recovered-01
```

For POSIX shells, use the same container commands with absolute host paths in `--mount`. Never upload `backups/` or add it to a release image. Default Git, release archive and Docker-context filters exclude it.

## Manual cutover and rollback gate

The candidate now validates the database before starting HTTP or background workers. A schema newer than this application supports is rejected before schema initialization; use the matching version or an older backup, not an in-place downgrade.

1. Verify the recovered copy before changing a service. Keep the original data, `.env`, exact image digests, Agent IDs and bind-mount paths as the rollback point.
2. Use a separate port and private network for a rehearsal. Preserve the original `ENCRYPTION_KEY`; do not let a rehearsal controller operate production Agents through a shared Docker socket. Validate login, decrypted model configuration, history and file hashes.
3. Plan control-plane **and Agent** data paths together. Restoring SQLite alone does not repoint existing Agent containers. Rebuild excluded dependencies and verify Agent startup before accepting a recovery.
4. Only with all relevant writers stopped, perform a reviewed manual switch to the recovered data. If startup or schema checks fail, stop the attempted version and switch back to the preserved image/data pair. Do not downgrade a migrated database in place.

The helper's restore tests are not evidence that cross-version upgrade/downgrade, all deployment modes, or production cutover have been certified. See [local validation evidence](./release-validation.md) for the current boundary.

### What a real Agent cutover must preserve

The local Windows/Docker rehearsal also restored a dedicated Hermes Agent, not just a synthetic database. This required a reviewed manual container cutover outside `backup:restore`:

- Stop the test controller and Agent before backup, and retain the stopped source Agent and its original data directory.
- Recreate the Agent with the same pinned image, environment, network/alias and port bindings, but bind `/opt/data` to the recovered instance directory. Docker cannot change an existing container's bind mounts by restarting it.
- Reconcile the recreated container's ID with the instance record **only in the stopped recovered database** before starting its controller. The rehearsal used a narrowly scoped offline update of `instances.data.container_id`; this is not an automatic recovery feature or a supported live-database edit procedure.
- Point the recovered controller's `/app/data` to the same recovered tree, preserve its encryption and routing secrets, and attach it to the Agent's network. Keep `MYBAY_CONTROL_PANEL_CONTAINER` consistent with the actual controller name. A copied production database must never be started against production Docker without separately reviewed instance isolation.
- Wait for the chat service itself to be ready, then verify fresh login, historical messages, browser preview, HTTP download hashes and a real model follow-up. Container-running status alone is insufficient.
- For fallback, stop the recovered writers, release their conflicting names and ports, then restart the retained source Agent with the controller pinned to the preserved image and source data. Writes made after the backup exist only in the recovered tree and are not automatically merged back.

The initial rehearsal above was manual. The restricted offline helper below now automates container reattachment and database ID mapping. Cross-version migrations remain separate work; do not advertise `backup:restore` as one-command service recovery.

## Offline service recovery helper (local candidate)

`scripts/mybay-service-recovery.mjs` provides `plan`, `prepare`, `activate`, and `rollback`. It is included in images built from this candidate; the previously published v0.1.24 image does not contain it. It is a **maintenance CLI, not automatic recovery during normal startup or a UI restore button**.

Supported first-version boundary:

- One local Docker Engine, Desktop/local routing, web-channel Hermes instances, current exact SQLite schema, existing retained containers, and the same pinned images already available locally.
- Runtime/channel metadata is read from the persisted `config_json` (JSON string or object), with support for explicit legacy top-level fields. Missing or conflicting metadata, malformed configuration, non-Hermes runtimes and non-Web channels are rejected; the helper does not rewrite configuration to make it pass.
- A controller `/app/data` bind mount and one `/opt/data` bind mount per Agent. Additional Agent mounts, named volumes, privileged containers, host/container network namespaces, static network addresses, LAN/Server modes and custom database paths are rejected.
- All selected writers must already be stopped. Outstanding chat/deployment/task-runner work, active platform schedules, changed instance inventories/configurations/credentials, wrong encryption keys and conflicting data mounts are rejected. Pause schedules before taking the backup; the helper does not edit them for you. Agent-native schedulers and external automation must also be disabled separately before backup; their runtime-specific files are not comprehensively inspected by this CLI. A backup from before a container recreation or credential rotation needs a separately reviewed procedure.
- The helper runs as a **separate Linux container** with an explicit host bind mount and Docker socket. Do not run it inside the controller being recovered or from host Windows Node against a Docker-managed WAL database. Docker-socket access is administrator-level; use only a trusted locally built image and reviewed paths.

### Review, prepare and activate

First stop the intended controller and **each Agent writer by its verified name or ID**, then create/verify the coherent backup described above. Do not stop unrelated containers. Keep the original `.env`, images, containers and data. `plan` itself does not stop services or create a recovery directory.

This PowerShell example assumes the selected controller is `mybay-local-control-panel`, the verified backup is `backups/backup-01`, and `backups/recovered-01` does not exist. Use the actual names/paths for your installation. The source, backup and output trees must be disjoint.

```powershell
$serviceRecoveryHelper = @(
  'run', '--rm', '--network', 'none',
  '--env', 'MYBAY_SERVICE_RECOVERY=1',
  '--mount', "type=bind,source=$((Get-Location).Path),target=/recovery",
  '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
  'mybay-local:recovery-candidate', 'node', 'scripts/mybay-service-recovery.mjs'
)
docker @serviceRecoveryHelper plan --controller mybay-local-control-panel --backup /recovery/backups/backup-01 --output /recovery/backups/recovered-01
```

Review the exact container IDs, names, image IDs, source/target paths and confirmation digest. The plan contains hashes and metadata, not container environment values or decrypted credentials. Do not automatically pipe an unreviewed plan into preparation.

```powershell
$recoveryConfirmation = 'REPLACE_WITH_THE_REVIEWED_CONFIRMATION_DIGEST'
docker @serviceRecoveryHelper prepare --controller mybay-local-control-panel --backup /recovery/backups/backup-01 --output /recovery/backups/recovered-01 --confirm $recoveryConfirmation
```

Preparation rechecks the digest, restores into a new directory, creates **stopped** replacement containers with the original pinned images/configuration and recovered mounts, then transactionally updates container IDs **only in the recovered SQLite database**. No hand-edited SQL is required. The original containers retain their names and remain stopped; source records and credentials are not overwritten. The durable `backups/recovered-01/service-recovery.json` journal records only recovery metadata. Treat the entire recovered directory as sensitive because its `data/` still contains credentials.

After reviewing the prepared result:

```powershell
docker @serviceRecoveryHelper activate --state /recovery/backups/recovered-01/service-recovery.json --confirm $recoveryConfirmation
```

Activation revalidates retained containers/data, pinned networks, prepared configuration and all prepared file hashes. It parks the original container names, assigns those names to the replacements, then starts Agents followed by the controller. **`active` means containers started, not that the application is ready.** Verify controller login, Agent chat readiness, credential use, history, preview, download and a real task before accepting the recovery. A Docker start failure stops only the replacement containers and attempts to return original names; it never deletes either data tree or automatically restarts the originals.

### Return to retained containers

Wait for tasks to finish and stop the recovered controller and Agents by their recorded IDs before rollback. The command refuses running writers; it does not silently interrupt a model request.

```powershell
docker @serviceRecoveryHelper rollback --state /recovery/backups/recovered-01/service-recovery.json --confirm $recoveryConfirmation
```

Rollback restores the original container names and original bind mounts, leaving **all writers stopped**. Its `startInOrder` output lists the original Agents followed by the controller: review it, start those exact containers with `docker start`, then revalidate application access. Writes made in the recovered copy are retained there and are not merged into the original data.

Operational limits and interrupted operations:

- New recovery-session containers initially use restart policy `no` and omit Compose ownership labels. Do not run `docker compose up` against the old configuration: Compose may select the parked original controller. Use the separate reviewed adoption workflow below for durable management, or roll back before returning to the original Compose workflow.
- Container names, pinned images, source database/configuration or networks changed by another operator invalidate the transition. Do not bypass these checks; review the retained recovery point.
- Each journal has an exclusive operation lock. After a helper crash, confirm that helper and any replacement writers are stopped, review the journal/container state, and only then have an administrator remove the stale `.service-recovery.lock`. A `preparing`/`prepare-failed`/`activating` journal can be reconciled by `rollback`; never retry preparation into the existing output directory.
- The helper never deletes containers, images, backups or old data. Partial output and stopped replacements remain for review. A lost source container, unavailable image, cross-version schema migration, external message delivery and production recovery remain outside this first-version contract.

### Adopt recovered data into a dedicated Compose project

The local candidate adds `adopt-plan`, `adopt-prepare`, `adopt`, `adopt-verify`, and `adopt-rollback`. This is a second, explicit maintenance handoff after the recovery session has passed acceptance. **Only the controller becomes Compose-managed. Agents remain managed by MyBay**, retain their recovered container IDs/data mounts, and receive `unless-stopped` restart policies. The root project's `.env`, Compose files, original containers and source data are not rewritten.

Before starting: stop the recovered controller and every recovered Agent after tasks have finished. The retained originals must remain stopped. Platform schedules must be paused; disable Agent-native/external automation separately. Retained containers with policies other than `no`/`unless-stopped` are rejected, because they could unexpectedly start after a daemon restart. Review those policies separately, then take a fresh recovery plan; do not edit the journal to bypass a mismatch.

Use the same separate Linux helper, mounted paths, state and recovery digest as above:

```powershell
docker @serviceRecoveryHelper adopt-plan --state /recovery/backups/recovered-01/service-recovery.json --confirm $recoveryConfirmation

# Review the dedicated project, pinned image, recovered path and Agent IDs.
$adoptionConfirmation = 'REPLACE_WITH_REVIEWED_ADOPTION_CONFIRMATION'
docker @serviceRecoveryHelper adopt-prepare --state /recovery/backups/recovered-01/service-recovery.json --confirm $recoveryConfirmation --adopt-confirm $adoptionConfirmation
```

Preparation writes `compose-adoption/compose.json` under the recovery output and parks the stopped recovery-session controller. This file includes the **actual controller environment, including passwords/keys**, to preserve it exactly; it is created with owner-only permissions. Do not print `docker compose config` into logs, commit/upload this directory, move it without review, or replace it with the old `.env`. On Linux, helper-generated recovery directories/files are root-owned: run the maintenance Compose commands with `sudo` rather than weakening their permissions. On Windows, also protect the directory using your account's NTFS permissions. Literal dollar signs are escaped for [Compose interpolation](https://docs.docker.com/reference/compose-file/interpolation/).

On the **host**, use the exact `project` and `composeFile` returned by preparation. Create the controller without starting it:

```powershell
$adoptedProject = 'REPLACE_WITH_RETURNED_PROJECT'
$adoptedCompose = 'REPLACE_WITH_RETURNED_ABSOLUTE_COMPOSE_FILE'
docker compose --project-name $adoptedProject --file $adoptedCompose create --no-build --pull never controller

docker @serviceRecoveryHelper adopt --state /recovery/backups/recovered-01/service-recovery.json --confirm $recoveryConfirmation
```

`adopt` checks the stopped Compose container's image, environment, mounts, execution/security settings, network identity and aliases against the recovered controller. It also checks the private file hash and that the database did not change during handoff. Unsupported configuration differences are rejected rather than silently dropped. Only after these checks are the recovered Agent policies updated. No service is automatically started; the journal allows a partial policy update to be reconciled by `adopt-rollback`.

Start the exact Agent names in the returned `startInOrder` list, then start the controller with the dedicated project:

```powershell
# First: docker start <each returned recovered Agent name>
docker compose --project-name $adoptedProject --file $adoptedCompose up -d --no-build --pull never --no-recreate controller
docker @serviceRecoveryHelper adopt-verify --state /recovery/backups/recovered-01/service-recovery.json --confirm $recoveryConfirmation
```

`adopt-verify` checks container ownership, pinned configuration, recovered bindings and restart policies, including a controller recreated by this Compose project. It does not open a running SQLite database or assert model readiness. Separately verify login, Agent readiness, history, file preview/download and a real task. For future controller restarts, use this dedicated Compose file/project, not the original project. All networks are external so Compose does not own or remove them. Keep the retained containers/data until the recovery retention period is reviewed.

For a planned controller recreation, finish all tasks, stop the recovered writers, and use the same dedicated file/project with `create --no-build --pull never --force-recreate controller`. Run `adopt-verify` before starting Agents/controller again. Do not change images, secrets, mounts or settings in the generated file under this journal; upgrades and new recovery points are separate operations. New/deleted/redeployed Agents or changed network/configuration invalidate this fixed-cohort verification and require a fresh reviewed maintenance plan.

To withdraw the handoff, first stop the Compose controller and all recovered Agents. Then:

```powershell
docker @serviceRecoveryHelper adopt-rollback --state /recovery/backups/recovered-01/service-recovery.json --confirm $recoveryConfirmation
docker @serviceRecoveryHelper rollback --state /recovery/backups/recovered-01/service-recovery.json --confirm $recoveryConfirmation
```

The first command returns to the stopped recovery session and resets its Agent policies to `no`; the second returns names to the original source containers. Both retain all data and the stopped Compose copy. Start only the reviewed original `startInOrder` cohort afterward. **The withdrawn Compose project must no longer be run**: its retained controller still has Compose ownership labels. Old-source and recovered writes are not merged. If configuration/identity drift prevents safe reconciliation, preserve the stopped containers and journal for manual review; do not delete evidence or force the transition.

The policies use Docker's [`unless-stopped` semantics](https://docs.docker.com/engine/containers/start-containers-automatically/), not a new host startup service. Docker Desktop/Engine must itself start after host boot. An explicitly stopped container remains stopped; policy verification and explicit restart/recreation tests are not proof of a physical-machine or Docker-daemon reboot.

### Synthetic Docker regression

`scripts/service-recovery-docker-smoke.mjs` invokes the actual four CLI commands against a real production controller and a synthetic Agent process, checks HTTP login/history/download and both data mounts, rejects live rollback, then returns to retained containers. It uses newly generated fixture credentials, never calls a provider, and removes only its uniquely labelled test containers/network. Its synthetic host data is retained. CI runs it separately from the socket-free application smoke below; it requires the Docker socket and a dedicated empty test directory. This is not a real Hermes/model end-to-end test of the new CLI.

A separate isolated real-Hermes rehearsal on 2026-08-31 exercised the packaged CLI, fresh browser login, preserved history/configuration, preview, authenticated file downloads and real model tasks after activation and rollback. It exposed and fixed the actual `config_json` record-shape mismatch that the initial synthetic fixture had missed. See the [acceptance evidence](release-validation.md). This closes the same-image CLI rehearsal only; durable Compose adoption, browser-save verification for the final first-install artifacts and cross-version migration remain separate gates.

`scripts/service-adoption-docker-smoke.mjs` is the separate host-side Compose regression. Set `MYBAY_ADOPTION_SMOKE=1`, `MYBAY_ADOPTION_SMOKE_ROOT` to a dedicated test directory, and `MYBAY_ADOPTION_SMOKE_IMAGE` to the locally built candidate. Run as an administrator/root on Linux because the helper's private files are root-owned. It checks actual Compose creation, adoption, restart, controller recreation, literal environment preservation, Agent restart, and withdrawal/source rollback using synthetic credentials and a synthetic Agent. It removes only its uniquely labelled fixture containers/network; synthetic files are retained. Do not point it at business data. The CI step is separate from the original socket-free and recovery-session tests.

## Repeatable isolated application rehearsal

`scripts/recovery-runtime-smoke.mjs` starts the actual production bundle inside a disposable container, creates synthetic credentials through the HTTP API, stops all fixture writers, backs up and restores data, then verifies login, credential decryption, sanitized responses, history, upload HTTP access and artifact hashes. It also verifies that a future schema is rejected unchanged and that the preserved source data can be started again. All passwords and keys are newly generated in memory; no real model is called.

After building `mybay-local:recovery-candidate` above, run from the project root in PowerShell:

```powershell
docker run --rm --network none --env MYBAY_RECOVERY_SMOKE=1 --mount "type=bind,source=$((Get-Location).Path)/scripts/recovery-runtime-smoke.mjs,target=/app/scripts/recovery-runtime-smoke.mjs,readonly" mybay-local:recovery-candidate node scripts/recovery-runtime-smoke.mjs
```

Do not add host data mounts, Docker socket access, published ports, or real secrets. CI runs the same opt-in check after building its image. This is same-image recovery and failed-start fallback with synthetic data, not a real Hermes Agent rebuild, browser download test or cross-version upgrade certification.
