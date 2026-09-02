[CmdletBinding()]
param(
    [ValidateSet("desktop", "lan", "server")]
    [string]$Mode = "desktop",

    [string]$LanBindIp = "",

    [switch]$InstallPrerequisites,

    [switch]$UsePrebuiltImage,

    [switch]$PromptAdminPassword,

    [switch]$OpenBrowser,

    [Alias("h")]
    [switch]$Help
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Output "Usage: .\quick-start.ps1 [-Mode desktop|lan|server] [-LanBindIp 192.168.1.20] [-InstallPrerequisites] [-UsePrebuiltImage] [-PromptAdminPassword] [-OpenBrowser]"
    Write-Output "  desktop  Local computer deployment (default)"
    Write-Output "  lan      Local-network deployment bound to one host IPv4 address"
    Write-Output "  server   Public server deployment with Traefik and HTTPS"
    Write-Output "  -InstallPrerequisites  Install Docker Desktop with winget when needed, then start it"
    Write-Output "  -UsePrebuiltImage      Pull the versioned MyBay image instead of building source locally"
    Write-Output "  -PromptAdminPassword   Ask for the initial administrator password without echoing it"
    Write-Output "  -OpenBrowser           Open the control panel after the health check succeeds"
    return
}

$ProjectName = "MyBay Open Source"
$ProjectRoot = $PSScriptRoot
$EnvPath = Join-Path $ProjectRoot ".env"
$EnvExamplePath = Join-Path $ProjectRoot ".env.example"
# The mode helper owns TRUST_PROXY, PUBLIC_APP_URL, VITE_PUBLIC_APP_URL, and VITE_MYBAY_PLATFORM_ORIGIN transitions.
. (Join-Path $ProjectRoot "scripts\quick-start-env.ps1")
. (Join-Path $ProjectRoot "scripts\windows-preflight.ps1")
$script:ComposeExecutable = ""
$script:ComposePrefix = @()
$script:GeneratedAdminPassword = ""

function Write-Step([string]$Step, [string]$Message) {
    Write-Host "`n[$Step] $Message"
}

function Fail([string]$Message) {
    throw $Message
}

function Get-PreferredHostDns {
    try {
        $adapters = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.ServerAddresses.Count -gt 0 -and
                $_.InterfaceAlias -notmatch '(?i)xray|tun|tap|vpn|loopback|vethernet|docker|wsl'
            }
        foreach ($adapter in $adapters) {
            foreach ($server in $adapter.ServerAddresses) {
                $parsed = $null
                if ([Net.IPAddress]::TryParse($server, [ref]$parsed) -and
                    $parsed.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and
                    $server -ne "0.0.0.0" -and
                    -not $server.StartsWith("127.")) {
                    return $server
                }
            }
        }
    } catch {
        return ""
    }
    return ""
}

