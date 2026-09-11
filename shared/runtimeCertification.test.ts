import { describe, expect, it } from "vitest";
import {
  evaluateRuntimeCertification,
  RUNTIME_CERTIFICATION_REQUIREMENTS,
  type LegacyRuntimeCertificationEvidenceBundle,
  type RuntimeCertificationEvidenceBundle,
  type RuntimeCertificationEvidenceCheck,
} from "./runtimeCertification";
import { HERMES_RUNTIME_DEFINITION, PI_RUNTIME_DEFINITION, type RuntimeDefinition } from "./runtimeCatalog";

const observedAt = "2026-09-02T00:00:00.000Z";
const now = Date.parse("2026-09-02T01:00:00.000Z");
const imageDigest = `sha256:${"b".repeat(64)}`;
const exactHermesDefinition: RuntimeDefinition = {
  ...HERMES_RUNTIME_DEFINITION,
  release: {
    ...HERMES_RUNTIME_DEFINITION.release,
    artifactIdentity: { kind: "oci-digest", value: imageDigest },
  },
};

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
    schemaVersion: 3,
    runtime: {
      type: HERMES_RUNTIME_DEFINITION.runtime.type,
      providerKey: HERMES_RUNTIME_DEFINITION.providerKey,
      contractVersion: HERMES_RUNTIME_DEFINITION.contractVersion,
      nativeVersion: HERMES_RUNTIME_DEFINITION.version,
      bridgeVersion: HERMES_RUNTIME_DEFINITION.release.bridgeVersion,
      imageRef: `${HERMES_RUNTIME_DEFINITION.runtime.image}:${HERMES_RUNTIME_DEFINITION.runtime.tag}`,
      artifactIdentity: { kind: "oci-digest", value: imageDigest },
    },
    environments: [{
      id: "test-runtime",
      platform: "linux",
      platformVersion: null,
      architecture: "amd64",
      containerEngine: "docker-engine",
      containerEngineVersion: null,
      runtimeVersion: "test",
      mybayVersion: "test",
      headless: true,
    }],
    artifacts: [{ path: "artifacts/evidence.json", sha256: "a".repeat(64) }],
    checks,
  };
}

