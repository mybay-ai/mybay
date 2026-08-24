import type { SetupFormData } from "../../types";
import { sanitizeDeployPayload } from "./sanitizeDeployPayload";

export const LOCAL_INSTANCE_CREATE_PATH = "/api/instances";

export type LocalDeploymentRequestBody = Partial<SetupFormData> & {
  confirmed_skill_ids: string[];
};

export type LocalDeploymentRequest = {
  path: typeof LOCAL_INSTANCE_CREATE_PATH;
  body: LocalDeploymentRequestBody;
  options: {
    headers: {
      "Idempotency-Key": string;
    };
  };
};

export type LocalDeploymentRequestInput = {
  draft: Partial<SetupFormData>;
  idempotencyKey: string;
  permissionConfirmed: boolean;
};

export function buildLocalDeploymentRequest(input: LocalDeploymentRequestInput): LocalDeploymentRequest {
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  }
  if (!input.permissionConfirmed) {
    throw new Error("LOCAL_DEPLOY_PERMISSION_CONFIRMATION_REQUIRED");
  }

  const sanitized = sanitizeDeployPayload(input.draft);
  const confirmedSkillIds = Array.isArray(sanitized.skills) ? [...sanitized.skills] : [];
  return {
    path: LOCAL_INSTANCE_CREATE_PATH,
    body: {
      ...sanitized,
      ...(Array.isArray(sanitized.skills) ? { skills: [...confirmedSkillIds] } : {}),
      confirmed_skill_ids: confirmedSkillIds,
    },
    options: {
      headers: { "Idempotency-Key": idempotencyKey },
    },
  };
}
