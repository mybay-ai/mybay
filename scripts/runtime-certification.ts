import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  evaluateRuntimeCertification,
  RUNTIME_CERTIFICATION_REQUIREMENTS,
  type AnyRuntimeCertificationEvidenceBundle,
  type RuntimeCertificationEnvironment,
  type RuntimeCertificationReport,
} from "../shared/runtimeCertification";
import { RUNTIME_DEFINITIONS, type RuntimeDefinition } from "../shared/runtimeCatalog";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")).version as string;
const writeOutputs = process.argv.includes("--write");
const strict = process.argv.includes("--strict");
const errors: string[] = [];
const requirementIds: ReadonlySet<string> = new Set(RUNTIME_CERTIFICATION_REQUIREMENTS.map(({ id }) => id));

interface PublishedRuntimeCertification extends RuntimeCertificationReport {
  readonly evidenceFile: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateEvidenceReference(reference: string, checkIndex: number): void {
  if (/^https?:\/\//i.test(reference)) return;
  const [referencedPath, fragment] = reference.split("#", 2);
  const absolutePath = path.resolve(projectRoot, referencedPath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (!referencedPath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`check ${checkIndex} evidence reference escapes the project root`);
  }
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`check ${checkIndex} evidence reference is missing: ${reference}`);
  }
  if (fragment && path.extname(absolutePath).toLowerCase() === ".json") {
    const document: unknown = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    const found = fragment.split(".").filter(Boolean).reduce<unknown>((value, key) =>
      isRecord(value) ? value[key] : undefined, document);
    if (found === undefined) {
      throw new Error(`check ${checkIndex} evidence fragment is missing: ${reference}`);
    }
  }
}

function validateEnvironment(value: unknown, index: number): value is RuntimeCertificationEnvironment {
  if (!isRecord(value)
    || typeof value.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(value.id)
    || !["windows", "linux", "macos"].includes(String(value.platform))
    || (value.platformVersion !== null && typeof value.platformVersion !== "string")
    || (value.architecture !== null && typeof value.architecture !== "string")
    || !["docker-desktop", "docker-engine", "other"].includes(String(value.containerEngine))
    || (value.containerEngineVersion !== null && typeof value.containerEngineVersion !== "string")
    || typeof value.runtimeVersion !== "string" || !value.runtimeVersion.trim()
    || typeof value.mybayVersion !== "string" || !value.mybayVersion.trim()
    || typeof value.headless !== "boolean") {
    throw new Error(`environment ${index} is invalid`);
  }
  return true;
}

function validateArtifacts(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value) || value.length === 0) throw new Error("retained artifact hashes are required");
  const paths = new Set<string>();
  for (const [index, artifact] of value.entries()) {
    if (!isRecord(artifact) || typeof artifact.path !== "string" || !/^[a-f0-9]{64}$/.test(String(artifact.sha256))) {
      throw new Error(`artifact ${index} is invalid`);
    }
    const absolutePath = path.resolve(projectRoot, artifact.path);
    const relativePath = path.relative(projectRoot, absolutePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || !fs.existsSync(absolutePath)) {
      throw new Error(`artifact ${index} path is missing or escapes the project root`);
    }
    if (paths.has(artifact.path)) throw new Error(`artifact path is duplicated: ${artifact.path}`);
    const contents = fs.readFileSync(absolutePath);
    const hashes = new Set([crypto.createHash("sha256").update(contents).digest("hex")]);
    if ([".json", ".md", ".txt", ".log"].includes(path.extname(absolutePath).toLowerCase())) {
      const normalized = contents.toString("utf8").replace(/\r\n?/g, "\n");
      hashes.add(crypto.createHash("sha256").update(normalized, "utf8").digest("hex"));
      hashes.add(crypto.createHash("sha256").update(normalized.replace(/\n/g, "\r\n"), "utf8").digest("hex"));
    }
    if (!hashes.has(String(artifact.sha256))) throw new Error(`artifact hash mismatch: ${artifact.path}`);
    paths.add(artifact.path);
  }
  return paths;
}

