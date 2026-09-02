$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Assert-Contains([string]$Path, [string]$Pattern, [string]$Message) {
    $source = [IO.File]::ReadAllText($Path)
    if ($source -notmatch $Pattern) {
        throw $Message
    }
}

$powershellFiles = @(
    (Join-Path $projectRoot "quick-start.ps1"),
    (Join-Path $projectRoot "scripts\windows-control.ps1"),
    (Join-Path $projectRoot "scripts\windows-acceptance.ps1"),
    (Join-Path $projectRoot "scripts\windows-preflight.ps1"),
    (Join-Path $projectRoot "scripts\windows-prerequisites.ps1")
)
foreach ($path in $powershellFiles) {
    $tokens = $null
    $errors = $null
    [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -ne 0) {
        throw "$path has PowerShell syntax errors: $($errors -join '; ')"
    }
}

$requiredFiles = @(
    "Start-MyBay.bat",
    "Stop-MyBay.bat",
    "View-Logs.bat",
    "Repair-MyBay.bat",
    "Uninstall-MyBay.bat",
    "Collect-Diagnostics.bat",
    "WINDOWS-README.md",
    "WINDOWS-README.zh-CN.md",
    "WINDOWS-ACCEPTANCE.md",
    "WINDOWS-ACCEPTANCE.zh-CN.md",
    "docker-compose.windows.yml",
    "scripts\windows-control.ps1",
    "scripts\windows-acceptance.ps1",
    "scripts\windows-preflight.ps1",
    "scripts\windows-prerequisites.ps1"
)
foreach ($relativePath in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath))) {
        throw "Windows package file is missing: $relativePath"
    }
}

$startPath = Join-Path $projectRoot "Start-MyBay.bat"
Assert-Contains $startPath '-ExecutionPolicy Bypass' "Start-MyBay.bat must bypass only the child PowerShell process policy."
Assert-Contains $startPath '-InstallPrerequisites' "Start-MyBay.bat must request prerequisite installation."
Assert-Contains $startPath '-UsePrebuiltImage' "Start-MyBay.bat must use the prebuilt image path."
Assert-Contains $startPath '-PromptAdminPassword' "Start-MyBay.bat must let the user choose the initial password."
Assert-Contains $startPath '-OpenBrowser' "Start-MyBay.bat must open the control panel after startup."
Assert-Contains $startPath 'ERRORLEVEL% EQU 10' "Start-MyBay.bat must recognize the restart-required continuation code."

$composePath = Join-Path $projectRoot "docker-compose.windows.yml"
Assert-Contains $composePath 'image:\s*\$\{MYBAY_CONTROL_PANEL_IMAGE' "Windows Compose must use the version-pinned image variable."
$composeSource = [IO.File]::ReadAllText($composePath)
if ($composeSource -match '(?m)^\s*build:') {
    throw "Windows Compose must not build the control panel locally."
}

$controlPath = Join-Path $projectRoot "scripts\windows-control.ps1"
Assert-Contains $controlPath 'data directory will be preserved' "Windows uninstall must explain that local data is preserved."
if ([IO.File]::ReadAllText($controlPath) -match 'Remove-Item') {
    throw "Windows uninstall must not delete local files."
}

$preflightPath = Join-Path $projectRoot "scripts\windows-preflight.ps1"
Assert-Contains $preflightPath '2\.1\.5' "Windows preflight must enforce the documented minimum WSL version."
Assert-Contains $preflightPath 'MyBayInstallResume' "Windows preflight must register a scoped restart continuation."
Assert-Contains $preflightPath 'Switch to Linux containers' "Windows preflight must reject the Windows-container engine."
Assert-Contains $preflightPath 'GHCR_DNS_FAILED' "Windows preflight must distinguish registry DNS failures."
Assert-Contains $preflightPath 'GHCR_TLS_FAILED' "Windows preflight must distinguish registry TLS failures."
Assert-Contains $preflightPath 'GHCR_IMAGE_NOT_FOUND' "Windows preflight must distinguish an unpublished image."
Assert-Contains $preflightPath 'Test-MyBayDockerImagePresent' "Windows preflight must support an existing pinned image when the registry is temporarily offline."

$acceptancePath = Join-Path $projectRoot "scripts\windows-acceptance.ps1"
Assert-Contains $acceptancePath 'Manual product gates' "Windows diagnostics must keep manual product gates explicit."
Assert-Contains $acceptancePath 'secret values were not read' "Windows diagnostics must state its secret-handling boundary."
Assert-Contains $acceptancePath 'Docker socket in control panel' "Windows diagnostics must verify the Docker socket contract."
Assert-Contains (Join-Path $projectRoot "Collect-Diagnostics.bat") 'windows-acceptance\.ps1' "Windows diagnostics launcher must invoke the evidence collector."

