import { usageModel } from "./localRunUsage";

export interface LocalModelEvidence {
  version: 1;
  model: string;
  source: "configured_snapshot";
}

export function createConfiguredModelEvidence(model: unknown): LocalModelEvidence | null {
  const safeModel = usageModel(model);
  return safeModel ? { version: 1, model: safeModel, source: "configured_snapshot" } : null;
}

export function readLocalModelEvidence(value: unknown): LocalModelEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || candidate.source !== "configured_snapshot") return null;
  return createConfiguredModelEvidence(candidate.model);
}
