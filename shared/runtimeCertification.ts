import type {
  RuntimeCertificationLevel,
  RuntimeDefinition,
} from "./runtimeCatalog";

export type VerifiableRuntimeCertificationLevel = Exclude<RuntimeCertificationLevel, "spec-only">;
export type RuntimeCertificationEvidenceScope = "contract" | "runtime" | "e2e";
export type RuntimeCertificationCheckStatus = "passed" | "failed";
export type RuntimeCertificationRequirementStatus = "passed" | "failed" | "missing" | "invalid";
export type RuntimeVerifiedCertificationLevel = RuntimeCertificationLevel | "unverified";

export type RuntimeCertificationRequirementId =
  | "runtime-install"
  | "task-submit"
  | "streaming-output"
  | "cancellation"
  | "session-recovery"
  | "file-artifact"
  | "usage-reporting"
  | "tool-events"
  | "restart-recovery"
  | "control-plane-deploy"
  | "upgrade"
  | "rollback"
  | "security"
  | "backup-restore"
  | "real-e2e";

export interface RuntimeCertificationRequirement {
  readonly id: RuntimeCertificationRequirementId;
  readonly level: VerifiableRuntimeCertificationLevel;
  readonly title: string;
  readonly description: string;
  readonly minimumEvidenceScope: Exclude<RuntimeCertificationEvidenceScope, "contract">;
}

export interface RuntimeCertificationEvidenceCheck {
  readonly requirementId: RuntimeCertificationRequirementId;
  readonly status: RuntimeCertificationCheckStatus;
  readonly scope: RuntimeCertificationEvidenceScope;
  readonly observedAt: string;
  readonly validUntil?: string;
  readonly environment: string;
  readonly command?: string;
  readonly evidenceRefs: readonly string[];
  readonly note?: string;
}

export interface RuntimeCertificationEvidenceBundle {
  readonly schemaVersion: 1;
  readonly runtime: {
    readonly type: string;
    readonly providerKey: string;
    readonly contractVersion: number;
  };
  readonly checks: readonly RuntimeCertificationEvidenceCheck[];
}

export interface RuntimeCertificationRequirementResult extends RuntimeCertificationRequirement {
  readonly status: RuntimeCertificationRequirementStatus;
  readonly detail: string;
  readonly evidence?: RuntimeCertificationEvidenceCheck;
}

export interface RuntimeCertificationReport {
  readonly runtimeType: string;
  readonly providerKey: string;
  readonly contractVersion: number;
  readonly declaredLevel: RuntimeCertificationLevel;
  readonly verifiedLevel: RuntimeVerifiedCertificationLevel;
  readonly publicationStatus: "spec-only" | "verified" | "pending" | "invalid";
  readonly requirements: readonly RuntimeCertificationRequirementResult[];
  readonly errors: readonly string[];
}

const LEVEL_ORDER: readonly VerifiableRuntimeCertificationLevel[] = Object.freeze([
  "experimental",
  "beta",
  "certified",
]);

