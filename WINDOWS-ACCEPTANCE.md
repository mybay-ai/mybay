# MyBay clean-Windows acceptance checklist

Use this checklist to prove the real “download, extract, double-click, restart once if required” path. Run it on a clean Windows 10/11 VM without Git, Node.js, Docker Desktop, or WSL. Developer-machine automation does not replace this test.

## Acceptance path

1. Use Windows 10 22H2 build 19045+ or Windows 11 build 22631+, 64-bit, with at least 8 GB RAM and 20 GB free disk. Enable nested virtualization and create a clean VM snapshot.
2. Copy only the candidate `MyBay-Windows-*.zip`, extract it to `C:\MyBay`, and double-click `Start-MyBay.bat`.
3. Allow prerequisite installation. If prompted, restart Windows and confirm setup resumes only once after sign-in.
4. Set the administrator password and confirm the browser opens the final URL. Repeat once from a path containing spaces and once with port 3000 occupied.
5. Sign in, add a real model API key, deploy a Hermes Agent, send a message, and create/download a file.
6. Restart Windows and confirm credentials, Agent configuration, chat history, and files remain available.
7. Exercise View Logs, Stop, Start, Repair, and Uninstall. Uninstall must preserve `.env` and `data`; starting again must restore the existing installation.
8. Run `Collect-Diagnostics.bat` and retain its Markdown and JSON reports.

Sample failure cases should cover disabled virtualization, GHCR DNS/TLS/image failures, Windows-container mode, port 3000 contention, and low disk space.

Never attach `.env`, API keys, administrator passwords, or screenshots containing secrets. Automated checks do not close the product gates. Publish `v0.1.27` only after the install, product, restart, and preservation paths pass on the clean VM.

## Experimental low-memory acceptance

Keep the 8 GB clean-install baseline above. Separately test a 4 GB VM: verify that startup emits a warning and continues, diagnostics report Memory=WARN, and existing OS/WSL/virtualization/Docker checks still apply. Cover both an already-running Docker Engine and a fresh Docker Desktop installation; record any installer refusal. With a working engine, test one Agent, chat, file preview, restart, memory pressure and failures. Below 4 GB must fail; exactly 8 GB must not warn about low memory. These gates remain open until tested on the actual low-memory VM.
