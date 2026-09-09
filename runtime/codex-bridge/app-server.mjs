import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";

/** One isolated app-server process per Runtime. Never attach to the desktop daemon. */
export class CodexAppServer extends EventEmitter {
  constructor({ command = "codex", args = [], cwd, env, timeoutMs = 30_000, spawnProcess = spawn }) {
    super();
    this.pending = new Map();
    this.sequence = 0;
    this.timeoutMs = timeoutMs;
    this.closed = false;
    this.child = spawnProcess(command, [...args, "app-server", "--listen", "stdio://"], {
      cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    this.child.stdout.on("data", chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > 8 * 1024 * 1024) return this.fail("CODEX_PROTOCOL_LIMIT");
      let offset;
      while ((offset = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, offset).trim(); buffer = buffer.slice(offset + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { this.fail("CODEX_PROTOCOL_INVALID"); return; }
        if (message.method) this.emit("message", message);
        else if (this.pending.has(message.id)) {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id); clearTimeout(pending.timer);
          // Native error details may contain prompts, provider bodies or paths.
          if (message.error) pending.reject(Object.assign(new Error("CODEX_RPC_FAILED"), { rpcCode: message.error.code }));
          else pending.resolve(message.result);
        }
      }
    });
    this.child.stderr.on("data", () => {});
    this.child.stdin.on("error", () => this.fail("CODEX_PROCESS_CLOSED"));
    this.child.on("error", () => this.fail("CODEX_PROCESS_START_FAILED"));
    this.child.on("exit", () => this.fail("CODEX_PROCESS_CLOSED"));
  }
  send(message) {
    if (this.closed) throw Error("CODEX_PROCESS_CLOSED");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(Error("CODEX_PROCESS_CLOSED"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(Error("CODEX_RPC_TIMEOUT"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      }
    });
  }
  async initialize() {
    const result = await this.request("initialize", { clientInfo: { name: "mybay_runtime", title: "MyBay Runtime", version: "0.1.0" } });
    this.send({ method: "initialized", params: {} });
    return result;
  }
  respond(id, result) { this.send({ id, result }); }
  fail(code) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error(code)); }
    this.pending.clear();
    this.child.kill();
    this.emit("closed", code);
  }
  close() { this.fail("CODEX_PROCESS_CLOSED"); }
}
