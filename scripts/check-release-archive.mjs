import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import yaml from "js-yaml";
import { shouldIncludeReleasePath } from "./create-release.mjs";
import { buildRuntimePublicMetadata, checkVersionConsistency } from "./check-version.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
const archivePath = path.resolve(process.argv[2] || path.join(PROJECT_ROOT, "release", "mybay-open-source-v" + packageJson.version + ".zip"));
const requiredFiles = [
  ".env.example", "BRAND_ASSETS.md", "CODE_OF_CONDUCT.md", "COMMERCIAL-LICENSE.md", "CONTRIBUTING.md", "Dockerfile", "Dockerfile.feishu", "LICENSE",
  "README.md", "README.zh-CN.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md", "TRADEMARKS.md", "WINDOWS-README.md", "WINDOWS-README.zh-CN.md", "deploy/traefik/dynamic.yml",
  "public/specs/mybay.runtime.yaml", "public/specs/pi.runtime.yaml", "public/specs/codex.runtime.yaml",
  "docker-compose.server.yml", "docker-compose.windows.yml", "docker-compose.yml", "package-lock.json", "package.json", "quick-start.ps1", "quick-start.sh",
  "Repair-MyBay.bat", "Start-MyBay.bat", "Stop-MyBay.bat", "Uninstall-MyBay.bat", "View-Logs.bat", "scripts/quick-start-env.ps1", "scripts/quick-start-env.sh",
  "scripts/windows-control.ps1", "scripts/windows-preflight.ps1", "scripts/windows-prerequisites.ps1", "runtime/pi-bridge/Dockerfile",
  "runtime/codex-bridge/Dockerfile", "runtime/codex-bridge/README.md", "runtime/codex-bridge/package.json", "runtime/codex-bridge/package-lock.json", "runtime/codex-bridge/release.json", "runtime/codex-bridge/server.mjs", "runtime/codex-bridge/runtime.mjs", "runtime/codex-bridge/app-server.mjs",
  "runtime/pi-bridge/package.json", "runtime/pi-bridge/package-lock.json", "runtime/pi-bridge/release.json", "runtime/pi-bridge/server.mjs",
];

if (!fs.existsSync(archivePath)) throw new Error("Release archive not found: " + archivePath);

const zip = unzipSync(fs.readFileSync(archivePath));
const names = Object.keys(zip).filter((name) => !name.endsWith("/")).map((name) => name.replaceAll("\\", "/"));
const readAsText = (name) => Buffer.from(zip[name]).toString("utf8");
const invalid = names.filter((name) => name.startsWith("/") || name.split("/").includes("..") || !shouldIncludeReleasePath(name));
const missing = requiredFiles.filter((name) => !names.includes(name));
const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
const privateKeyEntries = names.filter((name) => {
  if (zip[name].byteLength > 2 * 1024 * 1024) return false;
  const pemPrivateKey = /-----BEGIN ((?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY)-----\r?\n(?:[A-Za-z0-9+/=]{16,}\r?\n)+-----END \1-----/;
  return pemPrivateKey.test(readAsText(name));
});

if (invalid.length) throw new Error("Archive contains forbidden paths:\n- " + invalid.join("\n- "));
if (missing.length) throw new Error("Archive is missing required files:\n- " + missing.join("\n- "));
if (duplicates.length) throw new Error("Archive contains duplicate paths:\n- " + [...new Set(duplicates)].join("\n- "));
if (privateKeyEntries.length) throw new Error("Archive contains private-key material:\n- " + privateKeyEntries.join("\n- "));

const archivedPackage = JSON.parse(readAsText("package.json"));
const archivedLock = JSON.parse(readAsText("package-lock.json"));
const archivedEnMarketing = JSON.parse(readAsText("src/locales/en/marketing.json"));
const archivedZhMarketing = JSON.parse(readAsText("src/locales/zh-CN/marketing.json"));
const archivedPiRelease = JSON.parse(readAsText("runtime/pi-bridge/release.json"));
const archivedPiPackage = JSON.parse(readAsText("runtime/pi-bridge/package.json"));
const archivedPiPackageLock = JSON.parse(readAsText("runtime/pi-bridge/package-lock.json"));
const archivedCodexRelease = JSON.parse(readAsText("runtime/codex-bridge/release.json"));
const archivedCodexPackage = JSON.parse(readAsText("runtime/codex-bridge/package.json"));
const archivedCodexPackageLock = JSON.parse(readAsText("runtime/codex-bridge/package-lock.json"));
const archivedReadmes = [
  { name: "README.md", content: readAsText("README.md") },
  { name: "README.zh-CN.md", content: readAsText("README.zh-CN.md") },
];
const archivedRuntimeSpecs = ["mybay.runtime.yaml", "pi.runtime.yaml", "codex.runtime.yaml"].map((name) =>
  yaml.load(readAsText(`public/specs/${name}`))
);
const archivedPublicMetadata = {
  readmes: archivedReadmes,
  changelogs: [
    { name: "src/locales/en/marketing.json", releases: archivedEnMarketing.changelog?.releases },
    { name: "src/locales/zh-CN/marketing.json", releases: archivedZhMarketing.changelog?.releases },
  ],
  runtimeBridges: [
    {
      name: "Pi bridge",
      release: archivedPiRelease,
      packageJson: archivedPiPackage,
      packageLock: archivedPiPackageLock,
      nativePackage: "@earendil-works/pi-coding-agent",
      dockerfile: { name: "runtime/pi-bridge/Dockerfile", content: readAsText("runtime/pi-bridge/Dockerfile") },
      dockerLabels: { bridge: "com.mybay.pi.bridge-version" },
      references: [
        ...archivedReadmes,
      ],
    },
    {
      name: "Codex bridge",
      release: archivedCodexRelease,
      packageJson: archivedCodexPackage,
      packageLock: archivedCodexPackageLock,
      nativePackage: "@openai/codex",
      dockerfile: { name: "runtime/codex-bridge/Dockerfile", content: readAsText("runtime/codex-bridge/Dockerfile") },
      dockerLabels: { bridge: "com.mybay.codex.bridge-version", native: "com.mybay.codex.agent-version" },
      references: [
        ...archivedReadmes,
        { name: "runtime/codex-bridge/README.md", content: readAsText("runtime/codex-bridge/README.md") },
      ],
    },
  ],
  runtimes: buildRuntimePublicMetadata(archivedRuntimeSpecs, archivedReadmes),
};
const versionErrors = checkVersionConsistency(archivedPackage, archivedLock, archivedPublicMetadata);
if (versionErrors.length) throw new Error("Archive version metadata is inconsistent:\n- " + versionErrors.join("\n- "));
if (archivedPackage.version !== packageJson.version) {
  throw new Error("Archive version (" + archivedPackage.version + ") does not match workspace (" + packageJson.version + ")");
}

console.log("[Release] Clean archive verified: " + archivePath + " (" + names.length + " files, v" + archivedPackage.version + ").");
