[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [string]$OutputDirectory,
    [switch]$SkipRuntimeChecks
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-preflight.ps1")

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $ProjectRoot "diagnostics"
}

$script:Results = New-Object System.Collections.Generic.List[object]

function Add-AcceptanceResult([string]$Check, [string]$Status, [string]$Details) {
    $safeDetails = if ([string]::IsNullOrWhiteSpace($Details)) { "-" } else { $Details.Trim() }
    $script:Results.Add([PSCustomObject]@{
        check = $Check
        status = $Status
        details = $safeDetails
    })
}

function Get-SafeEnvSettings([string]$EnvPath) {
    $allowed = @("MYBAY_CONTROL_PANEL_IMAGE", "CONTROL_PANEL_BIND_IP", "PORT", "LOCAL_ADMIN_USERNAME")
    $values = @{}
    if (-not (Test-Path -LiteralPath $EnvPath)) { return $values }
    foreach ($line in [IO.File]::ReadAllLines($EnvPath)) {
        if ($line -notmatch '^\s*([^#=\s]+)\s*=\s*(.*)$') { continue }
        $key = $matches[1]
        if ($allowed -notcontains $key) { continue }
        $values[$key] = $matches[2].Trim()
    }
    return $values
}

function Invoke-SafeCommand([scriptblock]$Command) {
    try {
        $output = & $Command 2>&1 | Out-String
        return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = $output.Trim() }
    } catch {
        return [PSCustomObject]@{ ExitCode = 1; Output = $_.Exception.Message }
    }
}

function Get-StatusMarker([string]$Status) {
    switch ($Status) {
        "PASS" { return "PASS" }
        "WARN" { return "WARN" }
        "SKIP" { return "SKIP" }
        default { return "FAIL" }
    }
}

