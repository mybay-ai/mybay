import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, name), "utf8"));

export function checkPublicVersionMetadata(version, metadata = {}) {
  const errors = [];
  const expectedTag = `v${version}`;
  for (const readme of metadata.readmes || []) {
    if (!String(readme.content || "").includes(expectedTag)) {
      errors.push(`${readme.name} does not identify the current public release as ${expectedTag}`);
    }
  }
  for (const changelog of metadata.changelogs || []) {
    const releases = Array.isArray(changelog.releases) ? changelog.releases : [];
    if (!releases.length) {
      errors.push(`${changelog.name} has no public release entry`);
      continue;
    }
    for (const release of releases) {
      if (release?.version !== expectedTag) {
        errors.push(`${changelog.name} contains public release ${release?.version || "<missing>"}; expected only ${expectedTag}`);
      }
    }
  }
  return errors;
}

export function checkVersionConsistency(packageJson, packageLock, publicMetadata) {
  const errors = [];
  const version = String(packageJson.version || "");
  const rootLock = packageLock.packages?.[""];

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    errors.push("package.json has an invalid SemVer version: " + (version || "<missing>"));
  }
  if (packageLock.name !== packageJson.name) {
    errors.push("package-lock.json name (" + packageLock.name + ") does not match package.json (" + packageJson.name + ")");
  }
  if (packageLock.version !== version) {
    errors.push("package-lock.json version (" + packageLock.version + ") does not match package.json (" + version + ")");
  }
  if (!rootLock) {
    errors.push("package-lock.json is missing packages['']");
  } else {
    if (rootLock.name !== packageJson.name) {
      errors.push("package-lock.json root package name (" + rootLock.name + ") does not match package.json (" + packageJson.name + ")");
    }
    if (rootLock.version !== version) {
      errors.push("package-lock.json root package version (" + rootLock.version + ") does not match package.json (" + version + ")");
    }
  }
  errors.push(...checkPublicVersionMetadata(version, publicMetadata));
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const enMarketing = readJson("src/locales/en/marketing.json");
  const zhMarketing = readJson("src/locales/zh-CN/marketing.json");
  const publicMetadata = {
    readmes: [
      { name: "README.md", content: fs.readFileSync(path.join(PROJECT_ROOT, "README.md"), "utf8") },
      { name: "README.zh-CN.md", content: fs.readFileSync(path.join(PROJECT_ROOT, "README.zh-CN.md"), "utf8") },
    ],
    changelogs: [
      { name: "src/locales/en/marketing.json", releases: enMarketing.changelog?.releases },
      { name: "src/locales/zh-CN/marketing.json", releases: zhMarketing.changelog?.releases },
    ],
  };
  const errors = checkVersionConsistency(packageJson, packageLock, publicMetadata);
  if (errors.length) {
    console.error("[Version] Inconsistent release metadata:\n- " + errors.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("[Version] " + packageJson.name + " v" + packageJson.version + " is consistent.");
  }
}
