import { spawn } from "child_process";
import path from "path";
import fs from "fs";

/**
 * Safely calculates the size of a directory in bytes using 'du -sb'.
 * @param dirPath Absolute path to the directory
 * @param timeoutMs Timeout in milliseconds (default 3000ms)
 */
export async function getDirectorySizeBytes(dirPath: string, timeoutMs: number = 3000): Promise<number> {
  // 1. Basic path validation
  if (!path.isAbsolute(dirPath)) {
    throw new Error("Path must be absolute");
  }

  // 2. Security: Ensure the path is within the allowed instances data directory or valid data volume path
  const normalizedPath = path.normalize(dirPath);
  
  // Collect allowed root prefixes
  const allowedRoots: string[] = [];
  
  // A. process.cwd()/data/instances
  const rootStandard = path.normalize(path.join(process.cwd(), "data", "instances"));
  allowedRoots.push(rootStandard);
  
  // B. realpath of process.cwd()/data/instances if it exists
  try {
    if (fs.existsSync(rootStandard)) {
      allowedRoots.push(fs.realpathSync(rootStandard));
    }
  } catch (e) {
    // ignore
  }

  // C. Configuration item or environment variable instances data directory
  if (process.env.INSTANCES_DATA_DIR) {
    const rootEnv = path.normalize(process.env.INSTANCES_DATA_DIR);
    allowedRoots.push(rootEnv);
    try {
      if (fs.existsSync(rootEnv)) {
        allowedRoots.push(fs.realpathSync(rootEnv));
      }
    } catch (e) {}
  }

  // Check if normalizedPath starts with any of the allowed roots
  const isAllowed = allowedRoots.some(root => {
    const rootWithSlash = root.endsWith(path.sep) ? root : root + path.sep;
    return normalizedPath === root || normalizedPath.startsWith(rootWithSlash);
  });

  // Make sure there is no path traversal or shallow scanning of system directories
  const hasTraversal = normalizedPath.split(/[/\\]/).includes("..") || normalizedPath.includes("..");
  
  if (!isAllowed || hasTraversal) {
    throw new Error("Security Violation: Path is outside of allowed instances directory");
  }

  // 3. Check if directory exists
  if (!fs.existsSync(normalizedPath)) {
    return 0; // Or throw error, but 0 is safer for stats
  }

  return new Promise((resolve, reject) => {
    const du = spawn("du", ["-sb", normalizedPath]);
    let output = "";
    let errorOutput = "";

    const timer = setTimeout(() => {
      du.kill();
      reject(new Error("Storage check timed out"));
    }, timeoutMs);

    du.stdout.on("data", (data) => {
      output += data.toString();
    });

    du.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    du.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`du process exited with code ${code}: ${errorOutput}`));
        return;
      }

      // du -sb output format: "size\tpath\n"
      const match = output.trim().match(/^(\d+)/);
      if (match) {
        resolve(parseInt(match[1], 10));
      } else {
        reject(new Error("Failed to parse du output"));
      }
    });

    du.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
