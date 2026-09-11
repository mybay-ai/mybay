import Docker from "dockerode";

const CONFIG_KEY = "MYBAY_INSTANCE_NETWORK_SUBNETS";

type ParsedSubnet = {
  value: string;
  address: number;
  prefix: number;
};

function parseIpv4Subnet(value: string, requireDedicatedPrivateRange = false): ParsedSubnet | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some(octet => octet < 0 || octet > 255) || prefix < 0 || prefix > 32) return null;
  const [first, second] = octets;
  const isPrivate = first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
  if (requireDedicatedPrivateRange && (!isPrivate || prefix < 24 || prefix > 28)) return null;
  const address = (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  if (((address & mask) >>> 0) !== address) return null;
  return { value: `${octets.join(".")}/${prefix}`, address, prefix };
}

export function readConfiguredInstanceNetworkSubnets(raw = process.env[CONFIG_KEY]): string[] {
  if (!raw?.trim()) return [];
  const values = [...new Set(raw.split(",").map(value => value.trim()).filter(Boolean))];
  if (values.length > 64) throw new Error(`${CONFIG_KEY} accepts at most 64 comma-separated subnets.`);
  const parsed = values.map(value => parseIpv4Subnet(value, true));
  const invalid = values.filter((_value, index) => !parsed[index]);
  if (invalid.length > 0) {
    throw new Error(`${CONFIG_KEY} must contain canonical private IPv4 /24-/28 subnets. Invalid: ${invalid.join(", ")}`);
  }
  return parsed.map(value => value!.value);
}

export function isDockerAddressPoolExhausted(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return message.includes("all predefined address pools have been fully subnetted");
}

function subnetsOverlap(left: string, right: string) {
  const a = parseIpv4Subnet(left, true);
  const b = parseIpv4Subnet(right);
  if (!a || !b) return false;
  const sharedPrefix = Math.min(a.prefix, b.prefix);
  const mask = sharedPrefix === 0 ? 0 : (0xffffffff << (32 - sharedPrefix)) >>> 0;
  return ((a.address & mask) >>> 0) === ((b.address & mask) >>> 0);
}

function isAlreadyExists(error: any) {
  return error?.statusCode === 409 && String(error?.message || "").toLowerCase().includes("already exists");
}

function isSubnetOverlap(error: any) {
  return String(error?.message || "").toLowerCase().includes("pool overlaps");
}

export async function createInstanceNetworkWithFallback(
  dockerClient: Docker,
  networkName: string,
  configuredSubnets = readConfiguredInstanceNetworkSubnets(),
) {
  try {
    return await dockerClient.createNetwork({ Name: networkName });
  } catch (error: any) {
    if (isAlreadyExists(error)) return dockerClient.getNetwork(networkName);
    if (!isDockerAddressPoolExhausted(error)) throw error;
    if (configuredSubnets.length === 0) {
      throw new Error(`${error.message} Configure ${CONFIG_KEY} with dedicated private subnets for safe automatic recovery.`, { cause: error });
    }

    const networks = await dockerClient.listNetworks();
    const occupied = networks.flatMap(network => network.IPAM?.Config?.flatMap(config => config.Subnet ? [config.Subnet] : []) ?? []);
    for (const subnet of configuredSubnets) {
      if (occupied.some(existing => subnetsOverlap(subnet, existing))) continue;
      try {
        return await dockerClient.createNetwork({
          Name: networkName,
          IPAM: { Config: [{ Subnet: subnet }] },
          Labels: { "mybay.managed": "true", "mybay.purpose": "instance-network" },
        });
      } catch (candidateError: any) {
        if (isAlreadyExists(candidateError)) return dockerClient.getNetwork(networkName);
        if (isSubnetOverlap(candidateError)) {
          occupied.push(subnet);
          continue;
        }
        throw candidateError;
      }
    }
    throw new Error(`${CONFIG_KEY} has no unused subnet for ${networkName}.`);
  }
}
