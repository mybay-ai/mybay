# MyBay Windows Quick Install

This package is for 64-bit Windows 10/11 computers. MyBay does not require Git, Node.js, npm, or OpenSSL, but running Agents requires Docker Desktop with a Linux-container backend.

The MyBay launcher allows startup attempts with at least **4 GB of host RAM**. Below 4 GB it stops; from 4 GB up to (but not including) 8 GB it warns and continues; 8 GB or more meets the normal memory baseline. **Docker Desktop for Windows officially requires 8 GB**, so permitting the launcher to continue does not guarantee Docker installation or stable operation. The 4 GB path is experimental and has not been certified on a real low-memory host. Start with one Agent and avoid concurrent or memory-heavy tasks. This change does not reduce existing Agent resource limits.

## First start

1. Extract the package to a normal local directory such as `C:\MyBay`. Avoid OneDrive-synchronized directories.
2. Double-click `Start-MyBay.bat`.
3. If Docker Desktop is missing, allow the launcher to install it. If Windows requests WSL setup or a restart, restart as instructed; installation resumes after the next sign-in, and you can also double-click the same file again.
4. On the first start, enter the administrator password twice. The input is not echoed.
5. After startup succeeds, the browser opens `http://127.0.0.1:3000` automatically.

The default administrator username is `admin`. Add your model API key from Model Credentials after signing in.

Before startup, the launcher checks the Windows build and architecture, memory, disk space, hardware virtualization, WSL version, Docker Linux-container mode, the control-panel port, and GHCR image connectivity. If WSL setup requires a restart, the launcher registers a one-time continuation that resumes after the next Windows sign-in; it does not create a permanent startup entry. If port 3000 belongs to another application, MyBay selects a free port from 3001-3099 and prints the final URL.

GHCR failures are reported separately for DNS, TLS/certificate validation, anonymous-access denial, an unpublished image, and general network connectivity.

## Launchers

- `Start-MyBay.bat`: install required components and start MyBay.
- `Stop-MyBay.bat`: stop MyBay while preserving configuration and data.
- `View-Logs.bat`: follow runtime logs; press `Ctrl+C` to stop.
- `Repair-MyBay.bat`: pull the configured version-pinned image and recreate the control-plane container.
- `Uninstall-MyBay.bat`: remove MyBay containers and networks while preserving `.env` and `data`.
- `Collect-Diagnostics.bat`: generate Windows acceptance evidence without passwords or secret keys.

Use `WINDOWS-ACCEPTANCE.md` for the clean-machine release gate.

Never share `.env`. Back up both `.env` and `data`; the uninstall launcher never deletes either target.
