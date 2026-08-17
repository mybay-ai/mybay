# MyBay Open Source Roadmap

This roadmap covers the self-hosted, local-first, single-administrator edition.

## Completed

- SQLite persistence with WAL, transactional migrations, and schema versioning.
- Desktop, LAN, and server deployment modes with Compose validation.
- Recursive i18n parity, mojibake, hardcoded-copy, local-edition-copy, and API error contract guards.
- Clean release archive creation and validation.
- Agent run lifecycle persistence, recovery, event progress, artifacts, and billing metadata.
- Minimal doctor, consistent backup, and backup verification commands.
- Tag-driven GitHub Release and GHCR multi-architecture pipeline.

## v0.1.x

- Expand request-correlation error contracts across deployment, files, model-provider, and chat routes.
- Add a tested, stop-the-world restore workflow with rollback.
- Reduce ESLint warning debt and expand the fully strict TypeScript boundary.
- Continue behavior-preserving extraction from oversized lifecycle modules.

## v0.2

- Export a redacted diagnostic bundle.
- Add upgrade and rollback fixtures across all deployment modes.
- Extend third-party runtime compatibility validation without changing the Hermes-first support boundary.

## Future

- Additional self-hosted runtime adapters after their lifecycle and security contracts are stable.
- More granular local resource and storage trend diagnostics.

## Non-goals

- SaaS accounts, subscription billing, or hosted quotas.
- Multi-tenant or distributed cluster orchestration.
- A cloud control plane or Kubernetes requirement.
