import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXCLUDED_ROOT_DIRECTORIES = new Set([
  ".git", ".idea", ".vscode", "build", "coverage", "data", "dist", "logs", "node_modules", "release", "runtime", "secrets", "tmp", "uploads"
]);
const EXCLUDED_SUFFIXES = [
  ".bak", ".crt", ".db", ".dump", ".jks", ".key", ".keystore", ".log", ".migration-complete", ".p12", ".pem", ".pfx",
  ".sqlite", ".sqlite3", ".sqlite-shm", ".sqlite-wal"
];

export function shouldIncludeReleasePath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);
  if (!normalized || normalized.startsWith("/") || segments.includes("..")) return false;
  if (EXCLUDED_ROOT_DIRECTORIES.has(segments[0])) return false;
  const name = segments.at(-1) || "";
  if (name === ".env.example") return true;
  if (name === ".env" || name.startsWith(".env.")) return false;
  if (name === ".DS_Store" || name === ".npmrc" || name === "Dockerfile (2).txt") return false;
  if (name === "id_rsa" || name === "id_ed25519") return false;
  return !EXCLUDED_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix));
}

function collectReleaseFiles(rootDir, currentDir = rootDir, output = []) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, absolutePath).replaceAll("\\", "/");
    if (!shouldIncludeReleasePath(relativePath)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) collectReleaseFiles(rootDir, absolutePath, output);
    else if (entry.isFile()) output.push({ absolutePath, relativePath });
  }
  return output;
}

export async function createReleaseArchive(outputPath) {
  const destination = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const files = collectReleaseFiles(PROJECT_ROOT);
  const temporary = destination + "." + process.pid + ".tmp";
  if (fs.existsSync(destination)) throw new Error("Refusing to overwrite existing archive: " + destination);
  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(temporary, { flags: "wx" });
      const archive = new ZipArchive({ zlib: { level: 9 } });
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("warning", reject);
      archive.on("error", reject);
      archive.pipe(output);
      for (const file of files) archive.file(file.absolutePath, { name: file.relativePath });
      void archive.finalize();
    });
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
  return { outputPath: destination, fileCount: files.length, bytes: fs.statSync(destination).size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
  const requestedOutput = process.argv[2] || path.join(PROJECT_ROOT, "release", "mybay-open-source-v" + packageJson.version + ".zip");
  createReleaseArchive(requestedOutput)
    .then((result) => console.log("[Release] Created " + result.outputPath + " (" + result.fileCount + " files, " + result.bytes + " bytes)."))
    .catch((error) => {
      console.error("[Release] Failed: " + (error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    });
}
