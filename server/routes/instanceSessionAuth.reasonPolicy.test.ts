import { describe, expect, it } from "vitest";
import { getReasonScore, selectBestReason } from "./instanceSessionAuth";

describe("instance session readiness reason policy characterization", () => {
  it("keeps credential and session failures ahead of HTTP probe failures", () => {
    expect(getReasonScore("invalid_credentials")).toBe(1);
    expect(getReasonScore("probe_returned_401")).toBe(2);
    expect(getReasonScore("probe_returned_404")).toBe(3);
    expect(getReasonScore("status_not_ok_503")).toBe(3);
    expect(getReasonScore("invalid_json_response")).toBe(4);
    expect(getReasonScore("unknown")).toBe(5);
    expect(getReasonScore("")).toBe(6);
  });

  it("selects the first reason with the lowest score and preserves the empty fallback", () => {
    expect(selectBestReason(["status_not_ok_503", "invalid_credentials", "basic_auth_not_enabled"]))
      .toBe("invalid_credentials");
    expect(selectBestReason([])).toBe("no_url_tested");
  });
});

