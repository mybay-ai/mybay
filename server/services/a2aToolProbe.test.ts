import { PassThrough } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ exec: vi.fn(), inspect: vi.fn() }));
vi.mock("../lib/docker", () => ({ docker: { getContainer: () => ({ exec: state.exec }) } }));
import { probeA2ATools } from "./a2aToolProbe";
beforeEach(() => {
  vi.resetAllMocks();
  state.exec.mockResolvedValue({ inspect: state.inspect, start: async () => {
    const stream = new PassThrough();
    setTimeout(() => stream.end("private diagnostic output"), 0);
    return stream;
  } });
});
it.each([[0,"ready"], [20,"not_configured"], [21,"disabled"], [22,"missing"], [124,"unknown"], [1,"unknown"]])("maps probe exit %s without exposing output", async (code, expected) => {
  state.inspect.mockResolvedValue({ ExitCode: code });
  expect(await probeA2ATools({ id: "agent-1" })).toBe(expected);
  expect(state.exec.mock.calls[0][0].Cmd.slice(0,2)).toEqual(["timeout", "8"]);
});
it("reports unavailable containers as unconfirmed", async () => {
  state.exec.mockRejectedValue(new Error("unavailable"));
  expect(await probeA2ATools({ id: "agent-1" })).toBe("unknown");
});
