import http from "node:http";
import net from "node:net";
import Docker from "dockerode";
import { afterEach, describe, expect, it } from "vitest";
import { classifyDockerError } from "./dockerErrorClassifier";

const enabled = process.env.MYBAY_DOCKER_E2E === "true";
const docker = new Docker();
const createdNames: string[] = [];

async function getFreePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForHealth(port: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const data = await new Promise<string>((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/health`, (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        }).once("error", reject);
      });
      if (JSON.parse(data).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("fixture health check timed out");
}

async function createFixture(name: string, port: number) {
  createdNames.push(name);
  return docker.createContainer({
    Image: "mybay-local-runtime-fixture:e2e",
    name,
    Env: ["PORT=9119"],
    ExposedPorts: { "9119/tcp": {} },
    HostConfig: { PortBindings: { "9119/tcp": [{ HostIp: "127.0.0.1", HostPort: String(port) }] } },
  });
}

afterEach(async () => {
  await Promise.all(createdNames.splice(0).map(async (name) => {
    const container = docker.getContainer(name);
    await container.remove({ force: true }).catch(() => {});
  }));
});

describe.runIf(enabled)("real Docker lifecycle", () => {
  it("creates, becomes healthy, stops, restarts and deletes a fixture runtime", async () => {
    const port = await getFreePort();
    const name = `mybay-e2e-lifecycle-${process.pid}`;
    const container = await createFixture(name, port);
    await container.start();
    await waitForHealth(port);
    await container.stop();
    expect((await container.inspect()).State.Running).toBe(false);
    await container.start();
    await waitForHealth(port);
    await container.remove({ force: true });
    createdNames.splice(createdNames.indexOf(name), 1);
    await expect(container.inspect()).rejects.toMatchObject({ statusCode: 404 });
  }, 30_000);

  it("feeds a real Docker host-port conflict into the unified classifier", async () => {
    const port = await getFreePort();
    const blocker = await createFixture(`mybay-e2e-blocker-${process.pid}`, port);
    await blocker.start();
    await waitForHealth(port);

    const contender = await createFixture(`mybay-e2e-contender-${process.pid}`, port);
    let dockerError: unknown;
    try {
      await contender.start();
    } catch (error) {
      dockerError = error;
    }
    expect(dockerError).toBeTruthy();
    expect(classifyDockerError(dockerError)).toMatchObject({ code: "PORT_CONFLICT", retryable: true });
  }, 30_000);
});
