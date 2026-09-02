import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { shouldIncludeReleasePath } from "./create-release.mjs";
import { checkVersionConsistency } from "./check-version.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
const archivePath = path.resolve(process.argv[2] || path.join(PROJECT_ROOT, "release", "mybay-open-source-v" + packageJson.version + ".zip"));
const requiredFiles = [
  ".env.example", "BRAND_ASSETS.md", "CODE_OF_CONDUCT.md", "COMMERCIAL-LICENSE.md", "CONTRIBUTING.md", "Dockerfile", "Dockerfile.feishu", "LICENSE",
  "README.md", "README.zh-CN.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md", "TRADEMARKS.md", "WINDOWS-README.md", "WINDOWS-README.zh-CN.md", "deploy/traefik/dynamic.yml",
  "docker-compose.server.yml", "docker-compose.windows.yml", "docker-compose.yml", "package-lock.json", "package.json", "quick-start.ps1", "quick-start.sh",
  "Repair-MyBay.bat", "Start-MyBay.bat", "Stop-MyBay.bat", "Uninstall-MyBay.bat", "View-Logs.bat", "scripts/quick-start-env.ps1", "scripts/quick-start-env.sh",
  "scripts/windows-control.ps1", "scripts/windows-preflight.ps1", "scripts/windows-prerequisites.ps1",
];

if (!fs.existsSync(archivePath)) throw new Error("Release archive not found: " + archivePath);

const zip = new AdmZip(archivePath);
const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
const names = entries.map((entry) => entry.entryName.replaceAll("\\", "/"));
const invalid = names.filter((name) => name.startsWith("/") || name.split("/").includes("..") || !shouldIncludeReleasePath(name));
const missing = requiredFiles.filter((name) => !names.includes(name));
const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
const privateKeyEntries = entries.filter((entry) => {
  if (entry.header.size > 2 * 1024 * 1024) return false;
  const pemPrivateKey = /-----BEGIN ((?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY)-----\r?\n(?:[A-Za-z0-9+/=]{16,}\r?\n)+-----END \1-----/;
  return pemPrivateKey.test(entry.getData().toString("utf8"));
});

if (invalid.length) throw new Error("Archive contains forbidden paths:\n- " + invalid.join("\n- "));
if (missing.length) throw new Error("Archive is missing required files:\n- " + missing.join("\n- "));
if (duplicates.length) throw new Error("Archive contains duplicate paths:\n- " + [...new Set(duplicates)].join("\n- "));
if (privateKeyEntries.length) throw new Error("Archive contains private-key material:\n- " + privateKeyEntries.map((entry) => entry.entryName).join("\n- "));

const archivedPackage = JSON.parse(zip.readAsText("package.json"));
const archivedLock = JSON.parse(zip.readAsText("package-lock.json"));
const archivedEnMarketing = JSON.parse(zip.readAsText("src/locales/en/marketing.json"));
const archivedZhMarketing = JSON.parse(zip.readAsText("src/locales/zh-CN/marketing.json"));
const archivedPublicMetadata = {
  readmes: [
    { name: "README.md", content: zip.readAsText("README.md") },
    { name: "README.zh-CN.md", content: zip.readAsText("README.zh-CN.md") },
  ],
  changelogs: [
    { name: "src/locales/en/marketing.json", releases: archivedEnMarketing.changelog?.releases },
    { name: "src/locales/zh-CN/marketing.json", releases: archivedZhMarketing.changelog?.releases },
  ],
};
const versionErrors = checkVersionConsistency(archivedPackage, archivedLock, archivedPublicMetadata);
if (versionErrors.length) throw new Error("Archive version metadata is inconsistent:\n- " + versionErrors.join("\n- "));
if (archivedPackage.version !== packageJson.version) {
  throw new Error("Archive version (" + archivedPackage.version + ") does not match workspace (" + packageJson.version + ")");
}

console.log("[Release] Clean archive verified: " + archivePath + " (" + entries.length + " files, v" + archivedPackage.version + ").");