function Test-Command([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-DockerDesktopInstallRoots {
    $roots = @()
    if ($env:ProgramFiles) {
        $roots += (Join-Path $env:ProgramFiles "Docker\Docker")
    }
    if ($env:LOCALAPPDATA) {
        $roots += (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop")
        $roots += (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker")
        $roots += (Join-Path $env:LOCALAPPDATA "Docker")
    }
    return @($roots | Select-Object -Unique)
}

function Add-DockerCliToProcessPath {
    foreach ($root in Get-DockerDesktopInstallRoots) {
        $dockerBin = Join-Path $root "resources\bin"
        $dockerExe = Join-Path $dockerBin "docker.exe"
        if ((Test-Path -LiteralPath $dockerExe) -and ($env:Path -split ';' -notcontains $dockerBin)) {
            $env:Path = "$dockerBin;$env:Path"
        }
    }
}

function Find-DockerDesktopExecutable {
    foreach ($root in Get-DockerDesktopInstallRoots) {
        $candidate = Join-Path $root "Docker Desktop.exe"
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }
    return ""
}

function Test-DockerDaemon {
    if (-not (Test-Command "docker")) {
        return $false
    }

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # PowerShell 7 can promote native stderr to an error when the daemon is unavailable.
        $ErrorActionPreference = "Continue"
        & docker info *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

function Install-DockerDesktop {
    if (-not (Test-Command "winget")) {
        Start-Process "https://docs.docker.com/desktop/setup/install/windows-install/" | Out-Null
        Fail "Docker was not found and winget is unavailable. Install Docker Desktop manually, then retry: https://docs.docker.com/desktop/setup/install/windows-install/"
    }

    Write-Host "Docker Desktop is required while MyBay is running."
    Write-Host "Installing Docker Desktop with winget; Windows may request administrator approval."
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & winget install --exact --id Docker.DockerDesktop --source winget --accept-package-agreements --accept-source-agreements
        $installExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($installExitCode -ne 0) {
        Start-Process "https://docs.docker.com/desktop/setup/install/windows-install/" | Out-Null
        Fail "Docker Desktop installation failed with winget exit code $installExitCode. Complete any pending Windows updates or restart, then rerun this command."
    }

    Add-DockerCliToProcessPath
    if (-not (Test-Command "docker")) {
        Save-MyBayInstallState $ProjectRoot "docker_desktop" "install"
        Register-MyBayInstallResume $ProjectRoot
        throw "[MYBAY_RESTART_REQUIRED] Docker Desktop was installed, but Windows must restart before its CLI is available. Installation will continue automatically after sign-in."
    }
}

function Start-DockerDesktopAndWait([int]$TimeoutSeconds = 180) {
    $dockerDesktopPath = Find-DockerDesktopExecutable
    if (-not $dockerDesktopPath) {
        Fail "Docker is installed but its daemon is unavailable, and Docker Desktop could not be found. Start your Docker daemon manually and retry."
    }

    Write-Host "Starting Docker Desktop..."
    Start-Process -FilePath $dockerDesktopPath | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if (Test-DockerDaemon) {
            Write-Host "[OK] Docker Desktop is running."
            return
        }
        Write-Host "Waiting for the Docker engine to become ready..."
        Start-Sleep -Seconds 5
    } while ([DateTime]::UtcNow -lt $deadline)

    Fail "Docker Desktop did not become ready within $TimeoutSeconds seconds. Complete its first-run setup, enable WSL 2/virtualization if prompted, or restart Windows; then rerun this command."
}

function Read-Utf8Lines([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }
    return [IO.File]::ReadAllLines($Path, [Text.Encoding]::UTF8)
}

function Write-Utf8Lines([string]$Path, [string[]]$Lines) {
    $content = [string]::Join([Environment]::NewLine, $Lines)
    if ($Lines.Count -gt 0) {
        $content += [Environment]::NewLine
    }
    [IO.File]::WriteAllText($Path, $content, (New-Object Text.UTF8Encoding($false)))
}

function Get-EnvValue([string]$Key) {
    return Get-QuickStartEnvValue $EnvPath $Key
}

function Set-EnvValue([string]$Key, [string]$Value) {
    Set-QuickStartEnvValue $EnvPath $Key $Value
}

function New-RandomBytes([int]$Length) {
    $bytes = New-Object byte[] $Length
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return $bytes
}

function New-RandomHex([int]$Length) {
    return ([BitConverter]::ToString((New-RandomBytes $Length))).Replace("-", "").ToLowerInvariant()
}

function New-RandomBase64([int]$Length) {
    return [Convert]::ToBase64String((New-RandomBytes $Length))
}

function Convert-SecureStringToPlainText([Security.SecureString]$Value) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Read-InitialAdminPassword {
    Write-Host "Create the local administrator password. Use 12-64 characters with uppercase, lowercase, and a number."
    Write-Host "Safe optional symbols: ! @ % ^ * . _ + -"
    while ($true) {
        $firstSecure = Read-Host "New administrator password" -AsSecureString
        $secondSecure = Read-Host "Confirm administrator password" -AsSecureString
        $first = Convert-SecureStringToPlainText $firstSecure
        $second = Convert-SecureStringToPlainText $secondSecure
        if ($first.Length -lt 12 -or $first.Length -gt 64) {
            Write-Warning "The password must contain 12-64 characters."
            continue
        }
        if ($first -notmatch '[A-Z]' -or $first -notmatch '[a-z]' -or $first -notmatch '[0-9]') {
            Write-Warning "The password must include uppercase, lowercase, and numeric characters."
            continue
        }
        if ($first -notmatch '^[A-Za-z0-9!@%^*._+\-]+$') {
            Write-Warning "The password contains a character that is unsafe in a local environment file."
            continue
        }
        if ($first -ne $second) {
            Write-Warning "The passwords do not match. Try again."
            continue
        }
        return $first
    }
}

function Invoke-Compose([string[]]$Arguments, [switch]$AllowFailure) {
    $allArguments = @($script:ComposePrefix) + @($Arguments)
    & $script:ComposeExecutable @allArguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        Fail "Docker Compose failed with exit code $exitCode."
    }
    return $exitCode
}

function Test-Domain([string]$Value) {
    return $Value -match '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
}

function Get-RequiredValue([string]$Key, [string]$Prompt) {
    $current = Get-EnvValue $Key
    if ($current -eq "localhost") {
        $current = ""
    }
    $label = if ($current) { "$Prompt [$current]" } else { $Prompt }
    $value = Read-Host $label
    if (-not $value) {
        $value = $current
    }
    if (-not $value) {
        Fail "$Key is required."
    }
    return $value
}

function Test-HttpReady([string]$HostAddress, [int]$Port) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://${HostAddress}:$Port/api/health" -TimeoutSec 3
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "http://${HostAddress}:$Port/" -TimeoutSec 3
            return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
        } catch {
            return $false
        }
    }
}

