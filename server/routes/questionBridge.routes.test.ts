import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createQuestionBridgeRouter } from "./questionBridge.routes";
import { bridgeCredentialPath, authenticateQuestionBridge } from "../services/runs/questionBridgeCredentials";
import { mutateStoreCollections } from "../localStore";

describe("instance scoped question bridge", () => {
  it("authenticates before parsing, isolates credentials and bounds JSON", async () => {
    const token = "a".repeat(64);
    const file = bridgeCredentialPath("instance");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ enabled: true, tokenHash: createHash("sha256").update(token).digest("hex") }));
    expect(authenticateQuestionBridge("instance", `Bearer ${token}`)).toBe(true);
    expect(authenticateQuestionBridge("another", `Bearer ${token}`)).toBe(false);
    expect(authenticateQuestionBridge("instance", `Bearer ${"b".repeat(64)}`)).toBe(false);
    expect(authenticateQuestionBridge("../instance", `Bearer ${token}`)).toBe(false);
    mutateStoreCollections(["chatRuns", "conversations"], data => {
      data.chatRuns = [{ id: "run", instance_id: "instance", user_id: "owner", conversation_id: "conversation", upstream_run_id: "native", runtime_type: "hermes", status: "running" }];
      data.conversations = [{ id: "conversation", instance_id: "instance", user_id: "owner", session_id: "session" }];
    });
    const app = express(); app.use("/internal/questions", createQuestionBridgeRouter());
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once("listening", resolve));
      const url = `http://127.0.0.1:${(server.address() as any).port}/internal/questions/instance`;
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      expect((await fetch(url, { method: "POST", body: "{", headers: { "content-type": "application/json" } })).status).toBe(401);
      expect((await fetch(url, { method: "POST", body: JSON.stringify({ large: "x".repeat(20000) }), headers })).status).toBe(413);
      const payload = { nativeRunId: "native", sessionId: "session", id: "question", spec: { title: "Choose", options: [{ id: "a", label: "A" }], multiple: false, allowCustom: false } };
      const response = await fetch(url, { method: "POST", body: JSON.stringify(payload), headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).question.status).toBe("pending");
      const forged = await fetch(`${url}/question?nativeRunId=native&sessionId=other`, { headers });
      expect(forged.status).toBe(409);
      expect(await forged.text()).not.toContain("Choose");
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.unlinkSync(file); }
  });
});
