import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const instanceId = "preview-security-test-instance";
const ownerId = "preview-owner";
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-preview-security-"));
const dbMocks = vi.hoisted(() => ({
  getInstanceById: vi.fn(),
  updateInstanceVersionInfo: vi.fn(async () => undefined),
}));

vi.mock("../../db", () => ({
  dbAdapter: dbMocks,
}));
vi.mock("../../routes/instances/index", () => ({ docker: {} }));
vi.mock("../../deploymentContext", () => ({ getValidatedContainer: vi.fn() }));

import { validateFileAccess } from "./instanceFileSecurityService";

const requestFor = (userId: string) => ({ user: { id: userId, role: "user" } }) as any;

describe("instance file preview path isolation", () => {
  beforeAll(() => {
    dbMocks.getInstanceById.mockResolvedValue({ id: instanceId, user_id: ownerId, data_volume_path: testRoot });
    fs.mkdirSync(path.join(testRoot, "outputs"), { recursive: true });
    fs.writeFileSync(path.join(testRoot, "outputs", "report.html"), "<h1>Report</h1>");
    fs.writeFileSync(path.join(testRoot, ".env"), "SECRET=value");
  });

  afterAll(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("allows the owner to resolve a normal file inside the instance root", async () => {
    const result = await validateFileAccess(requestFor(ownerId), instanceId, "outputs/report.html");
    expect(result).not.toHaveProperty("error");
    expect((result as any).absolutePath).toBe(fs.realpathSync(path.join(testRoot, "outputs", "report.html")));
  });

  it("rejects other users, traversal attempts, and sensitive files", async () => {
    await expect(validateFileAccess(requestFor("another-user"), instanceId, "outputs/report.html"))
      .resolves.toMatchObject({ status: 403 });
    await expect(validateFileAccess(requestFor(ownerId), instanceId, "../outside.html"))
      .resolves.toMatchObject({ status: 403 });
    await expect(validateFileAccess(requestFor(ownerId), instanceId, ".env"))
      .resolves.toMatchObject({ status: 403 });
  });
});