const runtimeCertificationRequirements = [
  {
    id: "runtime-install",
    level: "experimental",
    title: "Runtime installation",
    description: "Install or initialize the Runtime in a real Runtime environment.",
    minimumEvidenceScope: "runtime",
  },
  {
    id: "task-submit",
    level: "experimental",
    title: "Task submission",
    description: "Submit a real task and receive a Runtime-owned run identifier.",
    minimumEvidenceScope: "runtime",
  },
  {
    id: "streaming-output",
    level: "experimental",
    title: "Streaming output",
    description: "Observe non-empty incremental output from a real Runtime run.",
    minimumEvidenceScope: "runtime",
  },
  {
    id: "cancellation",
    level: "experimental",
    title: "Cancellation",
    description: "Stop an active Runtime run and observe a terminal cancelled state.",
    minimumEvidenceScope: "runtime",
  },
  {
    id: "session-recovery",
    level: "beta",
    title: "Session recovery",
    description: "Resume a persisted native session without losing conversation continuity.",
    minimumEvidenceScope: "runtime",
  },
  {
    id: "file-artifact",
    level: "beta",
    title: "File artifact",
    description: "Create, persist, and retrieve a file artifact produced by the Runtime.",
    minimumEvidenceScope: "runtime",
  },
  {
    id: "usage-reporting",
    level: "beta",
    title: "Usage reporting",
    description: "Persist attributable usage evidence for a completed Runtime run.",
    minimumEvidenceScope: "runtime",
  },
  {
    id: "tool-events",
    level: "beta",
    title: "Tool events",
    description: "Observe tool lifecycle events with stable identifiers and terminal outcomes.",
    minimumEvidenceScope: "runtime",
  },
  {
    id: "restart-recovery",
    level: "beta",
    title: "Restart recovery",
    description: "Recover persisted Runtime state after a controlled process restart.",
    minimumEvidenceScope: "runtime",
  },
  {
    id: "control-plane-deploy",
    level: "certified",
    title: "Control-plane deployment",
    description: "Deploy through the supported MyBay product path and pass health checks.",
    minimumEvidenceScope: "e2e",
  },
  {
    id: "upgrade",
    level: "certified",
    title: "Upgrade",
    description: "Upgrade a deployed Runtime while preserving supported state.",
    minimumEvidenceScope: "e2e",
  },
  {
    id: "rollback",
    level: "certified",
    title: "Rollback",
    description: "Roll back a failed or incompatible upgrade and restore service.",
    minimumEvidenceScope: "e2e",
  },
  {
    id: "security",
    level: "certified",
    title: "Security controls",
    description: "Verify authentication, isolation, secret handling, and privileged capability guards.",
    minimumEvidenceScope: "e2e",
  },
  {
    id: "backup-restore",
    level: "certified",
    title: "Backup and restore",
    description: "Restore a supported backup and verify Runtime data through the product path.",
    minimumEvidenceScope: "e2e",
  },
  {
    id: "real-e2e",
    level: "certified",
    title: "Real end-to-end acceptance",
    description: "Complete a credentialed browser-to-Runtime task on a supported target platform.",
    minimumEvidenceScope: "e2e",
  },
] satisfies RuntimeCertificationRequirement[];

export const RUNTIME_CERTIFICATION_REQUIREMENTS: readonly RuntimeCertificationRequirement[] = Object.freeze(
  runtimeCertificationRequirements.map((requirement) => Object.freeze(requirement)),
);

const REQUIREMENT_IDS = new Set(RUNTIME_CERTIFICATION_REQUIREMENTS.map(({ id }) => id));
const SCOPE_RANK: Readonly<Record<RuntimeCertificationEvidenceScope, number>> = Object.freeze({
  contract: 0,
  runtime: 1,
  e2e: 2,
});

