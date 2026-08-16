import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { PROJECT_ROOT, listSourceFiles, literalText, makeIssue, parseSource, propertyNameText, runBaselineGuard, walk } from "./i18n-guard-common.mjs";

function isTranslationCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
  return name === "t" && Boolean(literalText(node.arguments[0]));
}

export function scanI18nFallbacks(root = PROJECT_ROOT, inputs = ["src"]) {
  const issues = [];
  for (const relativePath of listSourceFiles(inputs, root)) {
    const sourceFile = parseSource(relativePath, root);
    walk(sourceFile, (node) => {
      if (isTranslationCall(node)) {
        const second = node.arguments[1];
        if (literalText(second) !== null) {
          issues.push(makeIssue(sourceFile, node, "t-second-argument", second.getText(sourceFile)));
        } else if (second && ts.isObjectLiteralExpression(second)) {
          const fallback = second.properties.find((property) => ts.isPropertyAssignment(property) && propertyNameText(property.name) === "defaultValue");
          if (fallback && ts.isPropertyAssignment(fallback) && literalText(fallback.initializer) !== null) {
            issues.push(makeIssue(sourceFile, node, "t-default-value", fallback.initializer.getText(sourceFile)));
          }
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken && isTranslationCall(node.left) && literalText(node.right) !== null) {
        issues.push(makeIssue(sourceFile, node, "t-or-fallback", node.right.getText(sourceFile)));
      }
    });
  }
  return issues;
}

export function runFallbackCheck({ root = PROJECT_ROOT, writeBaseline = false } = {}) {
  return runBaselineGuard({ section: "i18n-fallbacks", issues: scanI18nFallbacks(root), writeBaseline });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runFallbackCheck({ writeBaseline: process.argv.includes("--write-baseline") });