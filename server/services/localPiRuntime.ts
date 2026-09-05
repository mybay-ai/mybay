import fs from "node:fs";
import path from "node:path";
import tar from "tar-fs";

export const PI_RUNTIME_IMAGE = "mybay/pi-runtime:0.1.0-experimental";
const pendingBuilds = new Map<string, Promise<string>>();

export function resolveLocalPiImageRef(): string {
  return process.env.MYBAY_PI_RUNTIME_IMAGE?.trim() || PI_RUNTIME_IMAGE;
}

function resolveBuildContext(): string {
  const configured = process.env.MYBAY_PI_RUNTIME_CONTEXT?.trim();
  const candidates = [configured, path.join(process.cwd(), "runtime", "pi-bridge")]
    .filter((candidate): candidate is string => Boolean(candidate));
  const match = candidates.find(candidate => fs.existsSync(path.join(candidate, "Dockerfile")));
  if (!match) throw Object.assign(new Error("The packaged Pi runtime build context is missing."), { code: "PI_RUNTIME_PREPARE_FAILED" });
  return match;
}

async function isReusable(dockerClient: any, imageRef: string): Promise<boolean> {
  try {
    const details = await dockerClient.getImage(imageRef).inspect();
    const labels = details?.Config?.Labels || details?.ContainerConfig?.Labels || {};
    return labels["com.mybay.pi.runtime"] === "true"
      && labels["com.mybay.pi.bridge-version"] === "0.1.0-experimental"
      && labels["com.mybay.pi.agent-version"] === "0.85.0";
  } catch {
    return false;
  }
}

export async function ensureLocalPiRuntimeImage(options: {
  dockerClient: any;
  onLog?: (message: string) => void;
}): Promise<string> {
  const imageRef = resolveLocalPiImageRef();
  if (await isReusable(options.dockerClient, imageRef)) {
    options.onLog?.(`检测到已验证的本地 Pi Runtime 镜像 ${imageRef}，直接复用。`);
    return imageRef;
  }
  const pending = pendingBuilds.get(imageRef);
  if (pending) return pending;
  const build = (async () => {
    const context = resolveBuildContext();
    options.onLog?.("正在构建本地 Pi Runtime 实验镜像，首次构建需要下载官方 Pi 依赖。");
    const stream = await options.dockerClient.buildImage(tar.pack(context), { t: imageRef, rm: true, forcerm: true });
    await new Promise<void>((resolve, reject) => {
      let progressError: Error | null = null;
      options.dockerClient.modem.followProgress(stream, (error: any) => error || progressError ? reject(error || progressError) : resolve(), (event: any) => {
        if (event?.error) progressError = new Error(String(event.error));
      });
    });
    if (!await isReusable(options.dockerClient, imageRef)) throw new Error("The built Pi Runtime image is missing verification labels.");
    options.onLog?.(`Pi Runtime 实验镜像 ${imageRef} 已构建并验证。`);
    return imageRef;
  })().catch((error: any) => {
    throw Object.assign(new Error(`Pi Runtime image preparation failed: ${error?.message || String(error)}`), {
      code: "PI_RUNTIME_PREPARE_FAILED",
      userMessage: "Pi Runtime 镜像准备失败。请检查 Docker 网络和磁盘空间后重试。",
      retryable: true,
    });
  }).finally(() => pendingBuilds.delete(imageRef));
  pendingBuilds.set(imageRef, build);
  return build;
}
