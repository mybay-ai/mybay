$script:MyBayMinimumWslVersion = [Version]"2.1.5"
$script:MyBayInstallStateName = ".mybay-install-state.json"
$script:MyBayRunOnceName = "MyBayInstallResume"

function Get-MyBayOptionalPropertyValue($InputObject, [string]$Name, $DefaultValue = $null) {
    if ($null -eq $InputObject) { return $DefaultValue }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) { return $DefaultValue }
    return $property.Value
}

function Test-MyBayIsWindows {
    return [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows)
}

function Get-MyBayWindowsHostFacts([string]$ProjectRoot) {
    if (-not (Test-MyBayIsWindows)) {
        return $null
    }

    $currentVersion = Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
    $computer = Get-CimInstance Win32_ComputerSystem
    $processors = @(Get-CimInstance Win32_Processor)
    $hypervisorPresent = [bool](Get-MyBayOptionalPropertyValue $computer "HypervisorPresent" $false)
    $firmwareVirtualization = $processors.Count -gt 0 -and @($processors | Where-Object {
        (Get-MyBayOptionalPropertyValue $_ "VirtualizationFirmwareEnabled" $null) -eq $true
    }).Count -eq $processors.Count
    $virtualizationReady = $hypervisorPresent -or $firmwareVirtualization
    $driveRoot = [IO.Path]::GetPathRoot($ProjectRoot).TrimEnd('\').TrimEnd(':')
    $drive = Get-PSDrive -Name $driveRoot -ErrorAction SilentlyContinue
    $displayVersion = Get-MyBayOptionalPropertyValue $currentVersion "DisplayVersion" (Get-MyBayOptionalPropertyValue $currentVersion "ReleaseId" "")

    return [pscustomobject]@{
        ProductName = [string](Get-MyBayOptionalPropertyValue $currentVersion "ProductName" "Windows")
        DisplayVersion = [string]$displayVersion
        Build = [int](Get-MyBayOptionalPropertyValue $currentVersion "CurrentBuildNumber" 0)
        Architecture = [string]$env:PROCESSOR_ARCHITECTURE
        MemoryGB = [Math]::Round(([double](Get-MyBayOptionalPropertyValue $computer "TotalPhysicalMemory" 0) / 1GB), 1)
        FreeDiskGB = if ($drive) { [Math]::Round(([double]$drive.Free / 1GB), 1) } else { $null }
        HypervisorPresent = $hypervisorPresent
        FirmwareVirtualization = $firmwareVirtualization
        VirtualizationReady = $virtualizationReady
    }
}

function ConvertTo-MyBayWslVersion([string]$Output) {
    $normalized = $Output.Replace([string][char]0, "")
    $match = [regex]::Match($normalized, '(?m)(\d+\.\d+\.\d+(?:\.\d+)?)')
    if (-not $match.Success) { return $null }
    try { return [Version]$match.Groups[1].Value } catch { return $null }
}

function Get-MyBayWslState {
    $systemWsl = if ($env:SystemRoot) { Join-Path $env:SystemRoot "System32\wsl.exe" } else { "" }
    $command = Get-Command wsl.exe -ErrorAction SilentlyContinue
    $commandPath = if ($systemWsl -and (Test-Path -LiteralPath $systemWsl)) { $systemWsl } elseif ($command) { $command.Source } else { "" }
    if (-not $commandPath) {
        return [pscustomobject]@{ CommandAvailable = $false; Version = $null; Operational = $false; MeetsMinimum = $false; Output = "" }
    }

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = (& $commandPath --version 2>&1 | Out-String)
        $exitCode = $LASTEXITCODE
        & $commandPath --status *> $null
        $statusExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    $version = if ($exitCode -eq 0) { ConvertTo-MyBayWslVersion $output } else { $null }
    return [pscustomobject]@{
        CommandAvailable = $true
        Version = $version
        Operational = $statusExitCode -eq 0
        MeetsMinimum = $null -ne $version -and $version -ge $script:MyBayMinimumWslVersion -and $statusExitCode -eq 0
        Output = $output
    }
}

function Get-MyBayInstallStatePath([string]$ProjectRoot) {
    return Join-Path $ProjectRoot $script:MyBayInstallStateName
}

function Get-MyBayBootMarker {
    try {
        $lastBoot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
        return $lastBoot.ToUniversalTime().Ticks.ToString()
    } catch {
        return "unknown"
    }
}

function Get-MyBayInstallState([string]$ProjectRoot) {
    $path = Get-MyBayInstallStatePath $ProjectRoot
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try {
        $state = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ($state.PSObject.Properties.Name -notcontains "stage") { return $null }
        return $state
    } catch { return $null }
}

function Save-MyBayInstallState([string]$ProjectRoot, [string]$Stage, [string]$Action) {
    $state = [ordered]@{
        stage = $Stage
        action = $Action
        requested_at = [DateTime]::UtcNow.ToString("o")
        boot_marker = Get-MyBayBootMarker
    }
    $json = $state | ConvertTo-Json
    [IO.File]::WriteAllText((Get-MyBayInstallStatePath $ProjectRoot), $json, (New-Object Text.UTF8Encoding($false)))
}

function Get-MyBayInstallResumeCommand([string]$ProjectRoot) {
    $launcher = Join-Path $ProjectRoot "Start-MyBay.bat"
    return "cmd.exe /d /c `"`"$launcher`"`""
}

function Register-MyBayInstallResume([string]$ProjectRoot) {
    $launcher = Join-Path $ProjectRoot "Start-MyBay.bat"
    if (-not (Test-Path -LiteralPath $launcher)) { return }
    $runOncePath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce"
    $command = Get-MyBayInstallResumeCommand $ProjectRoot
    New-Item -Path $runOncePath -Force | Out-Null
    New-ItemProperty -Path $runOncePath -Name $script:MyBayRunOnceName -Value $command -PropertyType String -Force | Out-Null
}

function Clear-MyBayInstallResume([string]$ProjectRoot) {
    $runOncePath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce"
    Remove-ItemProperty -Path $runOncePath -Name $script:MyBayRunOnceName -ErrorAction SilentlyContinue
    $statePath = Get-MyBayInstallStatePath $ProjectRoot
    if (Test-Path -LiteralPath $statePath) {
        Remove-Item -LiteralPath $statePath -Force
    }
}

function Invoke-MyBayElevatedWslAction([string]$ProjectRoot, [ValidateSet("install", "update")][string]$Action) {
    $helper = Join-Path $ProjectRoot "scripts\windows-prerequisites.ps1"
    if (-not (Test-Path -LiteralPath $helper)) {
        throw "Windows prerequisite helper is missing: $helper"
    }
    $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$helper`" -Action $Action"
    try {
        $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
        $process = Start-Process -FilePath $windowsPowerShell -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    } catch {
        throw "Administrator approval was cancelled. WSL setup cannot continue."
    }
    if ($process.ExitCode -ne 0) {
        throw "WSL $Action failed with exit code $($process.ExitCode)."
    }
}

function Assert-MyBayWindowsHostReady([string]$ProjectRoot, [switch]$InstallPrerequisites, [switch]$DockerAlreadyReady) {
    if (-not (Test-MyBayIsWindows)) { return }

    $facts = Get-MyBayWindowsHostFacts $ProjectRoot
    $supportedBuild = ($facts.Build -eq 19045) -or ($facts.Build -ge 22631)
    if (-not $supportedBuild) {
        throw "Unsupported Windows build $($facts.Build). Use Windows 10 22H2 build 19045 or Windows 11 23H2 build 22631 or later."
    }
    if ($facts.Architecture -notin @("AMD64", "ARM64")) {
        throw "Unsupported Windows architecture: $($facts.Architecture). A 64-bit Windows installation is required."
    }
    if ($facts.MemoryGB -lt 8) {
        throw "Only $($facts.MemoryGB) GB of memory was detected. MyBay requires at least 8 GB."
    }
    if ($null -ne $facts.FreeDiskGB -and $facts.FreeDiskGB -lt 10) {
        throw "Only $($facts.FreeDiskGB) GB of free disk space is available. Free at least 10 GB before installing MyBay."
    }
    if (-not $facts.VirtualizationReady) {
        throw "Hardware virtualization is not available to Windows. Enable Intel VT-x/AMD-V in BIOS or UEFI, then retry."
    }

    Write-Host "[OK] Windows build $($facts.Build), $($facts.Architecture), $($facts.MemoryGB) GB RAM."
    if ($null -ne $facts.FreeDiskGB -and $facts.FreeDiskGB -lt 15) {
        Write-Warning "Only $($facts.FreeDiskGB) GB of free disk space is available. 15-20 GB is recommended for MyBay and Agent images."
    } elseif ($null -ne $facts.FreeDiskGB) {
        Write-Host "[OK] $($facts.FreeDiskGB) GB free disk space is available."
    }
    if ($facts.Architecture -eq "ARM64") {
        Write-Warning "Windows ARM64 support depends on the installed Docker Desktop ARM release and remains less widely validated than AMD64."
    }

    if ($DockerAlreadyReady) {
        Write-Host "[OK] Docker Engine is already running; its configured virtualization backend will be preserved."
        Clear-MyBayInstallResume $ProjectRoot
        return
    }

    $wsl = Get-MyBayWslState
    $pendingState = Get-MyBayInstallState $ProjectRoot
    $pendingBootMarker = if ($pendingState -and $pendingState.PSObject.Properties.Name -contains "boot_marker") { $pendingState.boot_marker } else { "" }
    if ($pendingState -and $pendingState.stage -in @("windows_prerequisites", "docker_desktop") -and $pendingBootMarker -eq (Get-MyBayBootMarker)) {
        throw "[MYBAY_RESTART_REQUIRED] Windows has not restarted since prerequisite setup. Restart now; installation will continue automatically after sign-in."
    }
    if ($wsl.MeetsMinimum) {
        Write-Host "[OK] WSL $($wsl.Version) meets the minimum version $script:MyBayMinimumWslVersion."
        Clear-MyBayInstallResume $ProjectRoot
        return
    }
    if (-not $InstallPrerequisites) {
        if (-not $wsl.CommandAvailable) {
            throw "WSL is not installed. Rerun with -InstallPrerequisites or double-click Start-MyBay.bat."
        }
        throw "WSL is missing or older than $script:MyBayMinimumWslVersion. Rerun with -InstallPrerequisites or update WSL manually."
    }

    $action = if ($wsl.CommandAvailable -and $null -ne $wsl.Version -and $wsl.Operational) { "update" } else { "install" }
    Save-MyBayInstallState $ProjectRoot "windows_prerequisites" $action
    Register-MyBayInstallResume $ProjectRoot
    Write-Host "Windows administrator approval is required to $action WSL."
    try {
        Invoke-MyBayElevatedWslAction $ProjectRoot $action
    } catch {
        Clear-MyBayInstallResume $ProjectRoot
        throw
    }

    $updated = Get-MyBayWslState
    if ($action -eq "update" -and $updated.MeetsMinimum) {
        Clear-MyBayInstallResume $ProjectRoot
        Write-Host "[OK] WSL was updated to $($updated.Version)."
        return
    }

    throw "[MYBAY_RESTART_REQUIRED] WSL setup completed and Windows must restart. Installation will continue automatically after sign-in."
}

function Test-MyBayPortAvailable([string]$BindAddress, [int]$Port) {
    $address = [Net.IPAddress]::Loopback
    if ($BindAddress -and $BindAddress -ne "localhost") {
        $parsedAddress = $null
        if (-not [Net.IPAddress]::TryParse($BindAddress, [ref]$parsedAddress)) { return $false }
        $address = $parsedAddress
    }
    $listener = New-Object Net.Sockets.TcpListener($address, $Port)
    try {
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        try { $listener.Stop() } catch { }
    }
}

function Test-MyBayHealthEndpoint([string]$HostAddress, [int]$Port) {
    try {
        $health = Invoke-RestMethod -Uri "http://${HostAddress}:$Port/api/health" -TimeoutSec 2
        return $health.status -eq "healthy" -and [string]$health.version -match '^\d+\.\d+\.\d+'
    } catch {
        return $false
    }
}

function Resolve-MyBayControlPanelPort([string]$BindAddress, [int]$PreferredPort) {
    if ($PreferredPort -lt 1 -or $PreferredPort -gt 65535) { $PreferredPort = 3000 }
    $healthHost = if ($BindAddress -and $BindAddress -notin @("localhost", "0.0.0.0")) { $BindAddress } else { "127.0.0.1" }
    if ((Test-MyBayPortAvailable $BindAddress $PreferredPort) -or (Test-MyBayHealthEndpoint $healthHost $PreferredPort)) {
        return $PreferredPort
    }
    $firstFallback = [Math]::Max($PreferredPort + 1, 3001)
    if ($firstFallback -le 3099) {
        foreach ($candidate in ($firstFallback..3099)) {
            if (Test-MyBayPortAvailable $BindAddress $candidate) {
                Write-Warning "Port $PreferredPort is occupied by another application. MyBay will use port $candidate."
                return $candidate
            }
        }
    }
    throw "Port $PreferredPort is occupied and no free fallback port was found through 3099."
}

function Assert-MyBayDockerLinuxEngine {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $osType = (& docker info --format '{{.OSType}}' 2>$null | Out-String).Trim()
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($LASTEXITCODE -ne 0) { throw "Docker Engine information is unavailable." }
    if ($osType -ne "linux") {
        throw "Docker Desktop is using Windows containers. Open the Docker tray menu, choose 'Switch to Linux containers', and retry."
    }
    Write-Host "[OK] Docker Desktop is using Linux containers."
}

function Test-MyBayGhcrEndpoint {
    try {
        [Net.Dns]::GetHostAddresses("ghcr.io") | Out-Null
    } catch {
        throw "GHCR_DNS_FAILED: ghcr.io could not be resolved. Check DNS, VPN, proxy, or firewall settings."
    }
    try {
        $request = [Net.HttpWebRequest]::Create("https://ghcr.io/v2/")
        $request.Method = "GET"
        $request.Timeout = 10000
        $response = $request.GetResponse()
        $response.Close()
    } catch [Net.WebException] {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) {
            return
        }
        $message = $_.Exception.Message
        if ($message -match '(?i)certificate|trust|TLS|SSL') {
            throw "GHCR_TLS_FAILED: TLS certificate validation failed. Check HTTPS inspection, proxy, and system clock."
        }
        throw "GHCR_NETWORK_FAILED: ghcr.io is unreachable. Check proxy, VPN, firewall, and network connectivity."
    }
}

function Invoke-MyBayDockerManifestInspect([string]$Image, [int]$TimeoutSeconds = 20) {
    if ($Image -notmatch '^[A-Za-z0-9._/@:-]+$') {
        throw "The configured control-panel image contains unsupported characters."
    }
    $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCommand) { throw "Docker CLI is unavailable." }
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $dockerCommand.Source
    $startInfo.Arguments = "buildx imagetools inspect `"$Image`""
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "Docker manifest inspection could not start." }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try { $process.Kill() } catch { }
        return [pscustomobject]@{ ExitCode = -1; TimedOut = $true; Output = "Docker manifest inspection timed out." }
    }
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    return [pscustomobject]@{ ExitCode = $process.ExitCode; TimedOut = $false; Output = "$stdout`n$stderr" }
}

