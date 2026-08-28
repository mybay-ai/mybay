export const GATEWAY_CONTAINER_PROBE_SCRIPT = `
echo "=== HTTP PROBES ==="
for port in 9119 8000 8642 8644; do
  if [ "$port" = "8642" ] || [ "$port" = "8644" ]; then
    paths="health v1/chat/completions"
  else
    paths="health ready api/health api/ready status"
  fi
  for path in $paths; do
    url="http://127.0.0.1:\${port}/\${path}"
    if [ -n "$API_SERVER_KEY" ] && { [ "$port" = "8642" ] || [ "$port" = "8644" ]; }; then
      res=$(curl -s -H "Authorization: Bearer $API_SERVER_KEY" -o /dev/null -w "%{http_code}" --max-time 1 "$url" 2>/dev/null || echo "fail")
    else
      res=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "$url" 2>/dev/null || wget -q -S --spider --timeout=1 "$url" 2>&1 | grep "HTTP/" | awk '{print $2}' || echo "fail")
    fi
    if [ "$res" = "200" ] || [ "$res" = "201" ] || [ "$res" = "204" ] || [ "$res" = "401" ] || [ "$res" = "403" ] || [ "$res" = "405" ]; then
      echo "PORT_\${port}_PATH_\${path}: OK (HTTP $res)"
    fi
  done
done

echo "=== TCP LISTEN PROBES ==="
cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -i ':21C2' >/dev/null && echo "PORT_8642_LISTEN: OK"
cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -i ':21C4' >/dev/null && echo "PORT_8644_LISTEN: OK"

echo "=== NETWORK/DNS ==="
timeout 2 ping -c 1 open.feishu.cn > /dev/null 2>&1 && echo "DNS_open.feishu.cn: OK" || echo "DNS_open.feishu.cn: FAIL"

echo "=== s6 SERVICES ==="
s6_svstat=$(command -v s6-svstat 2>/dev/null || true)
if [ -z "$s6_svstat" ] && [ -x /command/s6-svstat ]; then
  s6_svstat=/command/s6-svstat
fi
s6_dirs="/run/service /var/run/s6/services /etc/services.d"
for s6_dir in $s6_dirs; do
  if [ -d "$s6_dir" ]; then
    for svc in $(ls "$s6_dir"); do
      if [ "$svc" != "." ] && [ "$svc" != ".." ] && [ -d "$s6_dir/$svc" ]; then
        stat=""
        if [ -n "$s6_svstat" ]; then
          stat=$("$s6_svstat" "$s6_dir/$svc" 2>/dev/null || "$s6_svstat" -o status "$s6_dir/$svc" 2>/dev/null)
        fi
        if [ -n "$stat" ]; then
          echo "SERVICE_$svc: $stat"
        fi
      fi
    done
  fi
done
`;

export type GatewayContainerProbeResult = {
  hasSuccessfulHttpProbe: boolean;
  isApiPortListening: boolean;
  isWebhookPortListening: boolean;
  dnsOk: boolean;
  services: Record<string, string>;
  servicesCount: number;
};

export function parseGatewayContainerProbeOutput(output: string): GatewayContainerProbeResult {
  const result: GatewayContainerProbeResult = {
    hasSuccessfulHttpProbe: false,
    isApiPortListening: false,
    isWebhookPortListening: false,
    dnsOk: true,
    services: {},
    servicesCount: 0,
  };

  for (const line of output.split(/\r?\n/)) {
    if (line.includes("PORT_8642_LISTEN: OK") || line.includes("PORT_8642_PATH_")) result.isApiPortListening = true;
    if (line.includes("PORT_8644_LISTEN: OK") || line.includes("PORT_8644_PATH_")) result.isWebhookPortListening = true;
    if (line.includes("DNS_open.feishu.cn: FAIL")) result.dnsOk = false;
    if (/^PORT_(\d+)_PATH_([a-zA-Z0-9_\/]+):\s*OK/.test(line)) result.hasSuccessfulHttpProbe = true;

    const serviceMatch = line.match(/^SERVICE_([^:]+):\s*(.*)$/);
    if (!serviceMatch) continue;
    result.servicesCount++;
    const serviceName = serviceMatch[1].trim().replace(/-/g, "_");
    const serviceState = serviceMatch[2].trim();
    result.services[serviceName] = serviceState.includes("up (pid") || serviceState.includes("running")
      ? "running"
      : serviceState.includes("exit") || serviceState.includes("fail") || serviceState.includes("error")
        ? "error"
        : serviceState.includes("down")
          ? "stopped"
          : serviceState
            ? "starting"
            : "stopped";
  }

  return result;
}
