import path from "path";
import fs from "fs";

export function resolveInstanceDataDir(instance: any): string {
  const defaultDir = path.join(process.cwd(), "data", "instances", instance.id);
  if (!instance) {
    return defaultDir;
  }

  const volumePath = instance.data_volume_path;
  if (!volumePath || typeof volumePath !== "string") {
    return defaultDir;
  }

  const trimmed = volumePath.trim();
  if (!trimmed) {
    return defaultDir;
  }

  // Security & validation checks
  if (!path.isAbsolute(trimmed) || trimmed.includes("..") || trimmed.includes("\\")) {
    return defaultDir;
  }

  const resolved = path.resolve(trimmed);
  
  // Prevent system or unsafe directory mapping
  const unsafeDirs = [
    path.resolve("/"),
    path.resolve(process.cwd()),
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "data", "instances")
  ];
  if (unsafeDirs.includes(resolved)) {
    return defaultDir;
  }

  // Must exist on disk
  if (!fs.existsSync(resolved)) {
    return defaultDir;
  }

  return resolved;
}

export function validateInstancePathForDeletion(instanceId: string, targetInstanceDir: string, baseInstancesDir: string) {
  const isIdValid = /^[a-zA-Z0-9-_]+$/.test(instanceId);
  const isPathWithinBounds = targetInstanceDir.startsWith(baseInstancesDir + path.sep);
  const isNotRootOrBase = targetInstanceDir !== baseInstancesDir && 
                         targetInstanceDir !== path.resolve("/") &&
                         targetInstanceDir !== path.resolve(process.cwd()) &&
                         targetInstanceDir !== path.resolve(process.cwd(), "data");

  return isIdValid && isPathWithinBounds && isNotRootOrBase;
}
