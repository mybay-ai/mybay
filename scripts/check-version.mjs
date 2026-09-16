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

export function checkRuntimeBridgeMetadata(runtimeBridges = []) {
  const errors = [];
  for (const bridge of runtimeBridges) {
    const name = bridge.name || "Runtime bridge";
    const bridgeVersion = String(bridge.release?.bridgeVersion || "");
    const nativeVersion = String(bridge.release?.nativeVersion || "");
    const rootLock = bridge.packageLock?.packages?.[""];
    if (!bridgeVersion) {
      errors.push(`${name} release metadata is missing bridgeVersion`);
      continue;
    }
    if (bridge.packageJson?.version !== bridgeVersion) {
      errors.push(`${name} package version (${bridge.packageJson?.version || "<missing>"}) does not match release bridgeVersion (${bridgeVersion})`);
    }
    if (bridge.packageLock?.version !== bridgeVersion) {
      errors.push(`${name} lockfile version (${bridge.packageLock?.version || "<missing>"}) does not match release bridgeVersion (${bridgeVersion})`);
    }
    if (rootLock?.version !== bridgeVersion) {
      errors.push(`${name} lockfile root version (${rootLock?.version || "<missing>"}) does not match release bridgeVersion (${bridgeVersion})`);
    }
    if (bridge.nativePackage && nativeVersion) {
      if (bridge.packageJson?.dependencies?.[bridge.nativePackage] !== nativeVersion) {
        errors.push(`${name} native dependency (${bridge.packageJson?.dependencies?.[bridge.nativePackage] || "<missing>"}) does not match release nativeVersion (${nativeVersion})`);
      }
      if (rootLock?.dependencies?.[bridge.nativePackage] !== nativeVersion) {
        errors.push(`${name} lockfile native dependency (${rootLock?.dependencies?.[bridge.nativePackage] || "<missing>"}) does not match release nativeVersion (${nativeVersion})`);
      }
      if (bridge.packageLock?.packages?.[`node_modules/${bridge.nativePackage}`]?.version !== nativeVersion) {
        errors.push(`${name} locked native package (${bridge.packageLock?.packages?.[`node_modules/${bridge.nativePackage}`]?.version || "<missing>"}) does not match release nativeVersion (${nativeVersion})`);
      }
    }
    const dockerfile = String(bridge.dockerfile?.content || "");
    if (bridge.dockerLabels?.bridge && !dockerfile.includes(`${bridge.dockerLabels.bridge}="${bridgeVersion}"`)) {
      errors.push(`${bridge.dockerfile?.name || `${name} Dockerfile`} does not label bridgeVersion ${bridgeVersion}`);
    }
    if (bridge.dockerLabels?.native && nativeVersion && !dockerfile.includes(`${bridge.dockerLabels.native}="${nativeVersion}"`)) {
      errors.push(`${bridge.dockerfile?.name || `${name} Dockerfile`} does not label nativeVersion ${nativeVersion}`);
    }
    for (const reference of bridge.references || []) {
      if (!String(reference.content || "").includes(bridgeVersion)) {
        errors.push(`${reference.name} does not identify the current ${name} version as ${bridgeVersion}`);
      }
    }
  }
  return errors;
}

export function checkVersionConsistency(packageJson, packageLock, publicMetadata = {}) {
  const errors = [];
  const version = String(packageJson.version || "");
  const rootLock = packageLock.packages?.[""];

  if (!/^\d+\.\d+\.\d+(?:\.\d+|-[0-9A-Za-z.-]+)?$/.test(version)) {
    errors.push("package.json has an invalid supported release version: " + (version || "<missing>"));
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
  errors.push(...checkRuntimeBridgeMetadata(publicMetadata.runtimeBridges));
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const enMarketing = readJson("src/locales/en/marketing.json");
  const zhMarketing = readJson("src/locales/zh-CN/marketing.json");
  const codexRelease = readJson("runtime/codex-bridge/release.json");
  const codexPackage = readJson("runtime/codex-bridge/package.json");
  const codexPackageLock = readJson("runtime/codex-bridge/package-lock.json");
  const publicMetadata = {
    readmes: [
      { name: "README.md", content: fs.readFileSync(path.join(PROJECT_ROOT, "README.md"), "utf8") },
      { name: "README.zh-CN.md", content: fs.readFileSync(path.join(PROJECT_ROOT, "README.zh-CN.md"), "utf8") },
    ],
    changelogs: [
      { name: "src/locales/en/marketing.json", releases: enMarketing.changelog?.releases },
      { name: "src/locales/zh-CN/marketing.json", releases: zhMarketing.changelog?.releases },
    ],
    runtimeBridges: [{
      name: "Codex bridge",
      release: codexRelease,
      packageJson: codexPackage,
      packageLock: codexPackageLock,
      nativePackage: "@openai/codex",
      dockerfile: { name: "runtime/codex-bridge/Dockerfile", content: fs.readFileSync(path.join(PROJECT_ROOT, "runtime/codex-bridge/Dockerfile"), "utf8") },
      dockerLabels: { bridge: "com.mybay.codex.bridge-version", native: "com.mybay.codex.agent-version" },
      references: [
        { name: "README.md", content: fs.readFileSync(path.join(PROJECT_ROOT, "README.md"), "utf8") },
        { name: "README.zh-CN.md", content: fs.readFileSync(path.join(PROJECT_ROOT, "README.zh-CN.md"), "utf8") },
        { name: "runtime/codex-bridge/README.md", content: fs.readFileSync(path.join(PROJECT_ROOT, "runtime/codex-bridge/README.md"), "utf8") },
      ],
    }],
  };
  const errors = checkVersionConsistency(packageJson, packageLock, publicMetadata);
  if (errors.length) {
    console.error("[Version] Inconsistent release metadata:\n- " + errors.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("[Version] " + packageJson.name + " v" + packageJson.version + " is consistent.");
  }
}
