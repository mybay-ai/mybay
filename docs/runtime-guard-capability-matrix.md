# MyBay Open Source Preview Runtime Guard Capability Matrix

This matrix is derived from the deployed single-container path in `server/dockerDeployment.ts` and the explicit runtime contract consumed by `createRuntimeSecurityManifest`. Guard names are not treated as proof of enforcement.

| Skill | Runtime status | Requires sandbox | Required guards | Actually provided on current agent runtime | Capability source | Missing guards | Result |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| browser | coming_soon | yes | restrict-localhost; restrict-internal-network; restrict-metadata-service; ephemeral-profile | no matching runtime-internal guards; ordinary runtime is not sandboxed | Docker: no Docker socket, workspace mount, read-only root filesystem, bounded init capabilities, and resource limits; Runtime Manifest: none; Internal Runtime Contract: none | all required guards; sandbox runtime | disabled |
| shell | coming_soon | yes | non-root-user; no-docker-socket; mount-workspace-only; no-new-privileges; drop-all-capabilities; resource-limits; command-timeout | no-docker-socket; mount-workspace-only; read-only root filesystem; resource-limits; Hermes Agent child processes run as uid 10000 under a root s6 supervisor with capabilities dropped except CHOWN/DAC_OVERRIDE/KILL/SETGID/SETUID | Docker HostConfig only; Runtime Manifest: none; Internal Runtime Contract: none | container-level non-root-user; no-new-privileges; drop-all-capabilities; command-timeout; sandbox runtime | disabled |
| file_system | coming_soon | no | workspace-root-only; path-traversal-protection; zip-slip-protection; audit-logging | no matching runtime-internal guards | Docker: workspace mount only (not equivalent); Runtime Manifest: none; Internal Runtime Contract: none | all required guards | disabled |
| custom_webhooks | coming_soon | no | egress-filtering | no egress enforcement contract | Docker DNS configuration is not egress filtering; Runtime Manifest: none; Internal Runtime Contract: none | egress-filtering | disabled |
| github | coming_soon | no | token-scope-protection | no token scope enforcement contract | Docker: none; Runtime Manifest: none; Internal Runtime Contract: none | token-scope-protection | disabled |
| feishu | coming_soon | no | token-scope-protection | no token scope enforcement contract | Docker: none; Runtime Manifest: none; Internal Runtime Contract: none | token-scope-protection | disabled |
| file_read | available | no | none | no additional guard required | Policy contract | none | available |
| tavily_search | available | no | none | no additional guard required | Policy contract | none | available |
| google_search | available | no | none | no additional guard required | Policy contract | none | available |

`docker` remains an admin-only, production-disabled capability and is not part of the user-selectable available list. `crypto` remains coming soon.

The Hermes exceptions above are image-specific. They were measured against the pinned `nousresearch/hermes-agent:v2026.8.27` image: `no-new-privileges` blocks its s6 stage0 transition, and removing `KILL` prevents a graceful container stop. Pi and Codex retain their non-root, drop-all-capabilities, no-new-privileges profiles.
