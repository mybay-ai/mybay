export function resolveServerPort(rawPort?: string): number {
  if (!rawPort) {
    return 3000;
  }
  const parsedPort = Number(rawPort);
  if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    return parsedPort;
  }
  return 3000;
}
