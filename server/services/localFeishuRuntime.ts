import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import tar from "tar-fs";

export const FEISHU_RUNTIME_RECIPE_REVISION = "feishu-runtime-v1";

const pendingBuilds = new Map<string, Promise<string>>();
const FEISHU_CHANNELS = new Set(["feishu", "lark"]);
const FEISHU_SKILLS = new Set(["feishu", "lark", "feishu_adapter", "lark_adapter"]);

function normalizedValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toLowerCase());
  if (typeof value === "string") {
    return value.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

export function requiresLocalFeishuRuntime(config: any): boolean {
  const channels = [
    ...normalizedValues(config?.channel),
    ...normalizedValues(config?.configuredChannels),
  ];
  const skills = normalizedValues(config?.skills);
  return channels.some((channel) => FEISHU_CHANNELS.has(channel))
    || skills.some((skill) => FEISHU_SKILLS.has(skill));
}

export function resolveLocalFeishuImageRef(baseImage: string, baseTag: string): string {
  const repository = process.env.MY_BAY_FEISHU_IMAGE?.trim() || "mybay/hermes-agent-feishu";
  const safeTag = String(baseTag || "latest")
    .replace(/^sha256:/i, "sha256-")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "") || "latest";
  const fingerprint = crypto.createHash("sha256")
    .update(`${baseImage}:${baseTag}`)
    .digest("hex")
    .slice(0, 12);
  return `${repository}:${safeTag}-${fingerprint}`;
}

function resolveDockerfilePath(): string {
  const configured = process.env.FEISHU_DOCKERFILE_PATH?.trim();
  const candidates = [
    configured,
    path.join(process.cwd(), "Dockerfile.feishu"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) {
    throw Object.assign(new Error(
      "Feishu runtime recipe Dockerfile.feishu was not found. Reinstall MyBay or set FEISHU_DOCKERFILE_PATH to the packaged recipe."
    ), {
      code: "FEISHU_RUNTIME_PREPARE_FAILED",
      userMessage: "飞书运行环境准备失败：未找到内置 Dockerfile.feishu，请检查安装包是否完整后重试。",
      retryable: false,
    });
  }
  fs.accessSync(match, fs.constants.R_OK);
  return match;
}

async function inspectReusableImage(dockerClient: any, imageRef: string, baseImageRef: string): Promise<boolean> {
  try {
    const details = await dockerClient.getImage(imageRef).inspect();
    const labels = details?.Config?.Labels || details?.ContainerConfig?.Labels || {};
    return labels["com.mybay.feishu.runtime"] === "true"
      && labels["com.mybay.feishu.base-image"] === baseImageRef
      && labels["com.mybay.feishu.recipe-revision"] === FEISHU_RUNTIME_RECIPE_REVISION;
  } catch {
    return false;
  }
}

async function buildLocalFeishuImage(
  dockerClient: any,
  baseImage: string,
  baseTag: string,
  targetImage: string,
  onLog?: (message: string) => void,
): Promise<string> {
  const dockerfilePath = resolveDockerfilePath();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mybay-feishu-runtime-"));
  try {
    fs.copyFileSync(dockerfilePath, path.join(tempDir, "Dockerfile"));
    onLog?.(`正在基于 ${baseImage}:${baseTag} 构建本地飞书运行镜像，首次构建可能需要几分钟...`);
    const stream = await dockerClient.buildImage(tar.pack(tempDir), {
      t: targetImage,
      rm: true,
      forcerm: true,
      buildargs: {
        HERMES_BASE_IMAGE: baseImage,
        HERMES_BASE_TAG: baseTag,
        MYBAY_FEISHU_BASE_IMAGE: `${baseImage}:${baseTag}`,
        MYBAY_FEISHU_RECIPE_REVISION: FEISHU_RUNTIME_RECIPE_REVISION,
      },
    });

    await new Promise<void>((resolve, reject) => {
      let progressError: Error | null = null;
      dockerClient.modem.followProgress(
        stream,
        (error: any) => error || progressError ? reject(error || progressError) : resolve(),
        (event: any) => {
          if (event?.error) progressError = new Error(String(event.error));
        },
      );
    });

    if (!await inspectReusableImage(dockerClient, targetImage, `${baseImage}:${baseTag}`)) {
      throw new Error(`The built Feishu runtime image ${targetImage} is missing its dependency verification labels.`);
    }
    onLog?.(`飞书运行依赖已验证，本地镜像 ${targetImage} 已就绪。`);
    return targetImage;
  } catch (error: any) {
    throw Object.assign(new Error(`Feishu runtime image preparation failed: ${error?.message || String(error)}`), {
      code: "FEISHU_RUNTIME_PREPARE_FAILED",
      userMessage: "飞书运行环境准备失败。请检查 Docker 网络和磁盘空间后重试部署。",
      retryable: true,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function ensureLocalFeishuRuntimeImage(options: {
  dockerClient: any;
  baseImage: string;
  baseTag: string;
  onLog?: (message: string) => void;
}): Promise<string> {
  const { dockerClient, baseImage, baseTag, onLog } = options;
  const baseImageRef = `${baseImage}:${baseTag}`;
  const targetImage = resolveLocalFeishuImageRef(baseImage, baseTag);
  if (await inspectReusableImage(dockerClient, targetImage, baseImageRef)) {
    onLog?.(`检测到已验证的本地飞书运行镜像 ${targetImage}，直接复用。`);
    return targetImage;
  }

  const existing = pendingBuilds.get(targetImage);
  if (existing) {
    onLog?.("相同版本的飞书运行镜像正在构建，等待构建完成...");
    return existing;
  }

  const build = buildLocalFeishuImage(dockerClient, baseImage, baseTag, targetImage, onLog)
    .finally(() => pendingBuilds.delete(targetImage));
  pendingBuilds.set(targetImage, build);
  return build;
}
