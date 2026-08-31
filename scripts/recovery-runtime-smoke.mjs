import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

// Opt-in integration check: run only in a disposable Linux container WITHOUT
// network, Docker socket, host data mounts or host secrets. No provider calls.
if (process.env.MYBAY_RECOVERY_SMOKE !== "1" || process.platform !== "linux" || fs.existsSync("/var/run/docker.sock")) {
  throw new Error("Use a disposable Linux container with MYBAY_RECOVERY_SMOKE=1 and no Docker socket.");
}
const bundle = "/app/dist/server.cjs";
assert.ok(fs.existsSync(bundle), "Build the production image first.");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-runtime-recovery-"));
const source = path.join(root, "source");
const recovered = path.join(root, "recovered");
const incompatible = path.join(root, "future-schema");
const backup = path.join(root, "backup");
const instanceId = crypto.randomUUID();
const conversationId = crypto.randomUUID();
const messageId = crypto.randomUUID();
const password = crypto.randomBytes(24).toString("base64url");
const providerSecret = crypto.randomBytes(24).toString("base64url");
const base = "http://127.0.0.1:3333";
const env = {
  PATH: process.env.PATH,
  NODE_ENV: "production", PORT: "3333", DEPLOYMENT_MODE: "desktop", PROXY_MODE: "local",
  LOCAL_ADMIN_USERNAME: "recovery-admin", LOCAL_ADMIN_PASSWORD: password,
  JWT_SECRET: crypto.randomBytes(32).toString("hex"), ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
  MYBAY_INTERNAL_ROUTING_SECRET: crypto.randomBytes(32).toString("hex"),
  ENABLE_LOCAL_WORKER: "false", MYBAY_DOCKER_GC_ENABLED: "false",
  PUBLIC_APP_URL: base, VITE_PUBLIC_APP_URL: base,
  DOTENV_CONFIG_PATH: path.join(root, "absent.env"),
};
const children = new Set();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const cli = (...args) => JSON.parse(execFileSync(process.execPath, ["/app/scripts/mybay-ops.mjs", ...args, "--json"], { env, encoding: "utf8" }));
function launch(directory) {
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(path.join(directory, "dist"))) fs.symlinkSync("/app/dist", path.join(directory, "dist"));
  if (!fs.existsSync(path.join(directory, "package.json"))) fs.symlinkSync("/app/package.json", path.join(directory, "package.json"));
  const child = spawn(process.execPath, [bundle], {
    cwd: directory,
    env: { ...env, MYBAY_SQLITE_PATH: path.join(directory, "data/mybay.sqlite") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.on("close", () => children.delete(child));
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
  return { child, getOutput: () => output };
}
async function ready(server) {
  for (let attempt = 0; attempt < 400; attempt++) {
    assert.equal(server.child.exitCode, null, "Application exited before health became available.");
    try {
      const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch { /* bounded readiness retry */ }
    await pause(100);
  }
  const safeOutput = Object.values(env).filter((value) => typeof value === "string" && value.length >= 24)
    .reduce((output, value) => output.replaceAll(value, "[redacted]"), server.getOutput());
  throw new Error(`Isolated application readiness timed out. ${safeOutput.slice(-2000)}`);
}
async function stop(server) {
  if (server.child.exitCode !== null || server.child.signalCode !== null) return;
  server.child.kill("SIGTERM");
  for (let i = 0; i < 80; i++) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) return;
    await pause(100);
  }
  server.child.kill("SIGKILL");
  throw new Error("Isolated application did not stop gracefully.");
}
async function login() {
  const response = await request(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username: "recovery-admin", password }),
  });
  assert.equal(response.status, 200, "Restored administrator login must succeed.");
  assert.equal((await response.json()).id, "local-admin");
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "Login must issue an authentication cookie.");
  return cookie;
}
async function getJson(url, cookie) {
  const response = await request(base + url, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200, `Authenticated route failed: ${url}`);
  return response.json();
}
function checkCredential(directory) {
  const db = new DatabaseSync(path.join(directory, "data/mybay.sqlite"), { readOnly: true });
  try {
    const credential = JSON.parse(db.prepare("SELECT data FROM credentials").get().data);
    const [iv, tag, ciphertext] = (credential.encrypted_value || credential.key_encrypted || credential.key).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(env.ENCRYPTION_KEY, "hex"), Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    assert.equal(Buffer.concat([decipher.update(Buffer.from(ciphertext, "hex")), decipher.final()]).toString(), providerSecret);
  } finally { db.close(); }
}
async function checkApplication(directory) {
  const server = launch(directory);
  try {
    await ready(server);
    const cookie = await login();
    assert.equal((await getJson("/api/auth/me", cookie)).username, "recovery-admin");
    const credentials = await getJson("/api/credentials", cookie);
    assert.equal(credentials.length, 1);
    assert.equal(credentials[0].name, "Recovery synthetic credential");
    assert.equal(JSON.stringify(credentials).includes(providerSecret), false);
    const conversations = await getJson(`/api/instances/${instanceId}/conversations`, cookie);
    assert.equal(conversations.conversations[0].id, conversationId);
    const messages = await getJson(`/api/instances/${instanceId}/conversations/${conversationId}/messages`, cookie);
    assert.equal(messages.messages[0].content, "RESTORE-HISTORY-OK");
    const uploaded = await request(base + "/uploads/recovery-input.txt");
    assert.equal(uploaded.status, 200);
    assert.equal(await uploaded.text(), "RESTORE-UPLOAD-OK");
    assert.equal((await request(base + "/login")).status, 200);
    checkCredential(directory);
  } finally { await stop(server); }
}

