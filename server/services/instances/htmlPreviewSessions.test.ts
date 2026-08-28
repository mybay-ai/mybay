import { afterEach, describe, expect, it } from "vitest";
import {
  clearHtmlPreviewSessionsForTests,
  createHtmlPreviewSession,
  getAuthorizedHtmlPreviewSession,
  serializeHtmlPreviewCredentialCookie,
} from "./htmlPreviewSessions";

describe("HTML Preview session credentials", () => {
  afterEach(clearHtmlPreviewSessionsForTests);

  it("keeps the credential out of the public URL and authorizes by HttpOnly cookie", () => {
    const created = createHtmlPreviewSession({
      instanceId: "instance-1",
      ownerId: "owner-1",
      viewerRole: "admin",
      projectRoot: "outputs/project",
      assetAliases: {},
    });
    const cookie = serializeHtmlPreviewCredentialCookie(created.session, created.credentialSecret, true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain(`/html-preview-session/${created.session.publicId}/`);
    expect(created.session.publicId).not.toContain(created.credentialSecret);
    expect(getAuthorizedHtmlPreviewSession(created.session.publicId, cookie)).toMatchObject({ instanceId: "instance-1" });
    expect(getAuthorizedHtmlPreviewSession(created.session.publicId, cookie.replace(created.credentialSecret, "x".repeat(43)))).toBeNull();
  });
});