$packagePath = Join-Path $ProjectRoot "package.json"
$packageVersion = "unknown"
if (Test-Path -LiteralPath $packagePath) {
    try { $packageVersion = (Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version } catch { }
}

$timestamp = Get-Date
$envPath = Join-Path $ProjectRoot ".env"
$safeEnv = Get-SafeEnvSettings $envPath
$port = if ($safeEnv.ContainsKey("PORT") -and $safeEnv["PORT"] -match '^\d+$') { [int]$safeEnv["PORT"] } else { 3000 }
$bindIp = if ($safeEnv.ContainsKey("CONTROL_PANEL_BIND_IP")) { $safeEnv["CONTROL_PANEL_BIND_IP"] } else { "127.0.0.1" }
$healthHost = if ($bindIp -in @("0.0.0.0", "::", "[::]")) { "127.0.0.1" } else { $bindIp }

if ($SkipRuntimeChecks) {
    Add-AcceptanceResult "Host prerequisites" "SKIP" "Host and runtime checks were skipped by request."
} else {
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $build = [int]$os.BuildNumber
        $supported = $build -ge 19045
        Add-AcceptanceResult "Windows version" $(if ($supported) { "PASS" } else { "FAIL" }) "$($os.Caption), build $build"
        # Use the same physical-memory measurement and thresholds as startup.
        $computerMemory = Get-CimInstance Win32_ComputerSystem
        $memoryGb = [Math]::Round(([double](Get-MyBayOptionalPropertyValue $computerMemory "TotalPhysicalMemory" 0) / 1GB), 1)
        $memory = Get-MyBayWindowsMemoryAssessment $memoryGb
        Add-AcceptanceResult "Memory" $memory.Status $memory.Details
    } catch {
        Add-AcceptanceResult "Windows version" "FAIL" $_.Exception.Message
    }

    try {
        $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
        Add-AcceptanceResult "CPU architecture" $(if ($architecture -in @("X64", "Arm64")) { "PASS" } else { "FAIL" }) $architecture
    } catch {
        Add-AcceptanceResult "CPU architecture" "FAIL" $_.Exception.Message
    }

    try {
        $drive = Get-Item -LiteralPath $ProjectRoot
        while ($drive.Parent) { $drive = $drive.Parent }
        $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($drive.Name.TrimEnd('\'))'"
        $freeGb = [Math]::Round($disk.FreeSpace / 1GB, 1)
        $diskStatus = if ($freeGb -ge 15) { "PASS" } elseif ($freeGb -ge 10) { "WARN" } else { "FAIL" }
        Add-AcceptanceResult "Free disk space" $diskStatus "$freeGb GB"
    } catch {
        Add-AcceptanceResult "Free disk space" "WARN" $_.Exception.Message
    }

    try {
        $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
        $computer = Get-CimInstance Win32_ComputerSystem
        $virtualizationReady = [bool]$computer.HypervisorPresent -or [bool]$cpu.VirtualizationFirmwareEnabled
        Add-AcceptanceResult "Hardware virtualization" $(if ($virtualizationReady) { "PASS" } else { "FAIL" }) "Hypervisor present=$($computer.HypervisorPresent); firmware enabled=$($cpu.VirtualizationFirmwareEnabled)"
    } catch {
        Add-AcceptanceResult "Hardware virtualization" "WARN" $_.Exception.Message
    }

    $wsl = Invoke-SafeCommand { wsl.exe --version }
    if ($wsl.ExitCode -eq 0) {
        $versionMatch = [regex]::Match(($wsl.Output -replace "`0", ""), '(?im)^WSL[^:]*:\s*([0-9]+(?:\.[0-9]+){1,3})')
        $details = if ($versionMatch.Success) { "WSL $($versionMatch.Groups[1].Value)" } else { "WSL installed" }
        Add-AcceptanceResult "WSL" "PASS" $details
    } else {
        Add-AcceptanceResult "WSL" "FAIL" "WSL is unavailable or not initialized."
    }
}

$image = if ($safeEnv.ContainsKey("MYBAY_CONTROL_PANEL_IMAGE")) { $safeEnv["MYBAY_CONTROL_PANEL_IMAGE"] } else { "not configured" }
if ($SkipRuntimeChecks) {
    Add-AcceptanceResult "Installation state" "SKIP" "Installation-state checks were skipped by request."
} else {
    Add-AcceptanceResult "Environment file" $(if (Test-Path -LiteralPath $envPath) { "PASS" } else { "FAIL" }) $(if (Test-Path -LiteralPath $envPath) { ".env exists; secret values were not read into this report." } else { ".env is missing." })
    Add-AcceptanceResult "Data directory" $(if (Test-Path -LiteralPath (Join-Path $ProjectRoot "data")) { "PASS" } else { "WARN" }) $(if (Test-Path -LiteralPath (Join-Path $ProjectRoot "data")) { "data exists" } else { "data has not been created yet" })
    Add-AcceptanceResult "Restart continuation state" $(if (Test-Path -LiteralPath (Join-Path $ProjectRoot ".mybay-install-state.json")) { "WARN" } else { "PASS" }) $(if (Test-Path -LiteralPath (Join-Path $ProjectRoot ".mybay-install-state.json")) { "A pending installation state remains." } else { "No pending installation state." })

    try {
        $runOnce = Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce" -Name "MyBayInstallResume" -ErrorAction SilentlyContinue
        Add-AcceptanceResult "One-time resume entry" $(if ($null -eq $runOnce) { "PASS" } else { "WARN" }) $(if ($null -eq $runOnce) { "No stale RunOnce entry." } else { "MyBayInstallResume is still registered." })
    } catch {
        Add-AcceptanceResult "One-time resume entry" "WARN" "RunOnce state could not be inspected."
    }

    Add-AcceptanceResult "Pinned control-panel image" $(if ($image -ne "not configured") { "PASS" } else { "FAIL" }) $image
}

if ($SkipRuntimeChecks) {
    Add-AcceptanceResult "Docker runtime" "SKIP" "Runtime checks were skipped by request."
} elseif (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Add-AcceptanceResult "Docker CLI" "FAIL" "docker.exe is not available in PATH."
} else {
    $docker = Invoke-SafeCommand { docker version --format '{{.Server.Os}}/{{.Server.Arch}} {{.Server.Version}}' }
    if ($docker.ExitCode -eq 0) {
        $dockerStatus = if ($docker.Output -match '^linux/') { "PASS" } else { "FAIL" }
        Add-AcceptanceResult "Docker Linux engine" $dockerStatus $docker.Output
    } else {
        Add-AcceptanceResult "Docker engine" "FAIL" "Docker Desktop is not ready."
    }

    $compose = Invoke-SafeCommand { docker compose version --short }
    Add-AcceptanceResult "Docker Compose" $(if ($compose.ExitCode -eq 0) { "PASS" } else { "FAIL" }) $(if ($compose.ExitCode -eq 0) { $compose.Output } else { "Docker Compose v2 is unavailable." })

    $container = Invoke-SafeCommand { docker inspect mybay-local-control-panel --format '{{.State.Status}}|{{.State.Health.Status}}|{{.Config.Image}}' }
    if ($container.ExitCode -eq 0) {
        $parts = $container.Output -split '\|'
        $running = $parts.Count -ge 2 -and $parts[0] -eq "running" -and $parts[1] -eq "healthy"
        Add-AcceptanceResult "Control-panel container" $(if ($running) { "PASS" } else { "FAIL" }) $container.Output
    } else {
        Add-AcceptanceResult "Control-panel container" "FAIL" "mybay-local-control-panel was not found."
    }

    $socket = Invoke-SafeCommand { docker exec mybay-local-control-panel sh -lc 'test -S /var/run/docker.sock && test -r /var/run/docker.sock && test -w /var/run/docker.sock' }
    Add-AcceptanceResult "Docker socket in control panel" $(if ($socket.ExitCode -eq 0) { "PASS" } else { "FAIL" }) $(if ($socket.ExitCode -eq 0) { "Socket exists and is readable/writable." } else { "Socket access check failed." })

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://${healthHost}:$port/api/health" -TimeoutSec 8
        $health = $response.Content | ConvertFrom-Json
        $healthStatus = [string]$health.status
        $healthVersion = [string]$health.version
        Add-AcceptanceResult "Control-panel health endpoint" $(if ($response.StatusCode -eq 200 -and $healthStatus -eq "healthy") { "PASS" } else { "FAIL" }) "HTTP $($response.StatusCode); status=$healthStatus; version=$healthVersion"
    } catch {
        Add-AcceptanceResult "Control-panel health endpoint" "FAIL" "http://${healthHost}:$port/api/health did not return healthy."
    }
}

$failed = @($script:Results | Where-Object { $_.status -eq "FAIL" }).Count
$warnings = @($script:Results | Where-Object { $_.status -eq "WARN" }).Count
$summary = if ($failed -gt 0) { "FAIL" } elseif ($warnings -gt 0) { "WARN" } else { "PASS" }

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$stamp = $timestamp.ToString("yyyyMMdd-HHmmss")
$jsonPath = Join-Path $OutputDirectory "mybay-windows-diagnostics-$stamp.json"
$markdownPath = Join-Path $OutputDirectory "mybay-windows-acceptance-$stamp.md"

$document = [PSCustomObject]@{
    schema_version = 1
    generated_at = $timestamp.ToString("o")
    package_version = $packageVersion
    overall_status = $summary
    failed_checks = $failed
    warning_checks = $warnings
    checks = $script:Results.ToArray()
}
$document | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$rows = foreach ($result in $script:Results) {
    $details = ([string]$result.details).Replace("|", "\|").Replace("`r", " ").Replace("`n", " ")
    "| $($result.check) | $(Get-StatusMarker $result.status) | $details |"
}
$markdown = @"
# MyBay Windows acceptance report

- Generated: $($timestamp.ToString("yyyy-MM-dd HH:mm:ss zzz"))
- Package version: $packageVersion
- Automated result: **$summary**
- Failed checks: $failed
- Warnings: $warnings

This report intentionally excludes passwords, API keys, JWT secrets, encryption keys, and the contents of `.env`.

| Check | Result | Details |
| --- | --- | --- |
$($rows -join "`r`n")

## Manual product gates

- [ ] Browser opened and administrator login succeeded.
- [ ] A model API key was added without exposing it in screenshots or logs.
- [ ] A Hermes Agent was deployed and reached ready/running state.
- [ ] A chat message produced a streamed response.
- [ ] The Agent created a file and the file could be downloaded/opened.
- [ ] After a Windows restart, Docker Desktop and MyBay returned to healthy state.
- [ ] Stop, View Logs, Repair, and Uninstall launchers behaved as documented.
- [ ] `.env` and `data` remained present after Stop and Uninstall.

Automated checks alone do not close these manual product gates. Follow `WINDOWS-ACCEPTANCE.zh-CN.md` or `WINDOWS-ACCEPTANCE.md` on a clean Windows VM.
"@
$markdown | Set-Content -LiteralPath $markdownPath -Encoding UTF8

Write-Host "MyBay Windows diagnostics: $summary"
Write-Host "Markdown report: $markdownPath"
Write-Host "JSON report: $jsonPath"
if ($failed -gt 0) { exit 1 }
