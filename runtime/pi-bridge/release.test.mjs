import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import release from "./release.json" with { type: "json" };

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");

test("pinned Pi package, lockfile and Docker identity agree with the release manifest", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.version, release.bridgeVersion);
  assert.equal(lock.version, release.bridgeVersion);
  assert.equal(lock.packages[""].version, release.bridgeVersion);
  assert.equal(pkg.dependencies["@earendil-works/pi-coding-agent"], release.nativeVersion);
  assert.equal(lock.packages["node_modules/@earendil-works/pi-coding-agent"].version, release.nativeVersion);
  const dockerfile = read("Dockerfile");
  assert.ok(dockerfile.includes(`ARG PI_AGENT_VERSION=${release.nativeVersion}`));
  assert.ok(dockerfile.includes(`com.mybay.pi.bridge-version="${release.bridgeVersion}"`));
  assert.ok(dockerfile.includes('com.mybay.pi.agent-version="${PI_AGENT_VERSION}"'));
  assert.ok(dockerfile.includes("mybay-question-extension.mjs mybay-approval-extension.mjs release.json ./"));
});