function isValidTimestamp(value: string): boolean {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function requirementResult(
  requirement: RuntimeCertificationRequirement,
  evidence: RuntimeCertificationEvidenceCheck | undefined,
  now: number,
): RuntimeCertificationRequirementResult {
  if (!evidence) {
    return Object.freeze({ ...requirement, status: "missing", detail: "No evidence was supplied." });
  }
  if (evidence.requirementId !== requirement.id || !REQUIREMENT_IDS.has(evidence.requirementId)) {
    return Object.freeze({ ...requirement, status: "invalid", detail: "Evidence requirement id is invalid.", evidence });
  }
  if (!isValidTimestamp(evidence.observedAt)) {
    return Object.freeze({ ...requirement, status: "invalid", detail: "Evidence observedAt is not a valid timestamp.", evidence });
  }
  if (evidence.validUntil !== undefined && (!isValidTimestamp(evidence.validUntil) || Date.parse(evidence.validUntil) < now)) {
    return Object.freeze({ ...requirement, status: "invalid", detail: "Evidence is expired or validUntil is invalid.", evidence });
  }
  if (!evidence.environment?.trim()) {
    return Object.freeze({ ...requirement, status: "invalid", detail: "Evidence environment is required.", evidence });
  }
  if (!Array.isArray(evidence.evidenceRefs) || evidence.evidenceRefs.length === 0 || evidence.evidenceRefs.some((ref) => !ref.trim())) {
    return Object.freeze({ ...requirement, status: "invalid", detail: "At least one non-empty evidence reference is required.", evidence });
  }
  if (!(evidence.scope in SCOPE_RANK) || SCOPE_RANK[evidence.scope] < SCOPE_RANK[requirement.minimumEvidenceScope]) {
    return Object.freeze({
      ...requirement,
      status: "invalid",
      detail: `${evidence.scope} evidence cannot satisfy a ${requirement.minimumEvidenceScope} requirement.`,
      evidence,
    });
  }
  if (evidence.status === "failed") {
    return Object.freeze({ ...requirement, status: "failed", detail: "The recorded check failed.", evidence });
  }
  if (evidence.status !== "passed") {
    return Object.freeze({ ...requirement, status: "invalid", detail: "Evidence status is invalid.", evidence });
  }
  return Object.freeze({ ...requirement, status: "passed", detail: "Evidence satisfies this requirement.", evidence });
}

function verifiedLevel(results: readonly RuntimeCertificationRequirementResult[]): RuntimeVerifiedCertificationLevel {
  let verified: RuntimeVerifiedCertificationLevel = "unverified";
  for (const level of LEVEL_ORDER) {
    const required = results.filter((result) => LEVEL_ORDER.indexOf(result.level) <= LEVEL_ORDER.indexOf(level));
    if (!required.every((result) => result.status === "passed")) break;
    verified = level;
  }
  return verified;
}

function levelRank(level: RuntimeCertificationLevel | "unverified"): number {
  if (level === "spec-only") return -1;
  if (level === "unverified") return 0;
  return LEVEL_ORDER.indexOf(level) + 1;
}

export function evaluateRuntimeCertification(
  definition: RuntimeDefinition,
  bundle?: RuntimeCertificationEvidenceBundle,
  options: { readonly now?: number } = {},
): RuntimeCertificationReport {
  const errors: string[] = [];
  const declaredLevel = definition.release.certificationLevel;

  if (declaredLevel === "spec-only") {
    if (bundle) errors.push("Spec-only Runtimes cannot publish certification evidence.");
    return Object.freeze({
      runtimeType: definition.runtime.type,
      providerKey: definition.providerKey,
      contractVersion: definition.contractVersion,
      declaredLevel,
      verifiedLevel: "spec-only",
      publicationStatus: errors.length > 0 ? "invalid" : "spec-only",
      requirements: Object.freeze([]),
      errors: Object.freeze(errors),
    });
  }

  if (bundle) {
    if (bundle.schemaVersion !== 1) errors.push("Certification evidence schemaVersion must be 1.");
    if (bundle.runtime.type !== definition.runtime.type
      || bundle.runtime.providerKey !== definition.providerKey
      || bundle.runtime.contractVersion !== definition.contractVersion) {
      errors.push("Certification evidence Runtime Binding does not match the catalog.");
    }
  }

  const evidenceByRequirement = new Map<RuntimeCertificationRequirementId, RuntimeCertificationEvidenceCheck>();
  for (const evidence of bundle?.checks ?? []) {
    if (!REQUIREMENT_IDS.has(evidence.requirementId)) {
      errors.push(`Certification evidence requirement is unknown: ${String(evidence.requirementId)}`);
      continue;
    }
    if (evidenceByRequirement.has(evidence.requirementId)) {
      errors.push(`Certification evidence check is duplicated: ${evidence.requirementId}`);
      continue;
    }
    evidenceByRequirement.set(evidence.requirementId, evidence);
  }

  const now = options.now ?? Date.now();
  const requirements = Object.freeze(RUNTIME_CERTIFICATION_REQUIREMENTS.map((requirement) =>
    requirementResult(requirement, evidenceByRequirement.get(requirement.id), now)));
  const verified = verifiedLevel(requirements);
  const hasInvalidRequirement = requirements.some((requirement) => requirement.status === "invalid");
  const publicationStatus = errors.length > 0 || hasInvalidRequirement
    ? "invalid"
    : levelRank(verified) >= levelRank(declaredLevel)
      ? "verified"
      : "pending";

  return Object.freeze({
    runtimeType: definition.runtime.type,
    providerKey: definition.providerKey,
    contractVersion: definition.contractVersion,
    declaredLevel,
    verifiedLevel: verified,
    publicationStatus,
    requirements,
    errors: Object.freeze(errors),
  });
}
