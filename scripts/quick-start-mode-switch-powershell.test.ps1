$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "quick-start-env.ps1")

function Assert-EnvValue([string]$Path, [string]$Key, [string]$Expected) {
    $actual = Get-QuickStartEnvValue $Path $Key
    if ($actual -ne $Expected) {
        throw "Expected $Key=$Expected, got $actual"
    }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("mybay-quick-start-" + [Guid]::NewGuid().ToString("N"))
$testEnv = Join-Path $testRoot ".env"
try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot ".env.example") -Destination $testEnv

    $sentinelEncryptionKey = "ab" * 32
    Set-QuickStartEnvValue $testEnv "ENCRYPTION_KEY" $sentinelEncryptionKey
    Set-QuickStartDeploymentEnv $testEnv "server" "" "3000" "console.old.example" "agents.old.example" "ops@example.com"
    Set-QuickStartDeploymentEnv $testEnv "desktop" "localhost" "3000"
    Assert-EnvValue $testEnv "ENCRYPTION_KEY" $sentinelEncryptionKey
    Assert-EnvValue $testEnv "DEPLOYMENT_MODE" "desktop"
    Assert-EnvValue $testEnv "PROXY_MODE" "local"
    Assert-EnvValue $testEnv "TRUST_PROXY" "false"
    Assert-EnvValue $testEnv "INSTANCE_PUBLIC_PROTOCOL" "http"
    Assert-EnvValue $testEnv "PUBLIC_APP_URL" "http://localhost:3000"
    Assert-EnvValue $testEnv "VITE_PUBLIC_APP_URL" "http://localhost:3000"
    Assert-EnvValue $testEnv "VITE_MYBAY_PLATFORM_ORIGIN" "http://localhost:3000"
    Assert-EnvValue $testEnv "CONTROL_PANEL_DOMAIN" ""
    Assert-EnvValue $testEnv "MYBAY_INSTANCE_ROOT_DOMAIN" ""
    Assert-EnvValue $testEnv "LETSENCRYPT_EMAIL" ""
    Assert-EnvValue $testEnv "CONTROL_PLANE_INTERNAL_URL" ""
    Assert-EnvValue $testEnv "INSTANCE_AUTH_INTERNAL_URL" ""

    Set-QuickStartDeploymentEnv $testEnv "server" "" "3000" "console.old.example" "agents.old.example" "ops@example.com"
    Set-QuickStartDeploymentEnv $testEnv "lan" "192.168.1.20" "3000"
    Assert-EnvValue $testEnv "DEPLOYMENT_MODE" "lan"
    Assert-EnvValue $testEnv "PROXY_MODE" "lan"
    Assert-EnvValue $testEnv "TRUST_PROXY" "false"
    Assert-EnvValue $testEnv "CONTROL_PANEL_BIND_IP" "192.168.1.20"
    Assert-EnvValue $testEnv "PUBLIC_APP_URL" "http://192.168.1.20:3000"
    Assert-EnvValue $testEnv "VITE_PUBLIC_APP_URL" "http://192.168.1.20:3000"
    Assert-EnvValue $testEnv "INSTANCE_PUBLIC_PROTOCOL" "http"
    Assert-EnvValue $testEnv "CONTROL_PANEL_DOMAIN" ""

    Set-QuickStartDeploymentEnv $testEnv "server" "" "3000" "console.new.example" "agents.new.example" "release@example.com"
    Assert-EnvValue $testEnv "DEPLOYMENT_MODE" "server"
    Assert-EnvValue $testEnv "PROXY_MODE" "traefik"
    Assert-EnvValue $testEnv "TRUST_PROXY" "true"
    Assert-EnvValue $testEnv "CONTROL_PANEL_DOMAIN" "console.new.example"
    Assert-EnvValue $testEnv "MYBAY_INSTANCE_ROOT_DOMAIN" "agents.new.example"
    Assert-EnvValue $testEnv "PUBLIC_APP_URL" "https://console.new.example"
    Assert-EnvValue $testEnv "INSTANCE_PUBLIC_PROTOCOL" "https"

    $existingDatabase = Join-Path $testRoot "mybay.sqlite"
    [IO.File]::WriteAllText($existingDatabase, "existing-data")
    $guardRejectedReplacement = $false
    try {
        Assert-QuickStartEncryptionKeyGenerationSafe $existingDatabase
    } catch {
        $guardRejectedReplacement = $true
    }
    if (-not $guardRejectedReplacement) {
        throw "Existing local data must prevent automatic ENCRYPTION_KEY replacement."
    }

    $launcherSource = [IO.File]::ReadAllText((Join-Path $projectRoot "quick-start.ps1"))
    if ($launcherSource -notmatch '"--remove-orphans"') {
        throw "quick-start.ps1 must remove orphan services when changing Compose file sets."
    }
} finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

Write-Output "PowerShell Quick Start deployment-mode transition tests passed."
