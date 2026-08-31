# MyBay Open Source Roadmap

This roadmap covers the self-hosted, local-first, single-administrator edition.

## Completed

- SQLite persistence with WAL, transactional migrations, and schema versioning.
- Desktop, LAN, and server deployment modes with Compose validation.
- Recursive i18n parity, mojibake, hardcoded-copy, local-edition-copy, and API error contract guards.
- Clean release archive creation and validation.
- Conversation history groups, persistent drag ordering, and hover-readable titles.
- Sanitized diagnostic exports, local structured questions, attachment progress, and bounded file diffs.
- Agent run lifecycle persistence, recovery, event progress, artifacts, and billing metadata.
- Minimal doctor, consistent backup, and backup verification commands.
- Local candidate: filtered workspace backups and verified restore into a new directory, including application-store recovery tests. See [operations and manual cutover boundaries](./docs/self-host-operations.md).
- Tag-driven GitHub Release and GHCR multi-architecture pipeline.

## v0.1.x

- Close the remaining [first-install validation gates](./docs/release-validation.md): browser download persistence, temporary credential cleanup, real control-plane/Agent recovery and rollback, and anonymous pulls from the renamed GHCR image entry point. Synthetic Windows/Docker backup-and-restore checks now pass; candidate-version checks are not a released-version certification.
- Expand request-correlation error contracts across deployment, files, model-provider, and chat routes.
- Extend isolated restore into a rehearsed control-plane/Agent cutover and cross-version rollback workflow; restoring files alone does not close this gate.
- Reduce ESLint warning debt and expand the fully strict TypeScript boundary.
- Continue behavior-preserving extraction from oversized lifecycle modules.

## v0.2

- Extend diagnostic exports with additional explicitly reviewed, non-sensitive fields.
- Add upgrade and rollback fixtures across all deployment modes.
- Extend third-party runtime compatibility validation without changing the Hermes-first support boundary.

## Future

- Additional self-hosted runtime adapters after their lifecycle and security contracts are stable.
- More granular local resource and storage trend diagnostics.

## Non-goals

- SaaS accounts, subscription billing, or hosted quotas.
- Multi-tenant or distributed cluster orchestration.
- A cloud control plane or Kubernetes requirement.