function parseEvidence(relativePath: string): AnyRuntimeCertificationEvidenceBundle | undefined {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return undefined;
  try {
    const value: unknown = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    if (!isRecord(value) || ![2, 3].includes(Number(value.schemaVersion)) || !isRecord(value.runtime)
      || !Array.isArray(value.environments) || !Array.isArray(value.artifacts) || !Array.isArray(value.checks)) {
      throw new Error("root, runtime, or checks structure is invalid");
    }
    if (typeof value.runtime.type !== "string"
      || typeof value.runtime.providerKey !== "string"
      || !Number.isSafeInteger(value.runtime.contractVersion)) {
      throw new Error("runtime binding is invalid");
    }
    if (value.schemaVersion === 2) {
      if (typeof value.runtime.version !== "string" || typeof value.runtime.imageRef !== "string") {
        throw new Error("legacy runtime release identity is invalid");
      }
    } else {
      const artifactIdentity = value.runtime.artifactIdentity;
      if (typeof value.runtime.nativeVersion !== "string"
        || (value.runtime.bridgeVersion !== null && typeof value.runtime.bridgeVersion !== "string")
        || typeof value.runtime.imageRef !== "string"
        || (artifactIdentity !== null && (!isRecord(artifactIdentity)
          || !["oci-digest", "docker-image-id"].includes(String(artifactIdentity.kind))
          || !/^sha256:[a-f0-9]{64}$/.test(String(artifactIdentity.value))))) {
        throw new Error("runtime release identity is invalid");
      }
    }
    value.environments.forEach((environment, index) => validateEnvironment(environment, index));
    if (new Set(value.environments.map((environment) => (environment as RuntimeCertificationEnvironment).id)).size !== value.environments.length) {
      throw new Error("environment ids must be unique");
    }
    const artifactPaths = validateArtifacts(value.artifacts);
    for (const [index, check] of value.checks.entries()) {
      if (!isRecord(check)
        || typeof check.requirementId !== "string"
        || !requirementIds.has(check.requirementId)
        || !["passed", "failed"].includes(String(check.status))
        || !["contract", "runtime", "e2e"].includes(String(check.scope))
        || typeof check.observedAt !== "string"
        || (check.validUntil !== undefined && typeof check.validUntil !== "string")
        || typeof check.environment !== "string"
        || (check.command !== undefined && typeof check.command !== "string")
        || !Array.isArray(check.evidenceRefs)
        || check.evidenceRefs.some((reference) => typeof reference !== "string")
        || (check.note !== undefined && typeof check.note !== "string")) {
        throw new Error(`check ${index} is invalid`);
      }
      for (const reference of check.evidenceRefs as string[]) {
        validateEvidenceReference(reference, index);
        if (!/^https?:\/\//i.test(reference) && !artifactPaths.has(reference.split("#", 1)[0])) {
          throw new Error(`check ${index} evidence reference has no retained SHA-256: ${reference}`);
        }
      }
    }
    return value as unknown as AnyRuntimeCertificationEvidenceBundle;
  } catch (error: any) {
    errors.push(`${relativePath}: ${error?.message || "invalid certification evidence"}`);
    return undefined;
  }
}

function publishedReport(definition: RuntimeDefinition): PublishedRuntimeCertification {
  const relativeEvidencePath = `certification/evidence/${definition.runtime.type}.certification.json`;
  const evidenceExists = fs.existsSync(path.join(projectRoot, relativeEvidencePath));
  const report = evaluateRuntimeCertification(
    definition,
    evidenceExists ? parseEvidence(relativeEvidencePath) : undefined,
    { expectedMybayVersion: packageVersion },
  );
  return {
    ...report,
    evidenceFile: evidenceExists ? relativeEvidencePath : null,
  };
}

const reports = RUNTIME_DEFINITIONS.map(publishedReport);

function publicDocument(): string {
  return `${JSON.stringify({
    schemaVersion: 3,
    generatedFrom: [
      "shared/runtimeCatalog.ts",
      "shared/runtimeCertification.ts",
      "certification/evidence/*.certification.json",
    ],
    requirements: RUNTIME_CERTIFICATION_REQUIREMENTS,
    runtimes: reports,
  }, null, 2)}\n`;
}

