import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));

export const WINDOWS_RELEASE_FILES = [
  ".env.example",
  "LICENSE",
  "package.json",
  "Start-MyBay.bat",
  "Stop-MyBay.bat",
  "View-Logs.bat",
  "Repair-MyBay.bat",
  "Uninstall-MyBay.bat",
  "Collect-Diagnostics.bat",
  "WINDOWS-README.md",
  "WINDOWS-README.zh-CN.md",
  "WINDOWS-ACCEPTANCE.md",
  "WINDOWS-ACCEPTANCE.zh-CN.md",
  "docker-compose.windows.yml",
  "docker-compose.server.yml",
  "deploy/traefik/dynamic.yml",
  "quick-start.ps1",
  "scripts/quick-start-env.ps1",
  "scripts/windows-control.ps1",
  "scripts/windows-acceptance.ps1",
  "scripts/windows-preflight.ps1",
  "scripts/windows-prerequisites.ps1",
];

export async function createWindowsReleaseArchive(outputPath) {
  const destination = path.resolve(outputPath);
  if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite existing archive: ${destination}`);
  for (const relativePath of WINDOWS_RELEASE_FILES) {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    if (!fs.statSync(absolutePath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Windows release file is missing: ${relativePath}`);
    }
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(temporary, { flags: "wx" });
      const archive = new ZipArchive({ zlib: { level: 9 } });
      output.on("close", resolve);
      output.on("error", reject);
      archive.on("warning", reject);
      archive.on("error", reject);
      archive.pipe(output);
      for (const relativePath of WINDOWS_RELEASE_FILES) {
        archive.append(fs.readFileSync(path.join(PROJECT_ROOT, relativePath)), {
          name: relativePath,
          date: new Date("1980-01-01T00:00:00.000Z"),
        });
      }
      void archive.finalize();
    });
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    throw error;
  }
  return { outputPath: destination, bytes: fs.statSync(destination).size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] || path.join(PROJECT_ROOT, "release", `MyBay-Windows-v${packageJson.version}.zip`);
  createWindowsReleaseArchive(output)
    .then((result) => console.log(`[Release] Created Windows package ${result.outputPath} (${result.bytes} bytes).`))
    .catch((error) => {
      console.error(`[Release] Failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
