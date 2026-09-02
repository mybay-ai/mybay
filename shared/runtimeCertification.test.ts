import { describe, expect, it } from "vitest";
import {
  evaluateRuntimeCertification,
  RUNTIME_CERTIFICATION_REQUIREMENTS,
  type RuntimeCertificationEvidenceBundle,
  type RuntimeCertificationEvidenceCheck,
} from "./runtimeCertification";
import { HERMES_RUNTIME_DEFINITION, PI_RUNTIME_DEFINITION } from "./runtimeCatalog";

const observedAt = "2026-09-02T00:00:00.000Z";
const now = Date.parse("2026-09-02T01:00:00.000Z");

function evidenceFor(level: "experimental" | "beta" | "certified"): RuntimeCertificationEvidenceBundle {
  const order = ["experimental", "beta", "certified"];
  const checks: RuntimeCertificationEvidenceCheck[] = RUNTIME_CERTIFICATION_REQUIREMENTS
    .filter((requirement) => order.indexOf(requirement.level) <= order.indexOf(level))
    .map((requirement) => ({
      requirementId: requirement.id,
      status: "passed",
      scope: requirement.minimumEvidenceScope,
      observedAt,
      environment: "isolated-test-runtime",
      evidenceRefs: [`artifacts/${requirement.id}.json`],
    }));
  return {
    schemaVersion: 1,
    runtime: {
      type: HERMES_RUNTIME_DEFINITION.runtime.type,
      providerKey: HERMES_RUNTIME_DEFINITION.providerKey,
      contractVersion: HERMES_RUNTIME_DEFINITION.contractVersion,
    },
    checks,
  };
}

describe("Runtime certification evaluator", () => {
  it("keeps an available Runtime unverified when no live evidence exists", () => {
    const report = evaluateRuntimeCertification(HERMES_RUNTIME_DEFINITION, undefined, { now });
    expect(report).toMatchObject({
      declaredLevel: "certified",
      verifiedLevel: "unverified",
      publicationStatus: "pending",
    });
    expect(report.requirements.every((requirement) => requirement.status === "missing")).toBe(true);
  });

  it("verifies the highest contiguous level backed by evidence", () => {
    const experimental = evaluateRuntimeCertification(HERMES_RUNTIME_DEFINITION, evidenceFor("experimental"), { now });
    const beta = evaluateRuntimeCertification(HERMES_RUNTIME_DEFINITION, evidenceFor("beta"), { now });
    const certified = evaluateRuntimeCertification(HERMES_RUNTIME_DEFINITION, evidenceFor("certified"), { now });
    expect(experimental).toMatchObject({ verifiedLevel: "experimental", publicationStatus: "pending" });
    expect(beta).toMatchObject({ verifiedLevel: "beta", publicationStatus: "pending" });
    expect(certified).toMatchObject({ verifiedLevel: "certified", publicationStatus: "verified" });
  });

  it("does not accept contract-only evidence for live Runtime requirements", () => {
    const bundle = evidenceFor("experimental");
    const checks = bundle.checks.map((check, index) => index === 0 ? { ...check, scope: "contract" as const } : check);
    const report = evaluateRuntimeCertification(HERMES_RUNTIME_DEFINITION, { ...bundle, checks }, { now });
    expect(report.publicationStatus).toBe("invalid");
    expect(report.requirements[0]).toMatchObject({ status: "invalid" });
  });

  it("rejects stale or mismatched evidence instead of silently rebinding it", () => {
    const bundle = evidenceFor("experimental");
    const checks = bundle.checks.map((check, index) => index === 0
      ? { ...check, validUntil: "2026-09-01T00:00:00.000Z" }
      : check);
    const report = evaluateRuntimeCertification(HERMES_RUNTIME_DEFINITION, {
      ...bundle,
      runtime: { ...bundle.runtime, providerKey: "other-provider" },
      checks,
    }, { now });
    expect(report.publicationStatus).toBe("invalid");
    expect(report.errors).toContain("Certification evidence Runtime Binding does not match the catalog.");
    expect(report.requirements[0]).toMatchObject({ status: "invalid" });
  });

  it("keeps specification-only Runtimes outside the executable certification ladder", () => {
    expect(evaluateRuntimeCertification(PI_RUNTIME_DEFINITION, undefined, { now })).toMatchObject({
      declaredLevel: "spec-only",
      verifiedLevel: "spec-only",
      publicationStatus: "spec-only",
      requirements: [],
    });
  });
});
