import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import release from "./release.json" with { type: "json" };

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
test("pinned native package, lockfile and Docker identity agree with the release manifest", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.dependencies["@openai/codex"], release.nativeVersion);
  assert.equal(lock.packages["node_modules/@openai/codex"].version, release.nativeVersion);
  const dockerfile = read("Dockerfile");
  assert.ok(dockerfile.includes(`com.mybay.codex.agent-version="${release.nativeVersion}"`));
  assert.ok(dockerfile.includes(`com.mybay.codex.bridge-version="${release.bridgeVersion}"`));
  assert.ok(dockerfile.includes("server.mjs release.json ./"));
});
