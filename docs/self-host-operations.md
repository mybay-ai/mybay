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

Logs, caches, container images, and `.env` are excluded. The database can contain encrypted credentials and instance workspaces can contain provider material. On Unix-like systems, backup directories are restricted to `0700` and regular files to `0600`; backup creation fails if those permissions cannot be applied. Windows keeps its native access-control behavior.

## Restore status

Automated restore is intentionally not included in v0.1.x. A safe restore must stop all writers, validate format and schema compatibility, preserve the current state, restore atomically, and re-run SQLite integrity and application schema checks. Until that workflow is implemented and tested, verify a backup before maintenance and follow a reviewed manual recovery procedure rather than overwriting a running database.
