import fs from "node:fs";
import path from "node:path";
import tar from "tar-fs";

export const PI_RUNTIME_IMAGE = "mybay/pi-runtime:0.1.0-beta";
const pendingBuilds = new Map<string, Promise<string>>();

export function resolveLocalPiImageRef(): string {
  return process.env.MYBAY_PI_RUNTIME_IMAGE?.trim() || PI_RUNTIME_IMAGE;
}

export function parsePiRuntimeImageRef(imageRef: string): { image: string; tag: string } {
  const normalized = String(imageRef || "").trim();
  const lastSlash = normalized.lastIndexOf("/");
  const lastColon = normalized.lastIndexOf(":");
  if (!normalized || lastColon <= lastSlash || lastColon === normalized.length - 1) {
    throw Object.assign(new Error("The Pi Runtime image reference must include an explicit tag."), {
      code: "PI_RUNTIME_IMAGE_INVALID",
    });
  }
  return { image: normalized.slice(0, lastColon), tag: normalized.slice(lastColon + 1) };
}

export async function ensurePiRuntimeDataOwnership(options: {
  dockerClient: any;
  image: string;
  hostInstanceDataDir: string;
}): Promise<void> {
  const initContainer = await options.dockerClient.createContainer({
    Image: options.image,
    User: "root",
    Cmd: ["sh", "-c", "mkdir -p /opt/data/pi/sessions /opt/data/pi/runs /opt/data/workspace && chown -R 1000:1000 /opt/data"],
    NetworkDisabled: true,
    HostConfig: {
      Binds: [`${options.hostInstanceDataDir}:/opt/data:rw`],
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      CapAdd: ["CHOWN"],
      SecurityOpt: ["no-new-privileges:true"],
    },
  });
  try {
    await initContainer.start();
    const result = await initContainer.wait();
    if (Number(result?.StatusCode) !== 0) {
      throw Object.assign(new Error("Pi Runtime data ownership migration failed."), {
        code: "PI_RUNTIME_DATA_PREPARE_FAILED",
      });
    }
  } finally {
    await initContainer.remove({ force: true }).catch(() => {});
  }
}

function resolveBuildContext(): string {
  const configured = process.env.MYBAY_PI_RUNTIME_CONTEXT?.trim();
  const candidates = [configured, path.join(process.cwd(), "runtime", "pi-bridge")]
    .filter((candidate): candidate is string => Boolean(candidate));
  const match = candidates.find(candidate => fs.existsSync(path.join(candidate, "Dockerfile")));
  if (!match) throw Object.assign(new Error("The packaged Pi runtime build context is missing."), { code: "PI_RUNTIME_PREPARE_FAILED" });
  return match;
}

export async function isVerifiedPiRuntimeImage(dockerClient: any, imageRef: string): Promise<boolean> {
  try {
    const details = await dockerClient.getImage(imageRef).inspect();
    const labels = details?.Config?.Labels || details?.ContainerConfig?.Labels || {};
    return labels["com.mybay.pi.runtime"] === "true"
      && typeof labels["com.mybay.pi.bridge-version"] === "string"
      && typeof labels["com.mybay.pi.agent-version"] === "string";
  } catch {
    return false;
  }
}

export async function ensureLocalPiRuntimeImage(options: {
  dockerClient: any;
  onLog?: (message: string) => void;
}): Promise<string> {
  const imageRef = resolveLocalPiImageRef();
  if (await isVerifiedPiRuntimeImage(options.dockerClient, imageRef)) {
    options.onLog?.(`检测到已验证的本地 Pi Runtime 镜像 ${imageRef}，直接复用。`);
    return imageRef;
  }
  const pending = pendingBuilds.get(imageRef);
  if (pending) return pending;
  const build = (async () => {
    const context = resolveBuildContext();
    options.onLog?.("正在构建本地 Pi Runtime Beta 镜像，首次构建需要下载官方 Pi 依赖。");
    const stream = await options.dockerClient.buildImage(tar.pack(context), { t: imageRef, rm: true, forcerm: true });
    await new Promise<void>((resolve, reject) => {
      let progressError: Error | null = null;
      options.dockerClient.modem.followProgress(stream, (error: any) => error || progressError ? reject(error || progressError) : resolve(), (event: any) => {
        if (event?.error) progressError = new Error(String(event.error));
      });
    });
    if (!await isVerifiedPiRuntimeImage(options.dockerClient, imageRef)) throw new Error("The built Pi Runtime image is missing verification labels.");
    options.onLog?.(`Pi Runtime Beta 镜像 ${imageRef} 已构建并验证。`);
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

export async function ensureSelectedPiRuntimeImage(options: {
  dockerClient: any;
  imageRef: string;
  onLog?: (message: string) => void;
}): Promise<string> {
  const requested = parsePiRuntimeImageRef(options.imageRef);
  const configuredRef = resolveLocalPiImageRef();
  const configured = parsePiRuntimeImageRef(configuredRef);
  if (requested.image === configured.image && requested.tag === configured.tag) {
    return ensureLocalPiRuntimeImage(options);
  }
  if (!await isVerifiedPiRuntimeImage(options.dockerClient, options.imageRef)) {
    throw Object.assign(new Error(`The selected historical Pi Runtime image is unavailable or unverified: ${options.imageRef}`), {
      code: "PI_RUNTIME_IMAGE_UNAVAILABLE",
    });
  }
  options.onLog?.(`检测到已验证的历史 Pi Runtime 镜像 ${options.imageRef}，直接复用。`);
  return options.imageRef;
}
