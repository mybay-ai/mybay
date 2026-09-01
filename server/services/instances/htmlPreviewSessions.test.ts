import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearHtmlPreviewSessionsForTests,
  createHtmlPreviewSession,
  getAuthorizedHtmlPreviewSession,
  serializeHtmlPreviewCredentialCookie,
  serializeHtmlPreviewCredentialCookies,
  isAuthorizedHtmlPreviewAssetRequest,
} from "./htmlPreviewSessions";

describe("HTML Preview session credentials", () => {
  afterEach(() => { clearHtmlPreviewSessionsForTests(); vi.restoreAllMocks(); });

  it("keeps the credential out of the public URL and authorizes by HttpOnly cookie", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    const created = createHtmlPreviewSession({
      instanceId: "instance-1",
      ownerId: "owner-1",
      viewerRole: "admin",
      projectRoot: "outputs/project",
      assetAliases: {},
    });
    const cookie = serializeHtmlPreviewCredentialCookie(created.session, created.credentialSecret, true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain(`/html-preview-session/${created.session.publicId}/`);
    expect(created.session.publicId).not.toContain(created.credentialSecret);
    expect(getAuthorizedHtmlPreviewSession(created.session.publicId, cookie)).toMatchObject({ instanceId: "instance-1" });
    expect(getAuthorizedHtmlPreviewSession(created.session.publicId, cookie.replace(created.credentialSecret, "x".repeat(43)))).toBeNull();
    const cookies = serializeHtmlPreviewCredentialCookies(created.session, created.credentialSecret, true);
    expect(cookies).toEqual([cookie, cookie + "; Partitioned"]);
    const plainHttp = serializeHtmlPreviewCredentialCookies(created.session, created.credentialSecret, false);
    expect(plainHttp).toHaveLength(1);
    expect(plainHttp[0]).toContain("SameSite=Strict");
    expect(plainHttp[0]).not.toContain("Secure");
  });

  it("limits preview-only authentication to GET assets in the credential's instance and session", () => {
    const { session, credentialSecret } = createHtmlPreviewSession({instanceId: "instance-1", ownerId: "owner-1", viewerRole: "admin", projectRoot: "outputs/project"});
    const cookie = serializeHtmlPreviewCredentialCookie(session, credentialSecret, true);
    const asset = `/instance-1/files/html-preview-session/${session.publicId}/style.css`;
    expect(isAuthorizedHtmlPreviewAssetRequest("GET", asset, cookie)).toBe(true);
    expect(isAuthorizedHtmlPreviewAssetRequest("GET", asset)).toBe(false);
    expect(isAuthorizedHtmlPreviewAssetRequest("GET", asset, cookie.replace(credentialSecret, "x".repeat(43)))).toBe(false);
    expect(isAuthorizedHtmlPreviewAssetRequest("GET", asset.replace("instance-1", "instance-2"), cookie)).toBe(false);
    for (const method of ["POST", "DELETE", "PATCH", "HEAD"]) expect(isAuthorizedHtmlPreviewAssetRequest(method, asset, cookie)).toBe(false);
    for (const other of ["/instance-1", "/instance-1/files", "/instance-1/files/download", "/instance-1/files/html-preview", "/instance-1/lifecycle"]) expect(isAuthorizedHtmlPreviewAssetRequest("GET", other, cookie)).toBe(false);
    session.expiresAt = Date.now() - 1;
    expect(isAuthorizedHtmlPreviewAssetRequest("GET", asset, cookie)).toBe(false);
  });
});
