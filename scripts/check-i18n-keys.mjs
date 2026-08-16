import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LOCALE_ROOT = path.join(ROOT, "src", "locales");

export function listJsonFiles(root, current = root, output = []) {
  if (!fs.existsSync(current)) return output;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) listJsonFiles(root, absolute, output);
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      output.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return output.sort();
}

export function flattenLocaleKeys(value, prefix = "", output = new Set()) {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    if (prefix) output.add(prefix);
    return output;
  }
  const entries = Object.entries(value);
  if (entries.length === 0 && prefix) output.add(prefix);
  for (const [key, child] of entries) flattenLocaleKeys(child, prefix ? `${prefix}.${key}` : key, output);
  return output;
}

export function checkLocaleParity(localeRoot = DEFAULT_LOCALE_ROOT, primaryLocale = "zh-CN", secondaryLocale = "en") {
  const primaryDir = path.join(localeRoot, primaryLocale);
  const secondaryDir = path.join(localeRoot, secondaryLocale);
  const primaryFiles = listJsonFiles(primaryDir);
  const secondaryFiles = listJsonFiles(secondaryDir);
  const allFiles = [...new Set([...primaryFiles, ...secondaryFiles])].sort();
  const issues = [];
  let leafKeyCount = 0;

  for (const file of allFiles) {
    if (!primaryFiles.includes(file)) {
      issues.push({ type: "missing-file", locale: primaryLocale, file });
      continue;
    }
    if (!secondaryFiles.includes(file)) {
      issues.push({ type: "missing-file", locale: secondaryLocale, file });
      continue;
    }
    const primary = JSON.parse(fs.readFileSync(path.join(primaryDir, file), "utf8"));
    const secondary = JSON.parse(fs.readFileSync(path.join(secondaryDir, file), "utf8"));
    const primaryKeys = flattenLocaleKeys(primary);
    const secondaryKeys = flattenLocaleKeys(secondary);
    leafKeyCount += primaryKeys.size;
    for (const key of [...primaryKeys].filter((candidate) => !secondaryKeys.has(candidate)).sort()) {
      issues.push({ type: "missing-key", locale: secondaryLocale, file, key });
    }
    for (const key of [...secondaryKeys].filter((candidate) => !primaryKeys.has(candidate)).sort()) {
      issues.push({ type: "missing-key", locale: primaryLocale, file, key });
    }
  }
  return { issues, fileCount: allFiles.length, leafKeyCount };
}

export function runLocaleParityCheck(localeRoot = DEFAULT_LOCALE_ROOT) {
  const result = checkLocaleParity(localeRoot);
  for (const issue of result.issues) {
    if (issue.type === "missing-file") console.error(`[i18n] Missing in ${issue.locale}: ${issue.file}`);
    else console.error(`[i18n] Missing in ${issue.locale}/${issue.file}: ${issue.key}`);
  }
  if (result.issues.length) {
    console.error(`i18n recursive key parity check failed with ${result.issues.length} issue(s).`);
    return 1;
  }
  console.log(`i18n recursive key parity check passed for ${result.fileCount} files and ${result.leafKeyCount} leaf keys.`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runLocaleParityCheck();