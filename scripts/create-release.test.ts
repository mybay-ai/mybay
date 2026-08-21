import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { createReleaseArchive, shouldIncludeReleasePath } from "./create-release.mjs";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("release package path filtering", () => {
  it("excludes runtime data, build output, dependencies, secrets and backups", () => {
    for (const target of [
      "data/mybay.sqlite", "data/mybay.sqlite-wal", "data/mybay.sqlite-shm",
      "data/local-store.json", "data/local-store.json.bak", "data/mybay.sqlite.migration-complete",
      "node_modules/pkg/index.js", "dist/server.cjs", "coverage/index.html", ".env", ".env.production",
      "release/mybay-local.zip", "runtime/state.json", "secrets/token.txt", "logs/server.log", "uploads/private.txt",
      ".npmrc", "id_rsa", "id_ed25519", "secret.pem", "certificate.p12", "Dockerfile (2).txt"
    ]) expect(shouldIncludeReleasePath(target), target).toBe(false);
  });

  it("retains source files and public build inputs", () => {
    for (const target of [".env.example", "Dockerfile", "package.json", "server/server.ts", "src/data/docs/docs.registry.ts", "src/main.tsx", "shared/types.ts", "scripts/check-i18n-keys.mjs", "quick-start.sh", "quick-start.ps1"])
      expect(shouldIncludeReleasePath(target), target).toBe(true);
  });
});

  it("archives only tracked files and produces deterministic output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-release-test-"));
    tempRoots.push(root);
    const tracked = [
      "README.md", "LICENSE", "package.json", ".env.example",
      "server/index.ts", "src/main.tsx", "config/example.json",
    ];
    for (const relative of tracked) {
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `${relative}\n`);
    }
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "release-test@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Release Test"], { cwd: root });
    execFileSync("git", ["add", "--", ...tracked], { cwd: root });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: root });
    fs.writeFileSync(path.join(root, "local-secret-test.txt"), "must not ship\n");

    const first = path.join(root, "release", "one.zip");
    const second = path.join(root, "release", "two.zip");
    await createReleaseArchive(first, { projectRoot: root });
    await createReleaseArchive(second, { projectRoot: root });
    const names = new AdmZip(first).getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName);

    expect(names).toEqual([...tracked].sort((a, b) => a.localeCompare(b, "en")));
    expect(names).not.toContain("local-secret-test.txt");
    expect(fs.readFileSync(first)).toEqual(fs.readFileSync(second));
  });
