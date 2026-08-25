import { describe, expect, it } from "vitest";
import type { ChatApprovalRequest } from "../useChatRuns";
import { mergeApprovalEvent, selectInlineApproval, settleApprovalRequests } from "./approvalSelectors";

describe("selectInlineApproval", () => {
  it("prioritizes a pending request over a newer resolved item", () => {
    const requests: ChatApprovalRequest[] = [
      { id: "resolved", status: "resolved", choices: ["once"] },
      { id: "pending", status: "pending", choices: ["once", "deny"] }
    ];
    expect(selectInlineApproval(requests)?.id).toBe("pending");
  });

  it("uses the latest resolved request when nothing is pending", () => {
    const requests: ChatApprovalRequest[] = [
      { id: "latest", status: "resolved", choices: ["once"] },
      { id: "older", status: "resolved", choices: ["deny"] }
    ];
    expect(selectInlineApproval(requests)?.id).toBe("latest");
    expect(selectInlineApproval([])).toBeNull();
  });

  it("does not reopen a resolved approval when a late pending event arrives", () => {
    const resolved: ChatApprovalRequest[] = [{ id: "approval-1", status: "resolved", choices: ["once"], choice: "once" }];
    expect(mergeApprovalEvent(resolved, { id: "approval-1", status: "pending", choices: ["once", "deny"] })[0]).toMatchObject({ status: "resolved", choice: "once" });
  });

  it("keeps the first settled approval outcome stable", () => {
    const expired: ChatApprovalRequest[] = [{ id: "approval-1", status: "expired", choices: ["deny"] }];
    expect(mergeApprovalEvent(expired, { id: "approval-1", status: "resolved", choices: ["once"] })[0]?.status).toBe("expired");
  });

  it("expires pending approvals when their run reaches a terminal state", () => {
    const requests: ChatApprovalRequest[] = [{ id: "approval-1", status: "pending", choices: ["deny"] }];
    expect(settleApprovalRequests(requests, undefined, "expired")[0]?.status).toBe("expired");
  });
});
