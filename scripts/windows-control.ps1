[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("status", "logs", "stop", "repair", "uninstall")]
    [string]$Action
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $ProjectRoot "docker-compose.windows.yml"

function Add-DockerCliToProcessPath {
    $roots = @()
    if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles "Docker\Docker") }
    if ($env:LOCALAPPDATA) {
        $roots += (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop")
        $roots += (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker")
        $roots += (Join-Path $env:LOCALAPPDATA "Docker")
    }
    foreach ($root in $roots | Select-Object -Unique) {
        $dockerBin = Join-Path $root "resources\bin"
        if ((Test-Path -LiteralPath (Join-Path $dockerBin "docker.exe")) -and ($env:Path -split ';' -notcontains $dockerBin)) {
            $env:Path = "$dockerBin;$env:Path"
        }
    }
}

function Invoke-WindowsCompose([string[]]$Arguments) {
    & docker compose -f $ComposeFile @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed with exit code $LASTEXITCODE."
    }
}

Push-Location $ProjectRoot
try {
    Add-DockerCliToProcessPath
    if (-not (Test-Path -LiteralPath $ComposeFile)) {
        throw "docker-compose.windows.yml was not found. Re-extract the MyBay Windows package."
    }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker was not found. Start MyBay once or install Docker Desktop, then retry."
    }
    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose v2 is unavailable. Start or repair Docker Desktop, then retry."
    }

    switch ($Action) {
        "status" {
            Invoke-WindowsCompose @("ps")
        }
        "logs" {
            Invoke-WindowsCompose @("logs", "-f", "--tail", "200", "mybay-local")
        }
        "stop" {
            Invoke-WindowsCompose @("down", "--remove-orphans")
            Write-Host "MyBay has stopped. Local configuration and data were preserved."
        }
        "repair" {
            Invoke-WindowsCompose @("pull", "mybay-local")
            Invoke-WindowsCompose @("up", "-d", "--force-recreate", "--remove-orphans")
            Invoke-WindowsCompose @("ps")
            Write-Host "MyBay was repaired with the configured version-pinned image."
        }
        "uninstall" {
            Write-Host "This removes the MyBay containers and network only."
            Write-Host "The .env file and data directory will be preserved."
            $confirmation = Read-Host "Type UNINSTALL to continue"
            if ($confirmation -ne "UNINSTALL") {
                Write-Host "Uninstall cancelled."
                return
            }
            Invoke-WindowsCompose @("down", "--remove-orphans")
            Write-Host "MyBay containers were removed. Your local configuration and data remain in this folder."
        }
    }
} finally {
    Pop-Location
}
