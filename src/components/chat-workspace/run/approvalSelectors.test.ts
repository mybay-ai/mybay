import { describe, expect, it } from "vitest";
import type { ChatApprovalRequest } from "../useChatRuns";
import { selectInlineApproval } from "./approvalSelectors";

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
});