function certificationDocument(): string {
  const runtimeRows = reports.map((report) => {
    const platforms = report.environments.length > 0
      ? report.environments.map((environment) => `${environment.platform}/${environment.architecture ?? "not-retained"} (${environment.containerEngine})`).join(", ")
      : "none";
    const lastVerified = report.requirements.map((requirement) => requirement.evidence?.observedAt).filter(Boolean).sort().at(-1) ?? "none";
    return `| ${report.runtimeType} | ${report.declaredLevel} | ${report.verifiedLevel} | ${report.identityStatus} | ${report.artifactVerification} | ${report.publicationStatus} | ${platforms} | ${lastVerified} | ${report.evidenceFile ?? "none"} |`;
  });
  const requirementRows = RUNTIME_CERTIFICATION_REQUIREMENTS.map((requirement) =>
    `| ${requirement.level} | ${requirement.id} | ${requirement.title} | ${requirement.minimumEvidenceScope} |`);
  const coverageRequirementIds = [
    "runtime-install", "task-submit", "streaming-output", "cancellation", "session-recovery",
    "file-artifact", "tool-events", "restart-recovery", "upgrade", "rollback", "backup-restore", "security", "real-e2e",
  ] as const;
  const coverageRows = reports.map((report) => {
    const status = (requirementId: typeof coverageRequirementIds[number]) => {
      if (report.declaredLevel === "spec-only") return "not certified";
      return report.requirements.find((requirement) => requirement.id === requirementId)?.status ?? "missing";
    };
    return `| ${report.runtimeType} | ${coverageRequirementIds.map(status).join(" | ")} | n/a* | ${report.publicationStatus} |`;
  });
  return [
    "# MyBay Runtime Certification",
    "",
    "<!-- Generated by scripts/runtime-certification.ts. Do not edit by hand. -->",
    "",
    `A declared certification level is a release target. A verified level is granted only by an evidence bundle that satisfies every requirement in that level and every lower level. Publication status also requires evidence for the current MyBay version (${packageVersion}). Contract tests and capability declarations are admission checks; they do not count as live Runtime or product E2E evidence.`,
    "",
    "## Current status",
    "",
    "| Runtime | Declared level | Verified level | Release identity | Artifact verification | Publication status | Verified platforms | Last verified | Evidence bundle |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...runtimeRows,
    "",
    "## Evidence-backed capability coverage",
    "",
    "A `passed` cell means retained evidence satisfied that certification requirement. It is not inferred from a capability declaration.",
    "",
    "| Runtime | Install | Run | Stream | Cancel | Session recovery | Files | Tools | Restart recovery | Upgrade | Rollback | Backup | Security | Real E2E | A2A | Status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...coverageRows,
    "",
    "Note: A2A is currently a Control Plane collaboration feature, not a field in the Runtime Driver capability contract or certification ladder. It is shown as `n/a` rather than inferred.",
    "",
    "## Certification ladder",
    "",
    "| Level | Requirement ID | Check | Minimum evidence scope |",
    "| --- | --- | --- | --- |",
    ...requirementRows,
    "",
    "Evidence bundles live at `certification/evidence/<runtime-type>.certification.json` and current bundles must validate against `public/schemas/mybay.runtime-certification-evidence.schema.json`. Schema v3 binds native version, explicit nullable bridge version, image reference, and an immutable OCI digest or Docker image ID. Legacy schema v2 evidence remains readable as metadata-compatible history but cannot produce an exact verified publication. Each bundle identifies the real platform and versions it covers, and every local evidence reference is resolved and protected by a retained SHA-256. Secrets and credentials must never be committed.",
    "",
    "Run `npm run runtime:certification` to validate and display the current report. Run `npm run runtime:certify` as the strict release gate; it fails while a Runtime's declared level is not fully verified.",
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

checkOrWrite("public/certification/runtime-certification.json", publicDocument());
checkOrWrite("docs/runtime-certification.md", certificationDocument());

function platformMatrixDocument(): string {
  const targets = [
    { platform: "windows", environment: "Docker Desktop", headless: false },
    { platform: "linux", environment: "Docker Engine", headless: false },
    { platform: "macos", environment: "Docker Desktop", headless: false },
    { platform: "linux", environment: "Docker Engine (headless server)", headless: true },
  ] as const;
  const rows = reports.flatMap((report) => targets.map((target) => {
    const matches = report.environments.filter((environment) => environment.platform === target.platform && environment.headless === target.headless);
    const status = report.declaredLevel === "spec-only" ? "Spec-only"
      : matches.length > 0 && report.publicationStatus === "verified" ? report.verifiedLevel
        : matches.length > 0 ? "Historical evidence only" : "Pending";
    const detail = matches.length > 0
      ? matches.map((environment) => `${environment.architecture ?? "architecture not retained"}; ${environment.containerEngineVersion ?? "Docker version not retained"}; MyBay ${environment.mybayVersion}; Runtime ${environment.runtimeVersion}`).join("<br>")
      : "No retained real-runtime evidence";
    return `| ${report.runtimeType} | ${target.platform} | ${target.environment} | ${status} | ${detail} |`;
  }));
  return [
    "# Runtime x Platform Certification Matrix",
    "",
    "<!-- Generated by scripts/runtime-certification.ts. Do not edit by hand. -->",
    "",
    "This matrix reports retained real-runtime certification evidence. It is deliberately separate from static launcher and build compatibility checks. A CI job running on an operating system is not Runtime certification unless it produces retained evidence that satisfies the certification requirements.",
    "",
    "| Runtime | Platform | Environment | Certification status | Retained environment detail |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "Static compatibility is checked on Ubuntu, Windows, and macOS by `.github/workflows/ci.yml`. Those checks validate launchers and contracts without claiming nested-Docker or credentialed product E2E certification.",
    "",
  ].join("\n");
}

checkOrWrite("docs/runtime-platform-matrix.md", platformMatrixDocument());

for (const report of reports) {
  console.log(`[runtime:certification] runtime=${report.runtimeType} declared=${report.declaredLevel} verified=${report.verifiedLevel} status=${report.publicationStatus}`);
  for (const detail of report.errors) {
    console.warn(`[runtime:certification:status] runtime=${report.runtimeType} ${detail}`);
  }
  if (strict && report.declaredLevel !== "spec-only" && report.publicationStatus !== "verified") {
    const detail = report.errors.length > 0 ? ` (${report.errors.join("; ")})` : "";
    errors.push(`${report.runtimeType}: declared ${report.declaredLevel} is not verified${detail}`);
  }
}
for (const error of errors) console.error(`[runtime:certification:error] ${error}`);
if (errors.length > 0) process.exitCode = 1;
