[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("install", "update")]
    [string]$Action
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This helper must run with Windows administrator privileges."
    exit 5
}

try {
    $wsl = Join-Path $env:SystemRoot "System32\wsl.exe"
    if (-not (Test-Path -LiteralPath $wsl)) {
        throw "The Windows WSL executable is unavailable. Install current Windows updates, then retry."
    }
    if ($Action -eq "install") {
        & $wsl --install --no-distribution
    } else {
        & $wsl --update
    }
    if ($LASTEXITCODE -ne 0) {
        throw "wsl.exe returned exit code $LASTEXITCODE."
    }
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