try {
  const initial = launch(source);
  try {
    await ready(initial);
    const cookie = await login();
    const response = await request(base + "/api/credentials", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
      body: JSON.stringify({ name: "Recovery synthetic credential", type: "openai", key: providerSecret }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
  } finally { await stop(initial); }
  // Seed only synthetic historical data while every application writer is stopped.
  const db = new DatabaseSync(path.join(source, "data/mybay.sqlite"));
  const timestamp = new Date().toISOString();
  for (const [table, row] of [
    ["instances", { id: instanceId, user_id: "local-admin", owner_id: "local-admin", name: "Recovery fixture (no container)", status: "stopped", config_json: "{}", created_at: timestamp }],
    ["conversations", { id: conversationId, user_id: "local-admin", instance_id: instanceId, title: "Recovery history", created_at: timestamp, updated_at: timestamp, last_message_at: timestamp }],
    ["chatMessages", { id: messageId, user_id: "local-admin", instance_id: instanceId, conversation_id: conversationId, role: "assistant", content: "RESTORE-HISTORY-OK", sequence_no: 1, created_at: timestamp }],
  ]) db.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?)`).run(row.id, JSON.stringify(row));
  db.close();
  const artifact = path.join(source, "data/instances", instanceId, "report.html");
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, "<p>RESTORE-ARTIFACT-OK</p>");
  fs.mkdirSync(path.join(source, "data/uploads"), { recursive: true });
  fs.writeFileSync(path.join(source, "data/uploads/recovery-input.txt"), "RESTORE-UPLOAD-OK");
  await checkApplication(source);
  const { manifest } = cli("backup", "--database", path.join(source, "data/mybay.sqlite"), "--output", backup);
  assert.equal(cli("verify-backup", "--backup", backup).ok, true);
  cli("restore", "--backup", backup, "--output", recovered);
  for (const entry of manifest.files) assert.equal(sha256(path.join(recovered, entry.path)), entry.sha256);
  await checkApplication(recovered);
  console.log("PASS restored production application: login, credential decryption, sanitized API, history, upload HTTP and artifact hashes");

  cli("restore", "--backup", backup, "--output", incompatible);
  const futurePath = path.join(incompatible, "data/mybay.sqlite");
  const future = new DatabaseSync(futurePath);
  future.prepare("UPDATE localMetadata SET value = '999' WHERE key = 'schema_version'").run();
  future.close();
  const beforeFailure = sha256(futurePath);
  const failed = launch(incompatible);
  for (let i = 0; i < 80 && failed.child.exitCode === null; i++) await pause(100);
  try {
    assert.notEqual(failed.child.exitCode, null, "Future schema must stop application startup.");
    assert.notEqual(failed.child.exitCode, 0);
    assert.match(failed.getOutput(), /schema.*newer|newer.*schema/i);
    assert.equal(sha256(futurePath), beforeFailure, "Rejected future database must remain unchanged.");
  } finally { await stop(failed); }
  await checkApplication(source);
  console.log("PASS failed-start fallback: future schema rejected unchanged; preserved source data starts and login/history/files still work");
  console.log("BOUNDARY same-image isolated data recovery only; no real Agent, browser download or cross-version migration certification");
} finally {
  for (const child of children) child.kill("SIGKILL");
  // Data stays only in the disposable container, removed by docker run --rm.
}
