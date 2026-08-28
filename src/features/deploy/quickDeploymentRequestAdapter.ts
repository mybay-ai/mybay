import { buildLocalDeploymentRequest, type LocalDeploymentRequest } from "./localDeploymentRequestAdapter";
import { buildQuickDeployAdvancedInitialData } from "./quickDeployAdvancedHandoff";
import type { QuickDeployDraft } from "./quickDeployTypes";
import { QuickDeployValidationError } from "./quickDeployTypes";
import { validateQuickDeployDraft } from "./quickDeployValidation";

export interface QuickDeploymentRequestInput {
  draft: QuickDeployDraft;
  path: string;
  idempotencyKey: string;
}

export function buildQuickDeploymentRequest(input: QuickDeploymentRequestInput): LocalDeploymentRequest {
  const issues = validateQuickDeployDraft(input.draft);
  if (issues.length > 0) throw new QuickDeployValidationError(issues);

  return buildLocalDeploymentRequest({
    draft: buildQuickDeployAdvancedInitialData(input.draft, input.path),
    idempotencyKey: input.idempotencyKey,
    permissionConfirmed: input.draft.permissionConfirmed,
  });
}
