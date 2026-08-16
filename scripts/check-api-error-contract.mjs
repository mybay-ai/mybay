import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isNaturalLanguageText } from "./check-i18n-hardcode.mjs";
import { PROJECT_ROOT, listSourceFiles, literalText, makeIssue, parseSource, propertyNameText, runBaselineGuard, walk } from "./i18n-guard-common.mjs";

function isResponseJsonCall(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "json") return false;
  return /(^|\W)res(?:\W|$)/.test(node.expression.expression.getText());
}

function findProperty(object, name) {
  return object.properties.find((property) =>
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && propertyNameText(property.name) === name
  );
}

function isRawErrorMessage(node) {
  if (!node) return false;
  if (literalText(node) !== null) return isNaturalLanguageText(literalText(node));
  return /(?:^|\.)message$/.test(node.getText()) || /sanitizeErrorMessage\(/.test(node.getText());
}

export function scanApiErrorContract(root = PROJECT_ROOT, inputs = ["server", "server.ts"]) {
  const issues = [];
  for (const relativePath of listSourceFiles(inputs, root)) {
    const sourceFile = parseSource(relativePath, root);
    walk(sourceFile, (node) => {
      if (!isResponseJsonCall(node)) return;
      const payload = node.arguments[0];
      if (!payload || !ts.isObjectLiteralExpression(payload)) return;
      if (findProperty(payload, "code")) return;
      const errorProperty = findProperty(payload, "error");
      const messageProperty = findProperty(payload, "message");
      const responseTarget = node.expression.expression.getText(sourceFile);
      const statusMatch = responseTarget.match(/\.status\((\d{3})\)/);
      const isErrorResponse = Boolean(errorProperty) || (statusMatch && Number(statusMatch[1]) >= 400);
      if (!isErrorResponse) return;
      const offending = [errorProperty, messageProperty].find((property) => property && ts.isPropertyAssignment(property) && isRawErrorMessage(property.initializer));
      if (!offending || !ts.isPropertyAssignment(offending)) return;
      issues.push(makeIssue(sourceFile, node, "api-error-without-code", offending.initializer.getText(sourceFile)));
    });
  }
  return issues;
}

export function runApiErrorContractCheck({ root = PROJECT_ROOT, writeBaseline = false } = {}) {
  return runBaselineGuard({ section: "api-error-contract", issues: scanApiErrorContract(root), writeBaseline });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runApiErrorContractCheck({ writeBaseline: process.argv.includes("--write-baseline") });