. $preflightPath
$registryWithoutDisplayVersion = [pscustomobject]@{
    ProductName = "Windows 10 Pro"
    CurrentBuildNumber = "19045"
}
$optionalDisplayVersion = Get-MyBayOptionalPropertyValue $registryWithoutDisplayVersion "DisplayVersion" ""
if ($optionalDisplayVersion -ne "") {
    throw "Windows preflight must tolerate registry records without DisplayVersion."
}
$releaseIdFallback = Get-MyBayOptionalPropertyValue ([pscustomobject]@{ ReleaseId = "2009" }) "ReleaseId" ""
if ($releaseIdFallback -ne "2009") {
    throw "Windows preflight optional-property fallback returned the wrong value."
}
$parsedWslVersion = ConvertTo-MyBayWslVersion "W`0S`0L`0 `0v`0e`0r`0s`0i`0o`0n`0:`0 `02`0.`07`0.`01`02`0.`00`0"
if ($parsedWslVersion -ne [Version]"2.7.12.0") {
    throw "Windows preflight did not parse UTF-16-style WSL output."
}
$resumeCommand = Get-MyBayInstallResumeCommand "C:\My Bay"
if ($resumeCommand -ne 'cmd.exe /d /c ""C:\My Bay\Start-MyBay.bat""') {
    throw "Windows restart continuation command did not quote a path containing spaces safely."
}

$stateTestRoot = Join-Path ([IO.Path]::GetTempPath()) ("mybay-windows-state-" + [Guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Path $stateTestRoot | Out-Null
    Save-MyBayInstallState $stateTestRoot "windows_prerequisites" "install"
    $savedState = Get-MyBayInstallState $stateTestRoot
    if (-not $savedState -or $savedState.stage -ne "windows_prerequisites" -or -not $savedState.boot_marker) {
        throw "Windows restart continuation state was not persisted safely."
    }
} finally {
    if (Test-Path -LiteralPath $stateTestRoot) { Remove-Item -LiteralPath $stateTestRoot -Recurse -Force }
}

$occupiedPort = $null
foreach ($candidate in 3060..3098) {
    if ((Test-MyBayPortAvailable "127.0.0.1" $candidate) -and (Test-MyBayPortAvailable "127.0.0.1" ($candidate + 1))) {
        $occupiedPort = $candidate
        break
    }
}
if ($null -ne $occupiedPort) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $occupiedPort)
    try {
        $listener.Start()
        $fallbackPort = Resolve-MyBayControlPanelPort "127.0.0.1" $occupiedPort
        if ($fallbackPort -eq $occupiedPort -or $fallbackPort -lt 3001 -or $fallbackPort -gt 3099) {
            throw "Windows preflight did not select a safe fallback port."
        }
    } finally {
        $listener.Stop()
    }
}

$diagnosticTestRoot = Join-Path ([IO.Path]::GetTempPath()) ("mybay-windows-diagnostics-" + [Guid]::NewGuid().ToString("N"))
try {
    $diagnosticOutput = Join-Path $diagnosticTestRoot "output"
    New-Item -ItemType Directory -Path $diagnosticTestRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot "package.json") -Destination (Join-Path $diagnosticTestRoot "package.json")
    @(
        "MYBAY_CONTROL_PANEL_IMAGE=ghcr.io/mybay-ai/mybay:0.1.26",
        "LOCAL_ADMIN_PASSWORD=diagnostic-password-sentinel",
        "JWT_SECRET=diagnostic-jwt-sentinel",
        "ENCRYPTION_KEY=diagnostic-encryption-sentinel",
        "MODEL_API_KEY=diagnostic-api-key-sentinel"
    ) | Set-Content -LiteralPath (Join-Path $diagnosticTestRoot ".env") -Encoding UTF8
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $acceptancePath -ProjectRoot $diagnosticTestRoot -SkipRuntimeChecks -OutputDirectory $diagnosticOutput
    if ($LASTEXITCODE -ne 0) {
        throw "Windows diagnostics collector did not complete in static-validation mode."
    }
    $diagnosticFiles = @(Get-ChildItem -LiteralPath $diagnosticOutput -File)
    if (@($diagnosticFiles | Where-Object Extension -eq ".json").Count -ne 1 -or @($diagnosticFiles | Where-Object Extension -eq ".md").Count -ne 1) {
        throw "Windows diagnostics collector did not generate one JSON and one Markdown report."
    }
    $diagnosticText = ($diagnosticFiles | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
    foreach ($sentinel in @("diagnostic-password-sentinel", "diagnostic-jwt-sentinel", "diagnostic-encryption-sentinel", "diagnostic-api-key-sentinel")) {
        if ($diagnosticText.Contains($sentinel)) {
            throw "Windows diagnostics report leaked a secret sentinel: $sentinel"
        }
    }
} finally {
    if (Test-Path -LiteralPath $diagnosticTestRoot) { Remove-Item -LiteralPath $diagnosticTestRoot -Recurse -Force }
}

Write-Output "Windows one-click launcher contracts passed."
