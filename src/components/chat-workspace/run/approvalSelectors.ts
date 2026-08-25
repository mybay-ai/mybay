import type { ChatApprovalRequest } from "../useChatRuns";

export function mergeApprovalEvent(requests: ChatApprovalRequest[], incoming: ChatApprovalRequest): ChatApprovalRequest[] {
  const normalized: ChatApprovalRequest = {
    ...incoming,
    status: incoming.status === "pending" ? "pending" : incoming.status === "expired" ? "expired" : "resolved",
    choices: Array.isArray(incoming.choices) && incoming.choices.length > 0 ? incoming.choices : ["once", "deny"]
  };
  const index = requests.findIndex(request => request.id === normalized.id);
  if (index < 0) return [normalized, ...requests].slice(0, 5);
  const current = requests[index];
  const status = current.status !== "pending" ? current.status : normalized.status;
  const updated = [...requests];
  updated[index] = { ...current, ...normalized, status };
  return updated;
}

export function settleApprovalRequests(requests: ChatApprovalRequest[], approvalId?: string, status: "resolved" | "expired" = "resolved", choice?: string): ChatApprovalRequest[] {
  return requests.map(request => (!approvalId || request.id === approvalId) && request.status === "pending"
    ? { ...request, status, choice: choice || request.choice }
    : request);
}

export function selectInlineApproval(requests: ChatApprovalRequest[]): ChatApprovalRequest | null {
  return requests.find(request => request.status === "pending") || requests[0] || null;
}
