import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { I18N_ACCESSIBILITY_ATTRIBUTES, I18N_HARDCODE_PROPERTY_NAMES, I18N_TECHNICAL_ALLOWLIST } from "./i18n-guard.config.mjs";
import { PROJECT_ROOT, listSourceFiles, literalText, makeIssue, parseSource, propertyNameText, runBaselineGuard, walk } from "./i18n-guard-common.mjs";

const TECHNICAL_TOKENS = new Set(I18N_TECHNICAL_ALLOWLIST.map((value) => value.toLowerCase()));
const BROWSER_COPY_CALLS = new Set(["alert", "confirm", "prompt", "Notification", "showToast"]);

export function isAllowedTechnicalText(text) {
  const words = String(text).match(/[A-Za-z][A-Za-z0-9]*/g) || [];
  if (!words.length) return false;
  return words.every((word) => TECHNICAL_TOKENS.has(word.toLowerCase()) || /^[A-Z0-9_]{2,}$/.test(word) || /^v?\d/.test(word));
}

export function isNaturalLanguageText(text) {
  const value = String(text).replace(/\{\{?[^}]+\}?\}/g, " ").replace(/\s+/g, " ").trim();
  if (!value || isAllowedTechnicalText(value)) return false;
  if (/[\u3400-\u9fff]/u.test(value)) return true;
  const words = value.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length >= 2) return true;
  return words.length === 1 && words[0].length >= 4 && /^[A-Z]/.test(words[0]);
}

function jsxAttributeText(node) {
  if (!node.initializer) return null;
  if (ts.isStringLiteral(node.initializer)) return node.initializer.text;
  if (ts.isJsxExpression(node.initializer)) return literalText(node.initializer.expression);
  return null;
}

function callName(node) {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  return "";
}

function isLocaleCondition(node) {
  const text = node.getText();
  return /\bisZh\b|\bisEnglish\b|(?:i18n\.)?(?:resolvedLanguage|language).*?(?:zh|en)/i.test(text);
}

export function scanHardcodedUi(root = PROJECT_ROOT, inputs = ["src"]) {
  const issues = [];
  for (const relativePath of listSourceFiles(inputs, root)) {
    const sourceFile = parseSource(relativePath, root);
    walk(sourceFile, (node) => {
      if (ts.isJsxText(node)) {
        const text = node.getText(sourceFile).trim();
        if (isNaturalLanguageText(text)) issues.push(makeIssue(sourceFile, node, "jsx-text", text));
        return;
      }
      if (ts.isJsxAttribute(node)) {
        const name = node.name.getText(sourceFile);
        const text = jsxAttributeText(node);
        if (I18N_ACCESSIBILITY_ATTRIBUTES.has(name) && text && isNaturalLanguageText(text)) {
          issues.push(makeIssue(sourceFile, node, `jsx-${name}`, text));
        }
        return;
      }
      if (ts.isPropertyAssignment(node)) {
        const name = propertyNameText(node.name);
        const text = literalText(node.initializer);
        if (I18N_HARDCODE_PROPERTY_NAMES.has(name) && text && isNaturalLanguageText(text)) {
          issues.push(makeIssue(sourceFile, node, `copy-property:${name}`, text));
        }
        return;
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const name = callName(node);
        const text = literalText(node.arguments?.[0]);
        if (BROWSER_COPY_CALLS.has(name) && text && isNaturalLanguageText(text)) {
          issues.push(makeIssue(sourceFile, node, `browser-copy:${name}`, text));
        }
        return;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        if (/^(?:document\.)?title$/.test(node.left.getText(sourceFile))) {
          const text = literalText(node.right);
          if (text && isNaturalLanguageText(text)) issues.push(makeIssue(sourceFile, node, "document-title", text));
        }
        return;
      }
      if (ts.isConditionalExpression(node) && isLocaleCondition(node.condition)) {
        const whenTrue = literalText(node.whenTrue);
        const whenFalse = literalText(node.whenFalse);
        if ((whenTrue && isNaturalLanguageText(whenTrue)) || (whenFalse && isNaturalLanguageText(whenFalse))) {
          issues.push(makeIssue(sourceFile, node, "locale-branch", `${whenTrue || "<dynamic>"} | ${whenFalse || "<dynamic>"}`));
        }
      }
    });
  }
  return issues;
}

export function runHardcodeCheck({ root = PROJECT_ROOT, writeBaseline = false } = {}) {
  return runBaselineGuard({ section: "i18n-hardcode", issues: scanHardcodedUi(root), writeBaseline });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runHardcodeCheck({ writeBaseline: process.argv.includes("--write-baseline") });