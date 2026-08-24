$ErrorActionPreference = "Stop"
$scriptPath = (Resolve-Path (Join-Path $PSScriptRoot "..\quick-start.ps1")).Path
$source = [IO.File]::ReadAllText($scriptPath)
$tokens = $null
$errors = $null
[Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors) | Out-Null

if ($errors.Count -ne 0) {
    throw "quick-start.ps1 has PowerShell syntax errors: $($errors -join '; ')"
}

$requiredPatterns = @(
    'ValidateSet\("desktop", "lan", "server"\)',
    '\[switch\]\$InstallPrerequisites',
    'Docker\.DockerDesktop',
    '--accept-package-agreements',
    'Start-DockerDesktopAndWait',
    'RandomNumberGenerator',
    'docker compose',
    'MYBAY_INTERNAL_ROUTING_SECRET',
    'VITE_PUBLIC_APP_URL',
    'VITE_MYBAY_PLATFORM_ORIGIN',
    'Invoke-WebRequest',
    'Test-HttpReady \$healthHost \$appPort',
    '\$healthHost = if \(\$Mode -eq "lan"\) \{ \$LanBindIp \}'
)
foreach ($pattern in $requiredPatterns) {
    if ($source -notmatch $pattern) {
        throw "quick-start.ps1 is missing required contract: $pattern"
    }
}

if ($source -match '(?im)^\s*(node|npm|npx|openssl)(\.exe)?\s') {
    throw "quick-start.ps1 must not depend on host Node.js, npm, npx, or openssl."
}

if ($source -notmatch 'if \(-not \$InstallPrerequisites\)[\s\S]+?Install-DockerDesktop') {
    throw "quick-start.ps1 must not install Docker Desktop unless -InstallPrerequisites was explicitly supplied."
}

if ($source -match 'Admin password: \$\(\$script:GeneratedAdminPassword\)') {
    throw "quick-start.ps1 must not print the generated administrator password."
}

$help = & $scriptPath -Help 2>&1 | Out-String
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    throw "quick-start.ps1 -Help failed with exit code $LASTEXITCODE."
}
if ($help -notmatch 'desktop\|lan\|server') {
    throw "quick-start.ps1 -Help did not describe all deployment modes."
}

Write-Output "PowerShell Quick Start syntax and host-dependency checks passed."
