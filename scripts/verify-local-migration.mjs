import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const legacyPath = path.resolve(process.argv[2] || "data/local-store.json");
const sqlitePath = path.resolve(process.argv[3] || "data/mybay.sqlite");

if (!fs.existsSync(legacyPath)) throw new Error(`Legacy store not found: ${legacyPath}`);
if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite database not found: ${sqlitePath}`);

const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
const collections = [
  "users", "instances", "credentials", "auditLogs", "versions",
  "userResourcePolicies", "channelAuthEvents", "deploymentTasks",
  "deploymentEvents", "files", "tasks", "scheduledJobs", "templates",
  "blueprints", "chatProjects", "conversations", "chatMessages",
  "chatRuns", "chatMessageFeedback",
];
const db = new DatabaseSync(sqlitePath, { readOnly: true });
const counts = {};
const mismatches = [];

try {
  for (const collection of collections) {
    counts[collection] = Number(db.prepare(`SELECT COUNT(*) AS count FROM "${collection}"`).get().count);
    const expected = Array.isArray(legacy[collection]) ? legacy[collection].length : 0;
    if (counts[collection] !== expected) mismatches.push(`${collection}: ${expected} != ${counts[collection]}`);
  }
  counts.systemSettings = Number(db.prepare("SELECT COUNT(*) AS count FROM systemSettings").get().count);
  const expectedSettings = Object.keys(legacy.systemSettings || {}).length;
  if (counts.systemSettings !== expectedSettings) mismatches.push(`systemSettings: ${expectedSettings} != ${counts.systemSettings}`);
  counts.localMetadata = Number(db.prepare("SELECT COUNT(*) AS count FROM localMetadata").get().count);
} finally {
  db.close();
}

console.log(JSON.stringify({ legacyPath, sqlitePath, counts, mismatches }, null, 2));
if (mismatches.length > 0) process.exitCode = 1;
