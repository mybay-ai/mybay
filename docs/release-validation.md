# Release validation scope

This public summary separates source checks from deployment certification. Private acceptance records, screenshots, test credentials, databases, and machine-specific logs are not part of the repository or source archive.

## v0.1.25 coverage

- Automated coverage includes conversation placement and authorization, pagination and stale-response isolation, cancellation and retries, structured questions, attachment upload safety, file evidence and diffs, diagnostic redaction, and backup/recovery safeguards.
- Local browser acceptance during development covered history display, single-line title truncation and hover scrolling, chat workflows, uploads, and preview/download interactions. A user-confirmed history drag was checked against persisted ordering. This does not certify every pointer device or cross-group gesture.
- Isolated same-image recovery rehearsals covered production control-plane processes, synthetic fixtures, and a separate real-Hermes/model exercise. Controlled Compose adoption was tested with synthetic Agents, including recreate and rollback. Neither exercise is a cross-version migration certification.

## Remaining environment checks

- Repeat fresh clone and ZIP installation with the final source version. Verify first file generation, browser preview and saved-download contents, stop/follow-up, and restart persistence.
- Verify any published container tag using an anonymous pull. A source ZIP or Git push does not establish GHCR availability or multi-architecture image readiness.
- Rehearse persistent recovery adoption with real Hermes/model credentials and the target host's startup behavior. Host or Docker daemon restart, external channels, and cross-version migration/rollback require their own evidence.
- Keep temporary test credential copies private and clean them separately after confirming their exact scope. Never reuse cleanup procedures against production data.
- Earlier local recovery rehearsals observed an unexplained confirmation-digest change and a transient SQLite read error; subsequent checks succeeded. Scoped store access was later improved, but those earlier observations are not proof of a diagnosed root cause. Validate a consistent backup and database integrity before maintenance. Do not access a live Docker-mounted SQLite database from an unrelated host SQLite process.

Run `npm run check:version`, `npm run check`, and `npm run release:check -- <archive>` for a release candidate. Record local results separately from GitHub Actions and target-environment acceptance. See [operations](self-host-operations.md) for maintenance boundaries.