function legacyEvidenceFor(level: "experimental" | "beta" | "certified"): LegacyRuntimeCertificationEvidenceBundle {
  const current = evidenceFor(level);
  return {
    ...current,
    schemaVersion: 2,
    runtime: {
      type: current.runtime.type,
      providerKey: current.runtime.providerKey,
      contractVersion: current.runtime.contractVersion,
      version: current.runtime.nativeVersion,
      imageRef: current.runtime.imageRef,
    },
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
    const experimental = evaluateRuntimeCertification(exactHermesDefinition, evidenceFor("experimental"), { now });
    const beta = evaluateRuntimeCertification(exactHermesDefinition, evidenceFor("beta"), { now });
    const certified = evaluateRuntimeCertification(exactHermesDefinition, evidenceFor("certified"), { now });
    expect(experimental).toMatchObject({ verifiedLevel: "experimental", publicationStatus: "pending" });
    expect(beta).toMatchObject({ verifiedLevel: "beta", publicationStatus: "pending" });
    expect(certified).toMatchObject({ verifiedLevel: "certified", publicationStatus: "verified" });
  });

  it("does not accept contract-only evidence for live Runtime requirements", () => {
    const bundle = evidenceFor("experimental");
    const checks = bundle.checks.map((check, index) => index === 0 ? { ...check, scope: "contract" as const } : check);
    const report = evaluateRuntimeCertification(exactHermesDefinition, { ...bundle, checks }, { now });
    expect(report.publicationStatus).toBe("invalid");
    expect(report.requirements[0]).toMatchObject({ status: "invalid" });
  });

  it("rejects executable certification without structured environments or retained artifact hashes", () => {
    const bundle = evidenceFor("certified");
    const report = evaluateRuntimeCertification(exactHermesDefinition, {
      ...bundle,
      environments: [],
      artifacts: [],
    }, { now });
    expect(report.publicationStatus).toBe("invalid");
    expect(report.errors).toEqual(expect.arrayContaining([
      "Certification evidence must identify at least one structured environment.",
      "Certification evidence must include retained artifact hashes.",
    ]));
  });

  it("does not use an older MyBay certification bundle to release a newer version", () => {
    const report = evaluateRuntimeCertification(exactHermesDefinition, evidenceFor("certified"), {
      now,
      expectedMybayVersion: "next-version",
    });
    expect(report.publicationStatus).toBe("invalid");
    expect(report.errors).toContain("Certification evidence does not cover MyBay next-version.");
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
    expect(report.errors).toContain("Certification evidence does not match current runtime release identity.");
    expect(report.requirements[0]).toMatchObject({ status: "missing" });
  });

  it("keeps a Certified Runtime pending until live evidence is supplied", () => {
    expect(evaluateRuntimeCertification(PI_RUNTIME_DEFINITION, undefined, { now })).toMatchObject({
      declaredLevel: "certified",
      verifiedLevel: "unverified",
      publicationStatus: "pending",
    });
  });

  it("rejects evidence captured for a different Runtime version or image", () => {
    const bundle = evidenceFor("certified");
    const versionMismatch = evaluateRuntimeCertification(HERMES_RUNTIME_DEFINITION, {
      ...bundle,
      runtime: { ...bundle.runtime, nativeVersion: "older-version" },
    }, { now });
    const imageMismatch = evaluateRuntimeCertification(HERMES_RUNTIME_DEFINITION, {
      ...bundle,
      runtime: { ...bundle.runtime, imageRef: "example.invalid/runtime:other" },
    }, { now });

    expect(versionMismatch).toMatchObject({ verifiedLevel: "unverified", publicationStatus: "invalid" });
    expect(imageMismatch).toMatchObject({ verifiedLevel: "unverified", publicationStatus: "invalid" });
    expect(versionMismatch.errors).toContain("Certification evidence does not match current runtime release identity.");
    expect(imageMismatch.errors).toContain("Certification evidence does not match current runtime release identity.");
  });

  it("keeps legacy schema v2 evidence metadata-compatible but not exactly verified", () => {
    expect(evaluateRuntimeCertification(exactHermesDefinition, legacyEvidenceFor("certified"), { now })).toMatchObject({
      verifiedLevel: "certified",
      identityStatus: "metadata-compatible",
      artifactVerification: "pending",
      publicationStatus: "pending",
    });
  });

  it("rejects a bridge revision different from the release metadata", () => {
    const definition: RuntimeDefinition = {
      ...exactHermesDefinition,
      release: { ...exactHermesDefinition.release, bridgeVersion: "bridge-2" },
    };
    const bundle = evidenceFor("certified");
    const report = evaluateRuntimeCertification(definition, {
      ...bundle,
      runtime: { ...bundle.runtime, bridgeVersion: "bridge-1" },
    }, { now });
    expect(report).toMatchObject({ identityStatus: "mismatch", publicationStatus: "invalid" });
  });

  it("rejects an immutable image digest different from the release metadata", () => {
    const bundle = evidenceFor("certified");
    const report = evaluateRuntimeCertification(exactHermesDefinition, {
      ...bundle,
      runtime: {
        ...bundle.runtime,
        artifactIdentity: { kind: "oci-digest", value: `sha256:${"c".repeat(64)}` },
      },
    }, { now });
    expect(report).toMatchObject({ identityStatus: "mismatch", publicationStatus: "invalid" });
  });

  it("rejects a malformed immutable artifact identity", () => {
    const bundle = evidenceFor("certified");
    const report = evaluateRuntimeCertification(exactHermesDefinition, {
      ...bundle,
      runtime: {
        ...bundle.runtime,
        artifactIdentity: { kind: "oci-digest", value: "sha256:not-a-digest" },
      },
    }, { now });
    expect(report).toMatchObject({ identityStatus: "mismatch", publicationStatus: "invalid" });
  });

  it("does not exactly verify a compatible local build without immutable identity", () => {
    const bundle = evidenceFor("certified");
    const definition: RuntimeDefinition = {
      ...HERMES_RUNTIME_DEFINITION,
      release: { ...HERMES_RUNTIME_DEFINITION.release, artifactIdentity: null },
    };
    const report = evaluateRuntimeCertification(definition, {
      ...bundle,
      runtime: { ...bundle.runtime, artifactIdentity: null },
    }, { now });
    expect(report).toMatchObject({
      verifiedLevel: "certified",
      identityStatus: "metadata-compatible",
      artifactVerification: "pending",
      publicationStatus: "pending",
    });
  });

  it("can exactly bind host-local certification to a Docker image id", () => {
    const localImageId = `sha256:${"d".repeat(64)}`;
    const definition: RuntimeDefinition = {
      ...HERMES_RUNTIME_DEFINITION,
      release: {
        ...HERMES_RUNTIME_DEFINITION.release,
        artifactIdentity: { kind: "docker-image-id", value: localImageId },
      },
    };
    const bundle = evidenceFor("certified");
    const report = evaluateRuntimeCertification(definition, {
      ...bundle,
      runtime: { ...bundle.runtime, artifactIdentity: { kind: "docker-image-id", value: localImageId } },
    }, { now });
    expect(report).toMatchObject({
      identityStatus: "exact",
      artifactVerification: "docker-image-id",
      publicationStatus: "verified",
    });
  });
});
