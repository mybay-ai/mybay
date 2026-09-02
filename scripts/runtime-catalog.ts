import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  RUNTIME_DEFINITIONS,
  toRuntimeManifest,
  type RuntimeDefinition,
} from "../shared/runtimeCatalog";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const writeOutputs = process.argv.includes("--write");
const errors: string[] = [];

function manifestRelativePath(definition: RuntimeDefinition): string {
  return definition.runtime.type === "hermes"
    ? "public/specs/mybay.runtime.yaml"
    : `public/specs/${definition.runtime.type}.runtime.yaml`;
}

function manifestDocument(definition: RuntimeDefinition): string {
  const header = `# Generated from shared/runtimeCatalog.ts. Do not edit by hand.\n`;
  return header + yaml.dump(toRuntimeManifest(definition), {
    noRefs: true,
    lineWidth: 120,
    sortKeys: false,
  });
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function capabilityNames(definition: RuntimeDefinition): string {
  const capabilities = definition.capabilities;
  return [
    capabilities.chat && "chat",
    capabilities.fileUpload && "file-upload",
    capabilities.scheduledTasks && "scheduled-tasks",
    capabilities.browser && "browser",
    capabilities.shell && "shell",
  ].filter(Boolean).join(", ") || "none";
}

function matrixDocument(): string {
  const rows = RUNTIME_DEFINITIONS.map((definition) => {
    const modes = definition.lifecycle.conversation.modes.join(", ") || "none";
    const channels = definition.capabilities.imChannels.join(", ") || "none";
    return `| ${definition.displayName} | ${definition.runtime.type} | ${definition.release.supportStatus} | ${definition.release.certificationLevel} | ${yesNo(definition.release.deploymentSupported)} | ${modes} | ${yesNo(definition.lifecycle.cancellation.supported)} | ${capabilityNames(definition)} | ${channels} |`;
  });
  return [
    "# MyBay Runtime Capability Matrix",
    "",
    "<!-- Generated from shared/runtimeCatalog.ts. Do not edit by hand. -->",
    "",
    "Runtime-declared capabilities describe the integration contract. They do not prove certification. See `runtime-certification.md` for evidence-backed status and `runtime-guard-capability-matrix.md` for enforced security guards.",
    "",
    "| Runtime | Type | Support status | Declared certification | Deployable | Conversation modes | Cancellation | Declared capabilities | Channels |",
    "| --- | --- | --- | --- | ---: | --- | ---: | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function checkOrWrite(relativePath: string, expected: string): void {
  const target = path.join(projectRoot, relativePath);
  if (writeOutputs) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, expected, "utf8");
    return;
  }
  if (!fs.existsSync(target)) {
    errors.push(`${relativePath}: generated artifact is missing`);
    return;
  }
  const actual = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
  if (actual !== expected.replace(/\r\n/g, "\n")) {
    errors.push(`${relativePath}: generated artifact is stale; run npm run runtime:build`);
  }
}

for (const definition of RUNTIME_DEFINITIONS) {
  checkOrWrite(manifestRelativePath(definition), manifestDocument(definition));
}
checkOrWrite("docs/runtime-capability-matrix.md", matrixDocument());

for (const error of errors) console.error(`[runtime:error] ${error}`);
console.log(`[runtime] definitions=${RUNTIME_DEFINITIONS.length} mode=${writeOutputs ? "write" : "check"} errors=${errors.length}`);
if (errors.length > 0) process.exitCode = 1;
