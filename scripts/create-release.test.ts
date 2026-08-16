import { describe, expect, it } from "vitest";
import { shouldIncludeReleasePath } from "./create-release.mjs";

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