function Assert-MyBayControlPanelImageAvailable([string]$Image) {
    if ($Image -match '^ghcr\.io/') {
        Test-MyBayGhcrEndpoint
    }
    $inspection = Invoke-MyBayDockerManifestInspect $Image
    $output = $inspection.Output
    if ($inspection.ExitCode -eq 0) {
        Write-Host "[OK] Published control-panel image is available: $Image"
        return
    }
    if ($inspection.TimedOut) {
        throw "GHCR_NETWORK_FAILED: Timed out while checking $Image. Check proxy, VPN, firewall, and Docker registry access."
    }
    if ($output -match '(?i)manifest unknown|no such manifest|not found') {
        throw "GHCR_IMAGE_NOT_FOUND: The release image $Image has not been published."
    }
    if ($output -match '(?i)unauthorized|denied|authentication') {
        throw "GHCR_ACCESS_DENIED: Anonymous access to $Image was denied."
    }
    if ($output -match '(?i)certificate|x509|TLS') {
        throw "GHCR_TLS_FAILED: Docker could not validate the GHCR TLS certificate."
    }
    if ($output -match '(?i)no such host|lookup') {
        throw "GHCR_DNS_FAILED: Docker could not resolve ghcr.io."
    }
    throw "GHCR_IMAGE_CHECK_FAILED: Docker could not inspect $Image. $($output.Trim())"
}

function Test-MyBayDockerImagePresent([string]$Image) {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & docker image inspect $Image *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}
