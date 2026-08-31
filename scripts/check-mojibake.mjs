import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md",
  ".html", ".css", ".yml", ".yaml"
]);
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules", "dist", "coverage", "release", "data", ".git", "tmp", "backups"
]);

const MOJIBAKE_REGEXES = [
  { name: "Four consecutive question marks", pattern: /\?{4,}/g },
  { name: "Unicode replacement character", pattern: /\uFFFD/g },
  { name: "UTF-8 decoded as Windows-1252/Latin-1 (E2)", pattern: /\u00e2(?:[\u0080-\u00bf]|\u20ac|\u2122|\u0153|\u017e|\u2018|\u2019|\u201c|\u201d|\u2013|\u2014)/gi },
  { name: "UTF-8 decoded as Windows-1252/Latin-1 (C3)", pattern: /\u00c3[\u0080-\u00ff]/g },
  { name: "Unexpected Latin-1 C2 prefix", pattern: /\u00c2(?:[\u0080-\u00bf]|\u00a0)/g },
  { name: "Misdecoded UTF-8 BOM", pattern: /\u00ef\u00bb\u00bf/gi },
  { name: "Known GBK/UTF-8 mojibake sequence", pattern: /(?:鐠.|閸.|濮.|婢.|閿.|鈧.|绱.|闂.|瀹.|缁.|鍦.|姝.|鎻.|琛.|閮.|褰.){2,}/g },
  { name: "Known mojibake fragment", pattern: /(\u9983\u6533|\u9242\?|\u9241\?|\u7f01\u694a\u515b|\u7f02\u4f78\u5af8\u7ef1|\u9422\ue223\u5596\u6fee)/g }
];

export function findMojibakeIssues(text) {
  const issues = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes("$schema") || line.includes("node_modules")) return;
    for (const check of MOJIBAKE_REGEXES) {
      check.pattern.lastIndex = 0;
      if (check.pattern.test(line)) {
        issues.push({ line: index + 1, name: check.name, text: line.trim() });
      }
    }
  });
  return issues;
}

function collectTextFiles(rootDir, currentDir = rootDir, output = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) collectTextFiles(rootDir, fullPath, output);
    else if (entry.isFile() && TARGET_EXTS.has(path.extname(entry.name).toLowerCase())) output.push(fullPath);
  }
  return output;
}

export function scanProject(rootDir = process.cwd()) {
  const issues = [];
  for (const filePath of collectTextFiles(path.resolve(rootDir))) {
    let text;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      issues.push({ filePath, line: 0, name: "Read failure", text: error instanceof Error ? error.message : String(error) });
      continue;
    }
    for (const issue of findMojibakeIssues(text)) issues.push({ filePath, ...issue });
  }
  return issues;
}

function runCli() {
  console.log("Starting mojibake scan across project source and configuration files...");
  const issues = scanProject(process.cwd());
  for (const issue of issues) {
    const relativePath = path.relative(process.cwd(), issue.filePath);
    console.error(`[Mojibake Error] ${relativePath}:${issue.line} - ${issue.name}`);
    if (issue.text) console.error(`  Line: ${issue.text}`);
  }
  if (issues.length > 0) {
    console.error(`Mojibake check failed with ${issues.length} issue(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("Mojibake check passed. No garbled text found.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
