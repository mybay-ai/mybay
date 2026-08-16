import fs from "node:fs";
import path from "node:path";

type PackageMetadata = { version?: unknown };

export function getApplicationVersion(projectRoot = process.cwd()): string {
  const packagePath = path.join(projectRoot, "package.json");
  const metadata = JSON.parse(fs.readFileSync(packagePath, "utf8")) as PackageMetadata;
  const version = typeof metadata.version === "string" ? metadata.version.trim() : "";
  if (!version) throw new Error("Application version is missing from " + packagePath);
  return version;
}

export function createApplicationHealth(projectRoot = process.cwd()) {
  return {
    status: "healthy",
    version: getApplicationVersion(projectRoot)
  };
}