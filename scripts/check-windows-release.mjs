import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { WINDOWS_RELEASE_FILES } from "./create-windows-release.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
const archivePath = path.resolve(process.argv[2] || path.join(PROJECT_ROOT, "release", `MyBay-Windows-v${packageJson.version}.zip`));

if (!fs.existsSync(archivePath)) throw new Error(`Windows release archive not found: ${archivePath}`);

const zip = new AdmZip(archivePath);
const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
const names = entries.map((entry) => entry.entryName.replaceAll("\\", "/"));
const expected = [...WINDOWS_RELEASE_FILES].sort();
const actual = [...names].sort();
const missing = expected.filter((name) => !actual.includes(name));
const unexpected = actual.filter((name) => !expected.includes(name));
const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
const unsafe = names.filter((name) => name.startsWith("/") || name.split("/").includes(".."));

if (missing.length) throw new Error(`Windows archive is missing files:\n- ${missing.join("\n- ")}`);
if (unexpected.length) throw new Error(`Windows archive contains unexpected files:\n- ${unexpected.join("\n- ")}`);
if (duplicates.length) throw new Error(`Windows archive contains duplicate files:\n- ${[...new Set(duplicates)].join("\n- ")}`);
if (unsafe.length) throw new Error(`Windows archive contains unsafe paths:\n- ${unsafe.join("\n- ")}`);

const archivedPackage = JSON.parse(zip.readAsText("package.json"));
if (archivedPackage.version !== packageJson.version) {
  throw new Error(`Windows archive version ${archivedPackage.version} does not match workspace ${packageJson.version}.`);
}
const envExample = zip.readAsText(".env.example");
if (!envExample.includes(`MYBAY_CONTROL_PANEL_IMAGE=ghcr.io/mybay-ai/mybay:${packageJson.version}`)) {
  throw new Error("Windows archive does not pin the control-panel image to the package version.");
}
const compose = zip.readAsText("docker-compose.windows.yml");
if (/^\s*build:/m.test(compose) || !compose.includes("MYBAY_CONTROL_PANEL_IMAGE")) {
  throw new Error("Windows Compose must use the pinned prebuilt image and must not build source.");
}
const uninstall = zip.readAsText("scripts/windows-control.ps1");
if (/Remove-Item/i.test(uninstall) || !/data directory will be preserved/i.test(uninstall)) {
  throw new Error("Windows uninstall must preserve local configuration and data.");
}
const startLauncher = zip.readAsText("Start-MyBay.bat");
if (!startLauncher.includes("-InstallPrerequisites") || !startLauncher.includes("ERRORLEVEL% EQU 10")) {
  throw new Error("Windows start launcher must install prerequisites and handle restart continuation.");
}
const preflight = zip.readAsText("scripts/windows-preflight.ps1");
for (const contract of ["2.1.5", "MyBayInstallResume", "Switch to Linux containers", "GHCR_DNS_FAILED", "GHCR_TLS_FAILED", "GHCR_IMAGE_NOT_FOUND", "Get-MyBayOptionalPropertyValue"]) {
  if (!preflight.includes(contract)) throw new Error(`Windows preflight contract is missing: ${contract}`);
}
const acceptance = zip.readAsText("scripts/windows-acceptance.ps1");
for (const contract of ["Manual product gates", "secret values were not read", "Docker socket in control panel", "MyBayInstallResume"]) {
  if (!acceptance.includes(contract)) throw new Error(`Windows acceptance contract is missing: ${contract}`);
}
if (!zip.readAsText("Collect-Diagnostics.bat").includes("windows-acceptance.ps1")) {
  throw new Error("Windows diagnostics launcher must call the acceptance evidence collector.");
}

console.log(`[Release] Windows archive verified: ${archivePath} (${entries.length} files, v${packageJson.version}).`);
