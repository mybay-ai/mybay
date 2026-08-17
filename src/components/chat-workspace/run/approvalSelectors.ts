import type { ChatApprovalRequest } from "../useChatRuns";

export function selectInlineApproval(requests: ChatApprovalRequest[]): ChatApprovalRequest | null {
  return requests.find(request => request.status === "pending") || requests[0] || null;
}