Push-Location $ProjectRoot
try {
    Write-Host "`n============================================================"
    Write-Host " $ProjectName - guided Docker deployment for PowerShell"
    Write-Host "============================================================"

    $composeFile = if ($UsePrebuiltImage) { "docker-compose.windows.yml" } else { "docker-compose.yml" }
    if (-not (Test-Path -LiteralPath $composeFile)) {
        Fail "$composeFile was not found. The project archive may be incomplete."
    }
    if (-not (Test-Path -LiteralPath $EnvExamplePath)) {
        Fail ".env.example was not found. The project archive may be incomplete."
    }

    $modeWasExplicit = $PSBoundParameters.ContainsKey("Mode")
    if (-not $modeWasExplicit -and (Test-Path -LiteralPath $EnvPath)) {
        $savedMode = Get-EnvValue "DEPLOYMENT_MODE"
        if ($savedMode -in @("desktop", "lan", "server")) {
            $Mode = $savedMode
        }
    }

    Write-Step "1/6" "Checking Windows, WSL, Docker, and system dependencies..."
    Add-DockerCliToProcessPath
    $dockerAlreadyReady = Test-DockerDaemon
    Assert-MyBayWindowsHostReady -ProjectRoot $ProjectRoot -InstallPrerequisites:$InstallPrerequisites -DockerAlreadyReady:$dockerAlreadyReady
    if (-not (Test-Command "docker")) {
        if (-not $InstallPrerequisites) {
            Fail "Docker was not found. Install Docker Desktop first, or rerun with -InstallPrerequisites to install it with winget."
        }
        Install-DockerDesktop
    }
    if (-not (Test-DockerDaemon)) {
        if (-not $InstallPrerequisites) {
            Fail "Docker is installed but the Docker daemon is not running. Start Docker Desktop and retry, or rerun with -InstallPrerequisites to start it and wait."
        }
        Start-DockerDesktopAndWait
    }
    Assert-MyBayDockerLinuxEngine

    & docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        $script:ComposeExecutable = "docker"
        $script:ComposePrefix = @("compose", "-f", $composeFile)
    } elseif (Test-Command "docker-compose") {
        $script:ComposeExecutable = "docker-compose"
        $script:ComposePrefix = @("-f", $composeFile)
    } else {
        Fail "Docker Compose was not found. Install Docker Desktop or Docker Compose v2 and retry."
    }

    if ($Mode -eq "server") {
        if (-not (Test-Path -LiteralPath "docker-compose.server.yml") -or -not (Test-Path -LiteralPath "deploy/traefik/dynamic.yml")) {
            Fail "Server deployment files are missing. The project archive may be incomplete."
        }
        $script:ComposePrefix += @("-f", "docker-compose.server.yml")
    }

    $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($ProjectRoot).TrimEnd('\').TrimEnd(':')) -ErrorAction SilentlyContinue
    if ($drive -and $drive.Free -lt 10GB) {
        Write-Warning "Less than 10 GB of free disk space is available."
    }

    Write-Step "2/6" "Preparing persistent data and environment configuration..."
    if (-not (Test-Path -LiteralPath "data")) {
        New-Item -ItemType Directory -Path "data" | Out-Null
    }
    if (-not (Test-Path -LiteralPath $EnvPath)) {
        Copy-Item -LiteralPath $EnvExamplePath -Destination $EnvPath
        Write-Host "[OK] Created .env from .env.example."
    } else {
        Write-Host "[OK] Existing .env was preserved."
    }

    if (-not (Get-EnvValue "MYBAY_ASYNC_CHAT_RUNS_ENABLED")) {
        Set-EnvValue "MYBAY_ASYNC_CHAT_RUNS_ENABLED" "true"
    }

    if (-not (Get-EnvValue "MYBAY_CONTROL_PANEL_DNS")) {
        $preferredDns = Get-PreferredHostDns
        if ($preferredDns) {
            Set-EnvValue "MYBAY_CONTROL_PANEL_DNS" $preferredDns
            Write-Host "[OK] Detected host DNS for the control-panel container: $preferredDns"
        }
    }

    Write-Step "3/6" "Generating secure local secrets when needed..."
    $jwtSecret = Get-EnvValue "JWT_SECRET"
    if ($jwtSecret.Length -lt 32 -or $jwtSecret -eq "replace-with-a-random-32-byte-secret") {
        Set-EnvValue "JWT_SECRET" (New-RandomBase64 48)
    }
    $encryptionKey = Get-EnvValue "ENCRYPTION_KEY"
    if ($encryptionKey -notmatch '^[0-9a-fA-F]{64}$') {
        Assert-QuickStartEncryptionKeyGenerationSafe (Join-Path $ProjectRoot "data\mybay.sqlite")
        Set-EnvValue "ENCRYPTION_KEY" (New-RandomHex 32)
    }
    $routingSecret = Get-EnvValue "MYBAY_INTERNAL_ROUTING_SECRET"
    if ($routingSecret -notmatch '^[0-9a-fA-F]{64}$') {
        Set-EnvValue "MYBAY_INTERNAL_ROUTING_SECRET" (New-RandomHex 32)
    }
    $adminPassword = Get-EnvValue "LOCAL_ADMIN_PASSWORD"
    if (-not $adminPassword -or $adminPassword -eq "change-me-now") {
        $script:GeneratedAdminPassword = if ($PromptAdminPassword) { Read-InitialAdminPassword } else { "mybay_$(New-RandomHex 16)" }
        Set-EnvValue "LOCAL_ADMIN_PASSWORD" $script:GeneratedAdminPassword
    }

    if ($UsePrebuiltImage) {
        $packagePath = Join-Path $ProjectRoot "package.json"
        if (-not (Test-Path -LiteralPath $packagePath)) {
            Fail "package.json was not found, so the versioned control-panel image cannot be selected."
        }
        $packageVersion = (Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version
        if (-not $packageVersion) {
            Fail "The MyBay package version is unavailable."
        }
        $currentControlPanelImage = Get-EnvValue "MYBAY_CONTROL_PANEL_IMAGE"
        if (-not $currentControlPanelImage -or $currentControlPanelImage -match '^ghcr\.io/mybay-ai/mybay:[0-9A-Za-z._-]+$') {
            Set-EnvValue "MYBAY_CONTROL_PANEL_IMAGE" "ghcr.io/mybay-ai/mybay:$packageVersion"
        } else {
            Write-Host "[OK] Preserved custom control-panel image: $currentControlPanelImage"
        }
    }

    $configPort = Get-EnvValue "PORT"
    if (-not $configPort) { $configPort = "3000" }
    $numericConfigPort = if ($configPort -match '^\d+$') { [int]$configPort } else { 3000 }

    if ($Mode -eq "server") {
        $numericConfigPort = Resolve-MyBayControlPanelPort "127.0.0.1" $numericConfigPort
        $configPort = [string]$numericConfigPort
        $controlPanelDomain = Get-RequiredValue "CONTROL_PANEL_DOMAIN" "Control panel domain (for example console.example.com)"
        if (-not (Test-Domain $controlPanelDomain)) {
            Fail "CONTROL_PANEL_DOMAIN must be a hostname without scheme, path, port, or wildcard."
        }
        $instanceRootDomain = Get-RequiredValue "MYBAY_INSTANCE_ROOT_DOMAIN" "Agent root domain (for example agents.example.com)"
        if (-not (Test-Domain $instanceRootDomain)) {
            Fail "MYBAY_INSTANCE_ROOT_DOMAIN must be a hostname without scheme, path, port, or wildcard."
        }
        $letsencryptEmail = Get-RequiredValue "LETSENCRYPT_EMAIL" "Email for HTTPS certificate notices"
        if ($letsencryptEmail -notmatch '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') {
            Fail "LETSENCRYPT_EMAIL is not a valid email address."
        }

        Set-QuickStartDeploymentEnv $EnvPath "server" "" $configPort $controlPanelDomain $instanceRootDomain $letsencryptEmail
    } elseif ($Mode -eq "lan") {
        if (-not $LanBindIp) {
            $LanBindIp = Get-EnvValue "DEPLOYMENT_LAN_BIND_IP"
        }
        if (-not $LanBindIp -and (Test-Command "Get-NetIPAddress")) {
            $LanBindIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.AddressState -eq "Preferred" } |
                Select-Object -First 1 -ExpandProperty IPAddress
        }
        $enteredIp = Read-Host "LAN IPv4 address [$LanBindIp]"
        if ($enteredIp) {
            $LanBindIp = $enteredIp
        }
        $parsedLanIp = $null
        if (-not [Net.IPAddress]::TryParse($LanBindIp, [ref]$parsedLanIp) -or $parsedLanIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
            Fail "A valid LAN IPv4 address is required."
        }
        $numericConfigPort = Resolve-MyBayControlPanelPort $LanBindIp $numericConfigPort
        $configPort = [string]$numericConfigPort
        Set-QuickStartDeploymentEnv $EnvPath "lan" $LanBindIp $configPort
    } else {
        $numericConfigPort = Resolve-MyBayControlPanelPort "127.0.0.1" $numericConfigPort
        $configPort = [string]$numericConfigPort
        Set-QuickStartDeploymentEnv $EnvPath "desktop" "localhost" $configPort
    }

    $healthHost = if ($Mode -eq "lan") { $LanBindIp } else { "127.0.0.1" }
    $portValue = Get-EnvValue "PORT"
    $appPort = if ($portValue -match '^\d+$') { [int]$portValue } else { 3000 }

    if ($UsePrebuiltImage) {
        Write-Step "4/6" "Pulling the versioned MyBay image and starting Docker services..."
        $controlPanelImage = Get-EnvValue "MYBAY_CONTROL_PANEL_IMAGE"
        $localImageAvailable = Test-MyBayDockerImagePresent $controlPanelImage
        $remoteImageAvailable = $true
        try {
            Assert-MyBayControlPanelImageAvailable $controlPanelImage
        } catch {
            if (-not $localImageAvailable) { throw }
            $remoteImageAvailable = $false
            Write-Warning "Registry check failed, but the pinned image already exists locally. MyBay will start offline. $($_.Exception.Message)"
        }
        if ($remoteImageAvailable) {
            try {
                Invoke-Compose @("pull", "mybay-local") | Out-Null
            } catch {
                if (-not $localImageAvailable) { throw }
                Write-Warning "The image refresh failed. MyBay will use the existing local pinned image."
            }
        }
        Invoke-Compose @("up", "-d", "--remove-orphans") | Out-Null
    } else {
        Write-Step "4/6" "Building and starting Docker services..."
        Invoke-Compose @("up", "-d", "--build", "--remove-orphans") | Out-Null
    }

    Write-Step "5/6" "Waiting for the control panel to become ready..."
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-HttpReady $healthHost $appPort) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        Invoke-Compose @("ps") -AllowFailure | Out-Null
        Fail "The control panel did not become ready within 60 seconds. Check Docker Compose logs."
    }
    $socketCheck = Invoke-Compose @("exec", "-T", "mybay-local", "sh", "-c", "test -S /var/run/docker.sock && test -r /var/run/docker.sock && test -w /var/run/docker.sock") -AllowFailure
    if ($socketCheck -ne 0) {
        Fail "The control panel is running, but its Docker socket is not accessible. Agent containers cannot be created until Docker Desktop socket sharing is repaired."
    }
    Write-Host "[OK] Control-panel Docker socket access is ready for Agent creation."

    Write-Step "6/6" "Deployment completed successfully."
    if ($Mode -eq "server") {
        $accessUrl = "https://$controlPanelDomain"
        Write-Host "`nAccess URL: $accessUrl"
        Write-Host "Agent domain pattern: https://<agent>.$instanceRootDomain"
    } elseif ($Mode -eq "lan") {
        $accessUrl = "http://${LanBindIp}:$appPort"
        Write-Host "`nAccess URL: $accessUrl"
    } else {
        $accessUrl = "http://127.0.0.1:$appPort"
        Write-Host "`nAccess URL: $accessUrl"
    }
    $adminUsername = Get-EnvValue "LOCAL_ADMIN_USERNAME"
    if (-not $adminUsername) { $adminUsername = "admin" }
    Write-Host "Admin username: $adminUsername"
    Write-Host "Admin password: use the value stored in the local .env file (never share this file)."
    Write-Host "`nUseful commands:"
    if ($UsePrebuiltImage) {
        Write-Host "  View logs:   View-Logs.bat"
        Write-Host "  Repair:      Repair-MyBay.bat"
        Write-Host "  Stop:        Stop-MyBay.bat"
        Write-Host "  Uninstall:   Uninstall-MyBay.bat`n"
    } else {
        Write-Host "  View status: docker compose ps"
        Write-Host "  View logs:   docker compose logs -f --tail 200"
        Write-Host "  Restart:     docker compose restart"
        Write-Host "  Stop:        docker compose down`n"
    }
    if ($OpenBrowser) {
        Start-Process $accessUrl | Out-Null
    }
} catch {
    $failureMessage = $_.Exception.Message
    if ($failureMessage.StartsWith("[MYBAY_RESTART_REQUIRED]")) {
        Write-Warning $failureMessage.Substring("[MYBAY_RESTART_REQUIRED]".Length).Trim()
        exit 10
    }
    Write-Error "Deployment stopped: $failureMessage"
    if ($script:ComposeExecutable) {
        try { Invoke-Compose @("logs", "--tail", "80") -AllowFailure | Out-Null } catch { }
    }
    exit 1
} finally {
    Pop-Location
}
