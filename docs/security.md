# Security

MyBay Open Source is a single-administrator, self-hosted control plane. Desktop mode binds to the local machine by default. LAN and server modes expand the network boundary and require deliberate firewall, DNS, and credential configuration.

## Deployment Boundaries

| Mode | Control-panel binding | Agent access | Intended use |
| --- | --- | --- | --- |
| `desktop` | `127.0.0.1` | Local dynamic ports and `.localhost` | Personal computer |
| `lan` | One selected private IPv4 | Dynamic ports on that address | Trusted LAN |
| `server` | Traefik Docker network | Real subdomains through HTTPS | Public server |

Do not replace the desktop binding with `0.0.0.0`. Bind LAN mode to one required address. In server mode use `./quick-start.sh --server`, expose only 80/443 publicly, and keep dynamic Agent ports private.

## Public Server Requirements

- Point the control-panel hostname and Agent wildcard hostname to the server.
- Use Traefik-managed HTTPS certificates.
- Use strong values for the admin password, `JWT_SECRET`, `ENCRYPTION_KEY`, and `MYBAY_INTERNAL_ROUTING_SECRET`.
- Open only required firewall ports. Restrict SSH and prefer key authentication.
- Add a VPN, IP allowlist, or another authentication layer if your threat model requires it.
- Keep the control panel, Traefik, and Agent images updated.

## Docker Socket

The control panel uses `/var/run/docker.sock` to create and manage Agents. Access to this socket normally implies high privilege on the host:

- Run only trusted control-panel code and images.
- Never expose the Docker socket over a public TCP endpoint.
- Do not give untrusted users control-panel access.
- Review dependencies, mounts, and newly introduced Docker arguments.

## Secrets, Files, and Logs

Never commit or publish:

- `.env`, `data/`, backups, or database exports
- Model keys, registry tokens, or webhook secrets
- JWT, encryption, or internal-routing secrets
- TLS/SSH private keys or real production logs

File previews and downloads must enforce instance ownership, safe paths, and sensitive-file checks. Block `.env`, private keys, secret-bearing text, and untrusted archives. Redact container names, domains, tokens, and request headers before posting an issue.

## Backup and Recovery

Back up `data/` and the protected `.env` regularly and store them encrypted and separately. Restore with the original `ENCRYPTION_KEY`; otherwise encrypted model credentials may be unreadable.

## Release Checklist

Before publishing a fork or release, confirm:

- Git contains no environment files, data, uploads, logs, certificates, or keys.
- All platform data is stored on the current machine; hosted billing and commercial model gateways are outside this edition.
- Desktop, LAN, and server modes do not unintentionally broaden port bindings.
- English, Chinese, and in-app documentation contain no commercial account, quota, or cloud-database instructions.

Report vulnerabilities privately according to the repository-root `SECURITY.md`, not through public issues.
