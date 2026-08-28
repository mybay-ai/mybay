import { describe, expect, it } from "vitest";
import { parseGatewayContainerProbeOutput } from "./gatewayContainerProbe";

describe("parseGatewayContainerProbeOutput", () => {
  it("normalizes HTTP, TCP, DNS, and s6 evidence", () => {
    const result = parseGatewayContainerProbeOutput([
      "PORT_9119_PATH_health: OK (HTTP 200)",
      "PORT_8642_LISTEN: OK",
      "PORT_8644_PATH_health: OK (HTTP 401)",
      "DNS_open.feishu.cn: FAIL",
      "SERVICE_main-hermes: up (pid 42) 10 seconds",
      "SERVICE_dashboard: down 2 seconds",
      "SERVICE_worker: starting",
    ].join("\n"));

    expect(result.hasSuccessfulHttpProbe).toBe(true);
    expect(result.isApiPortListening).toBe(true);
    expect(result.isWebhookPortListening).toBe(true);
    expect(result.dnsOk).toBe(false);
    expect(result.servicesCount).toBe(3);
    expect(result.services).toEqual({
      main_hermes: "running",
      dashboard: "stopped",
      worker: "starting",
    });
  });
});
