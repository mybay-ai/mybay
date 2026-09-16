import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

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

export function buildRuntimePublicMetadata(specs = [], readmes = []) {
  return specs.map((spec) => ({
    ...spec,
    references: readmes.map((readme) => {
      const displayName = String(spec.displayName || "");
      const line = String(readme.content || "").split(/\r?\n/).find((candidate) =>
        candidate.includes(`**${displayName}:**`) || candidate.includes(`**${displayName}：**`)
      );
      return { name: readme.name, content: line || "" };
    }),
  }));
}

export function checkRuntimePublicMetadata(runtimes = []) {
  const errors = [];
  for (const runtime of runtimes) {
    const name = runtime.displayName || runtime.name || "Runtime";
    const version = String(runtime.version || "");
    const certificationLevel = String(runtime.release?.certificationLevel || "");
    const bridgeVersion = runtime.release?.bridgeVersion == null ? "" : String(runtime.release.bridgeVersion);
    if (!version || version.toLowerCase() === "latest") {
      errors.push(`${name} public Runtime version is not reproducibly pinned`);
    }
    if (!certificationLevel) {
      errors.push(`${name} public Runtime certification level is missing`);
    }
    for (const reference of runtime.references || []) {
      const content = String(reference.content || "");
      if (!content) {
        errors.push(`${reference.name} is missing the public ${name} release entry`);
        continue;
      }
      if (version && !content.includes(version)) {
        errors.push(`${reference.name} does not identify ${name} Runtime version ${version}`);
      }
      if (certificationLevel && !content.toLowerCase().includes(certificationLevel.toLowerCase())) {
        errors.push(`${reference.name} does not identify ${name} certification level ${certificationLevel}`);
      }
      if (bridgeVersion && !content.includes(bridgeVersion)) {
        errors.push(`${reference.name} does not identify ${name} bridge version ${bridgeVersion}`);
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
  errors.push(...checkRuntimePublicMetadata(publicMetadata.runtimes));
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const enMarketing = readJson("src/locales/en/marketing.json");
  const zhMarketing = readJson("src/locales/zh-CN/marketing.json");
  const piRelease = readJson("runtime/pi-bridge/release.json");
  const piPackage = readJson("runtime/pi-bridge/package.json");
  const piPackageLock = readJson("runtime/pi-bridge/package-lock.json");
  const codexRelease = readJson("runtime/codex-bridge/release.json");
  const codexPackage = readJson("runtime/codex-bridge/package.json");
  const codexPackageLock = readJson("runtime/codex-bridge/package-lock.json");
  const publicReadmes = [
    { name: "README.md", content: fs.readFileSync(path.join(PROJECT_ROOT, "README.md"), "utf8") },
    { name: "README.zh-CN.md", content: fs.readFileSync(path.join(PROJECT_ROOT, "README.zh-CN.md"), "utf8") },
  ];
  const runtimeSpecs = ["mybay.runtime.yaml", "pi.runtime.yaml", "codex.runtime.yaml"].map((name) =>
    yaml.load(fs.readFileSync(path.join(PROJECT_ROOT, "public/specs", name), "utf8"))
  );
  const publicMetadata = {
    readmes: publicReadmes,
    changelogs: [
      { name: "src/locales/en/marketing.json", releases: enMarketing.changelog?.releases },
      { name: "src/locales/zh-CN/marketing.json", releases: zhMarketing.changelog?.releases },
    ],
    runtimeBridges: [
      {
        name: "Pi bridge",
        release: piRelease,
        packageJson: piPackage,
        packageLock: piPackageLock,
        nativePackage: "@earendil-works/pi-coding-agent",
        dockerfile: { name: "runtime/pi-bridge/Dockerfile", content: fs.readFileSync(path.join(PROJECT_ROOT, "runtime/pi-bridge/Dockerfile"), "utf8") },
        dockerLabels: { bridge: "com.mybay.pi.bridge-version" },
        references: [
          ...publicReadmes,
        ],
      },
      {
        name: "Codex bridge",
        release: codexRelease,
        packageJson: codexPackage,
        packageLock: codexPackageLock,
        nativePackage: "@openai/codex",
        dockerfile: { name: "runtime/codex-bridge/Dockerfile", content: fs.readFileSync(path.join(PROJECT_ROOT, "runtime/codex-bridge/Dockerfile"), "utf8") },
        dockerLabels: { bridge: "com.mybay.codex.bridge-version", native: "com.mybay.codex.agent-version" },
        references: [
          ...publicReadmes,
          { name: "runtime/codex-bridge/README.md", content: fs.readFileSync(path.join(PROJECT_ROOT, "runtime/codex-bridge/README.md"), "utf8") },
        ],
      },
    ],
    runtimes: buildRuntimePublicMetadata(runtimeSpecs, publicReadmes),
  };
  const errors = checkVersionConsistency(packageJson, packageLock, publicMetadata);
  if (errors.length) {
    console.error("[Version] Inconsistent release metadata:\n- " + errors.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("[Version] " + packageJson.name + " v" + packageJson.version + " is consistent.");
  }
}
