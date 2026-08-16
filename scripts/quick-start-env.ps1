function Read-QuickStartUtf8Lines([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    return [IO.File]::ReadAllLines($Path, [Text.Encoding]::UTF8)
}

function Write-QuickStartUtf8Lines([string]$Path, [string[]]$Lines) {
    $content = [string]::Join([Environment]::NewLine, $Lines)
    if ($Lines.Count -gt 0) { $content += [Environment]::NewLine }
    [IO.File]::WriteAllText($Path, $content, (New-Object Text.UTF8Encoding($false)))
}

function Get-QuickStartEnvValue([string]$Path, [string]$Key) {
    $prefix = "$Key="
    $value = ""
    foreach ($line in (Read-QuickStartUtf8Lines $Path)) {
        if ($line.StartsWith($prefix, [StringComparison]::Ordinal)) { $value = $line.Substring($prefix.Length) }
    }
    return $value.Trim()
}

function Set-QuickStartEnvValue([string]$Path, [string]$Key, [string]$Value) {
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $found = $false
    $prefix = "$Key="
    foreach ($line in (Read-QuickStartUtf8Lines $Path)) {
        if ($line.StartsWith($prefix, [StringComparison]::Ordinal)) {
            if (-not $found) { $lines.Add("$Key=$Value"); $found = $true }
        } else {
            $lines.Add($line)
        }
    }
    if (-not $found) {
        if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -ne "") { $lines.Add("") }
        $lines.Add("$Key=$Value")
    }
    Write-QuickStartUtf8Lines $Path $lines.ToArray()
}

function Reset-QuickStartServerEnv([string]$Path, [string]$PublicUrl) {
    Set-QuickStartEnvValue $Path "CONTROL_PANEL_DOMAIN" ""
    Set-QuickStartEnvValue $Path "BASE_DOMAIN" "localhost"
    Set-QuickStartEnvValue $Path "MYBAY_INSTANCE_ROOT_DOMAIN" ""
    Set-QuickStartEnvValue $Path "PUBLIC_APP_URL" $PublicUrl
    Set-QuickStartEnvValue $Path "VITE_PUBLIC_APP_URL" $PublicUrl
    Set-QuickStartEnvValue $Path "VITE_MYBAY_PLATFORM_ORIGIN" $PublicUrl
    Set-QuickStartEnvValue $Path "INSTANCE_PUBLIC_PROTOCOL" "http"
    Set-QuickStartEnvValue $Path "TRAEFIK_NETWORK" "traefik_proxy"
    Set-QuickStartEnvValue $Path "TRAEFIK_CONTAINER_NAME" "traefik"
    Set-QuickStartEnvValue $Path "CONTROL_PLANE_INTERNAL_URL" ""
    Set-QuickStartEnvValue $Path "INSTANCE_AUTH_INTERNAL_URL" ""
    Set-QuickStartEnvValue $Path "LETSENCRYPT_EMAIL" ""
    Set-QuickStartEnvValue $Path "TRUST_PROXY" "false"
}

function Set-QuickStartDeploymentEnv(
    [string]$Path,
    [ValidateSet("desktop", "lan", "server")][string]$Mode,
    [string]$AccessHost,
    [string]$Port,
    [string]$ControlPanelDomain = "",
    [string]$InstanceRootDomain = "",
    [string]$LetsEncryptEmail = ""
) {
    if ($Mode -eq "server") {
        Set-QuickStartEnvValue $Path "DEPLOYMENT_MODE" "server"
        Set-QuickStartEnvValue $Path "PROXY_MODE" "traefik"
        Set-QuickStartEnvValue $Path "PORT" $Port
        Set-QuickStartEnvValue $Path "CONTROL_PANEL_BIND_IP" "127.0.0.1"
        Set-QuickStartEnvValue $Path "DEPLOYMENT_LAN_BIND_IP" ""
        Set-QuickStartEnvValue $Path "LOCAL_INSTANCE_ACCESS_HOST" ""
        Set-QuickStartEnvValue $Path "CONTROL_PANEL_DOMAIN" $ControlPanelDomain
        Set-QuickStartEnvValue $Path "BASE_DOMAIN" $InstanceRootDomain
        Set-QuickStartEnvValue $Path "MYBAY_INSTANCE_ROOT_DOMAIN" $InstanceRootDomain
        $publicUrl = "https://$ControlPanelDomain"
        Set-QuickStartEnvValue $Path "PUBLIC_APP_URL" $publicUrl
        Set-QuickStartEnvValue $Path "VITE_PUBLIC_APP_URL" $publicUrl
        Set-QuickStartEnvValue $Path "VITE_MYBAY_PLATFORM_ORIGIN" $publicUrl
        Set-QuickStartEnvValue $Path "INSTANCE_PUBLIC_PROTOCOL" "https"
        Set-QuickStartEnvValue $Path "TRAEFIK_NETWORK" "traefik_proxy"
        Set-QuickStartEnvValue $Path "TRAEFIK_CONTAINER_NAME" "traefik"
        Set-QuickStartEnvValue $Path "CONTROL_PLANE_INTERNAL_URL" "http://mybay-local-control-panel:$Port"
        Set-QuickStartEnvValue $Path "INSTANCE_AUTH_INTERNAL_URL" "http://mybay-local-control-panel:$Port"
        Set-QuickStartEnvValue $Path "LETSENCRYPT_EMAIL" $LetsEncryptEmail
        Set-QuickStartEnvValue $Path "TRUST_PROXY" "true"
        return
    }

    if ($Mode -eq "lan") {
        Set-QuickStartEnvValue $Path "DEPLOYMENT_MODE" "lan"
        Set-QuickStartEnvValue $Path "PROXY_MODE" "lan"
        Set-QuickStartEnvValue $Path "CONTROL_PANEL_BIND_IP" $AccessHost
        Set-QuickStartEnvValue $Path "DEPLOYMENT_LAN_BIND_IP" $AccessHost
        Set-QuickStartEnvValue $Path "LOCAL_INSTANCE_ACCESS_HOST" $AccessHost
        Reset-QuickStartServerEnv $Path "http://${AccessHost}:$Port"
        return
    }

    Set-QuickStartEnvValue $Path "DEPLOYMENT_MODE" "desktop"
    Set-QuickStartEnvValue $Path "PROXY_MODE" "local"
    Set-QuickStartEnvValue $Path "CONTROL_PANEL_BIND_IP" "127.0.0.1"
    Set-QuickStartEnvValue $Path "DEPLOYMENT_LAN_BIND_IP" ""
    Set-QuickStartEnvValue $Path "LOCAL_INSTANCE_ACCESS_HOST" ""
    Reset-QuickStartServerEnv $Path "http://localhost:$Port"
}
