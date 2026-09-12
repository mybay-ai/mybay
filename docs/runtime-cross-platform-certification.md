# Runtime Cross-Platform Certification

Platform certification is stricter than ordinary CI compatibility. A Linux job, a successful image build, or a Docker health check does not by itself certify a Runtime.

## Linux headless gate

Run the manually dispatched `Linux Headless Runtime Certification Gate` on a dedicated self-hosted runner carrying all four labels: `self-hosted`, `linux`, `x64`, and `mybay-runtime-certification`.

Before the gate can pass, each Runtime evidence bundle must contain:

- a current-MyBay-version environment with `platform: "linux"`, `containerEngine: "docker-engine"`, and `headless: true`;
- retained, SHA-256-protected artifacts for every claimed check;
- an `environmentId` on every required check, matching that exact Linux headless environment;
- real Runtime or product E2E scope at or above the minimum required by the certification ladder;
- the exact admitted native version, bridge version, image reference, and immutable artifact identity.

After evidence has been reviewed and added, run:

```bash
npm run runtime:certify:linux-headless
```

The command fails closed if any admitted Runtime has no current Linux headless environment, uses unbound or cross-platform evidence, lacks a required check, or no longer matches the release identity. Do not add credentials, databases, raw prompts, private paths, or unredacted logs to retained artifacts.

The normal `npm run runtime:certify` gate remains release-wide and backward compatible with existing evidence. The generated platform matrix uses the stricter per-environment binding and may therefore show `Evidence pending target binding` for historical records that were not captured with `environmentId`.
