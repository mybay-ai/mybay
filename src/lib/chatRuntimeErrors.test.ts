import { describe, expect, it } from "vitest";
import { humanizeChatError } from "./chatRuntimeErrors";

describe("chatRuntimeErrors", () => {
  it("maps runtime codes to user-friendly messages", () => {
    const result = humanizeChatError({ data: { error: "INSTANCE_OFFLINE", message: "container exited" }, status: 503 });
    expect(result.code).toBe("INSTANCE_OFFLINE");
    expect(result.message).toContain("离线");
    expect(result.technicalMessage).toBe("container exited");
  });

  it("infers timeout and network failures", () => {
    expect(humanizeChatError({ data: { error: "REMOTE_TIMEOUT" } }).message).toContain("超时");
    expect(humanizeChatError(new Error("Failed to fetch")).message).toContain("网络连接失败");
  });

  it("preserves structured backend messages instead of replacing them with Bad Request", () => {
    const result = humanizeChatError({
      status: 400,
      data: {
        code: "CREDENTIAL_DECRYPT_FAILED",
        error: "The saved credential cannot be decrypted. Save its API Key again.",
      },
    }, "Bad Request");
    expect(result.code).toBe("CREDENTIAL_DECRYPT_FAILED");
    expect(result.message).toBe("The saved credential cannot be decrypted. Save its API Key again.");
  });

  it.each([
    "INSTANCE_NOT_RUNNING",
    "INTERNAL_ROUTE_CONNECT_FAILED",
    "HERMES_API_NOT_READY",
    "HERMES_SESSION_CREATE_FAILED",
    "HERMES_SESSION_REBIND_FAILED",
  ])("maps local chat readiness and session error %s", (code) => {
    expect(humanizeChatError({ data: { error: code } })).toMatchObject({ code, known: true });
  });
  it("keeps a safe fallback for unknown errors", () => {
    const result = humanizeChatError({ data: { error: "SOME_NEW_ERROR" } }, "自定义失败提示");
    expect(result.message).toBe("自定义失败提示");
    expect(result.known).toBe(false);
  });
});
