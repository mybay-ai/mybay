import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE_PATH = path.join(PROJECT_ROOT, "scripts", "i18n-guard-baseline.json");

const EXCLUDED_DIRS = new Set(["node_modules", "dist", "release", ".git", "assets", "locales"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

export function listSourceFiles(inputs, root = PROJECT_ROOT) {
  const output = [];
  const visit = (absolute) => {
    if (!fs.existsSync(absolute)) return;
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
        visit(path.join(absolute, entry.name));
      }
      return;
    }
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (!SOURCE_EXTENSIONS.has(path.extname(absolute))) return;
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative)) return;
    output.push(relative);
  };
  for (const input of inputs) visit(path.resolve(root, input));
  return output.sort();
}

export function parseSource(relativePath, root = PROJECT_ROOT) {
  const absolute = path.join(root, relativePath);
  const sourceText = fs.readFileSync(absolute, "utf8");
  const kind = relativePath.endsWith("x") ? ts.ScriptKind.TSX : relativePath.endsWith(".js") || relativePath.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, kind);
}

export function walk(node, visitor) {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}

export function literalText(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText();
  return null;
}

export function propertyNameText(name) {
  if (!name) return "";
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return name.getText();
}

export function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

export function normalizeFragment(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 240);
}

export function makeIssue(sourceFile, node, rule, text) {
  const normalized = normalizeFragment(text ?? node.getText(sourceFile));
  const relativePath = sourceFile.fileName.split(path.sep).join("/");
  return {
    relativePath,
    line: lineOf(sourceFile, node),
    rule,
    text: normalized,
    fingerprint: `${relativePath}|${rule}|${normalized}`,
  };
}

export function loadBaseline(baselinePath = BASELINE_PATH) {
  if (!fs.existsSync(baselinePath)) return { version: 1, sections: {} };
  return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

export function summarizeIssues(issues) {
  const counts = new Map();
  for (const issue of issues) counts.set(issue.fingerprint, (counts.get(issue.fingerprint) || 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fingerprint, count]) => ({ fingerprint, count }));
}

export function findNewIssues(issues, entries = []) {
  const allowance = new Map(entries.map((entry) => [entry.fingerprint, entry.count]));
  const used = new Map();
  return issues.filter((issue) => {
    const next = (used.get(issue.fingerprint) || 0) + 1;
    used.set(issue.fingerprint, next);
    return next > (allowance.get(issue.fingerprint) || 0);
  });
}

export function saveBaselineSection(section, issues, baselinePath = BASELINE_PATH) {
  const baseline = loadBaseline(baselinePath);
  baseline.version = 1;
  baseline.sections ||= {};
  baseline.sections[section] = summarizeIssues(issues);
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}

export function runBaselineGuard({ section, issues, writeBaseline = false, baselinePath = BASELINE_PATH }) {
  if (writeBaseline) {
    saveBaselineSection(section, issues, baselinePath);
    console.log(`[${section}] baseline updated with ${issues.length} current finding(s).`);
    return 0;
  }
  const baseline = loadBaseline(baselinePath);
  const newIssues = findNewIssues(issues, baseline.sections?.[section] || []);
  for (const issue of newIssues) console.error(`[${section}] ${issue.relativePath}:${issue.line} ${issue.rule}: ${issue.text}`);
  if (newIssues.length) {
    console.error(`[${section}] failed with ${newIssues.length} new finding(s); migrate the copy or deliberately refresh the reviewed baseline.`);
    return 1;
  }
  console.log(`[${section}] passed; ${issues.length} reviewed legacy finding(s), 0 new.`);
  return 0;
 }