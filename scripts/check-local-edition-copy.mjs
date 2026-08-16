import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REQUIRED_TARGETS = [
  "src/locales", "src/components", "src/features", "src/config", "server", "README.md", "README.zh-CN.md",
];
const OPTIONAL_TARGETS = ["src/pages"];
const EXCLUDED_DIRECTORY_NAMES = new Set([".git", "build", "coverage", "dist", "fixtures", "node_modules", "release"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".json", ".md"]);
export const FORBIDDEN_PHRASES = [
  "云端部署与托管平台", "在线托管与运行平台", "生产级托管平台", "安全云托管", "用户等级", "会员等级", "平台账号", "注册账号", "封禁账号", "托管实例", "云端数据库", "平台集群", "订阅套餐", "平台资源配额",
  "云端模板", "云端工作流", "企业级实例", "超出限额 of", "cloud template", "cloud workflow", "enterprise instance",
  "cloud hosting platform", "online hosting and execution platform", "MyBay hosting platform", "manually setting up cloud servers", "hosted Agent", "subscription plan", "membership tier", "platform account", "register an account", "account suspension", "hosted instance", "cloud database", "managed cluster", "MyBay Local", "麦贝 Local", "麦贝Local", "麦贝本地版",
];
const ALLOWED_NEGATIVE_CONTEXTS = [
  /不(?:提供|包含|要求|依赖).*?(?:云端账号|订阅套餐|云端数据库|托管实例|平台集群)/,
  /(?:does not|do not|doesn't|is not|are not|no longer)\s+.*?(?:cloud accounts?|subscription plans?|cloud databases?|hosted instances?|managed clusters?)/i,
];
const LEGACY_BRAND_PHRASES = new Set(["mybay local", "麦贝 local", "麦贝local", "麦贝本地版"]);
const ALLOWED_SELF_HOSTED_PHRASES = new Set(["hosted agent", "hosted instance"]);

function containsForbiddenPhrase(line, phrase) {
  const normalizedLine = line.toLowerCase();
  const normalizedPhrase = phrase.toLowerCase();
  let index = normalizedLine.indexOf(normalizedPhrase);
  while (index !== -1) {
    const isSelfHosted = ALLOWED_SELF_HOSTED_PHRASES.has(normalizedPhrase)
      && normalizedLine.slice(Math.max(0, index - 5), index) === "self-";
    if (!isSelfHosted) return true;
    index = normalizedLine.indexOf(normalizedPhrase, index + normalizedPhrase.length);
  }
  return false;
}

function listFiles(target, root) {
  const absolute = path.join(root, target);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [target];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && EXCLUDED_DIRECTORY_NAMES.has(entry.name)) return [];
    const relative = path.join(target, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) return listFiles(relative, root);
    if (/\.(?:test|spec)\.[^.]+$/i.test(entry.name)) return [];
    return EXTENSIONS.has(path.extname(entry.name)) ? [relative] : [];
  });
}
export function collectScanTargets(root = ROOT) {
  return REQUIRED_TARGETS.flatMap((target) => listFiles(target, root));
}
export function findLocalEditionCopyIssues(relativePath, text) {
  return String(text).split(/\r?\n/).flatMap((line, index) => {
    const allowedNegativeContext = ALLOWED_NEGATIVE_CONTEXTS.some((pattern) => pattern.test(line));
    return FORBIDDEN_PHRASES
      .filter((phrase) => containsForbiddenPhrase(line, phrase))
      .filter((phrase) => !allowedNegativeContext || LEGACY_BRAND_PHRASES.has(phrase.toLowerCase()))
      .map((phrase) => ({ relativePath, line: index + 1, phrase }));
  });
}
export function findMissingRequiredTargets(root = ROOT) {
  return REQUIRED_TARGETS.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)));
}
export function runLocalEditionCopyCheck(root = ROOT) {
  const missingTargets = findMissingRequiredTargets(root);
  const targets = collectScanTargets(root);
  const issues = targets.flatMap((relativePath) => findLocalEditionCopyIssues(relativePath, fs.readFileSync(path.join(root, relativePath), "utf8")));
  for (const issue of issues) console.error(`[MyBay Open Source Copy] ${issue.relativePath}:${issue.line} contains forbidden phrase: ${issue.phrase}`);
  for (const relativePath of missingTargets) console.error(`[MyBay Open Source Copy] required target is missing: ${relativePath}`);
  if (issues.length || missingTargets.length) return 1;
  console.log(`MyBay Open Source copy check passed across ${targets.length} files.`);
  return 0;
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runLocalEditionCopyCheck();