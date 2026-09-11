import { CODEX_BUILD } from "../../shared/codexBuild";
import { findRuntimeRelease } from "../../shared/runtimeReleases";
import path from "node:path";
import tar from "tar-fs";

export const CODEX_RUNTIME_IMAGE = `${CODEX_BUILD.image}:${CODEX_BUILD.imageTag}`;
let pending: Promise<string> | undefined;

export function isVerifiedLocalCodexRuntimeImage(imageRef: string, info: any): boolean {
  const separator = imageRef.lastIndexOf(":");
  if (separator <= imageRef.lastIndexOf("/")) return false;
  const image = imageRef.slice(0, separator);
  const tag = imageRef.slice(separator + 1);
  const release = findRuntimeRelease("codex", tag);
  if (!release || release.image !== image) return false;
  const expectedBridgeVersion = release.bridgeVersion || CODEX_BUILD.bridgeVersion;
  return info?.Config?.Labels?.["com.mybay.codex.runtime"] === "true"
    && info?.Config?.Labels?.["com.mybay.codex.agent-version"] === release.runtimeVersion
    && info?.Config?.Labels?.["com.mybay.codex.bridge-version"] === expectedBridgeVersion;
}

export async function ensureLocalCodexRuntimeImage({ dockerClient, imageRef, onLog }: { dockerClient: any; imageRef: string; onLog?: (message: string) => void }): Promise<string> {
  const separator = imageRef.lastIndexOf(":");
  if (separator <= imageRef.lastIndexOf("/")) throw Error("CODEX_IMAGE_UNSUPPORTED");
  const image = imageRef.slice(0, separator);
  const tag = imageRef.slice(separator + 1);
  const release = findRuntimeRelease("codex", tag);
  if (!release || release.image !== image) throw Error("CODEX_IMAGE_UNSUPPORTED");
  const verified = async () => {
    try {
      const info = await dockerClient.getImage(imageRef).inspect();
      return isVerifiedLocalCodexRuntimeImage(imageRef, info);
    } catch { return false; }
  };
  if (await verified()) return imageRef;
  if (!release.isLatest || imageRef !== CODEX_RUNTIME_IMAGE) throw Error("CODEX_IMAGE_UNVERIFIED");
  if (!pending) pending = (async () => {
    onLog?.(`Building Codex Runtime ${CODEX_BUILD.nativeVersion} (${CODEX_BUILD.bridgeVersion})`);
    const stream = await dockerClient.buildImage(tar.pack(path.join(process.cwd(), "runtime", "codex-bridge")), { t: imageRef, rm: true, forcerm: true });
    await new Promise<void>((resolve, reject) => dockerClient.modem.followProgress(stream, (error: unknown) => error ? reject(Error("CODEX_IMAGE_BUILD_FAILED")) : resolve()));
    if (!await verified()) throw Error("CODEX_IMAGE_UNVERIFIED");
    return imageRef;
  })().finally(() => { pending = undefined; });
  return pending;
}
export async function ensureCodexRuntimeDataOwnership({ dockerClient, image, hostInstanceDataDir }: { dockerClient: any; image: string; hostInstanceDataDir: string }) {
  const container = await dockerClient.createContainer({ Image: image, User: "root", NetworkDisabled: true,
    Cmd: ["sh", "-c", "mkdir -p /opt/data/codex /opt/data/codex-bridge /opt/data/workspace && chown -R 1000:1000 /opt/data"],
    // Native Codex creates private 0700 directories; the network-disabled owner migration must traverse them on redeploy.
    HostConfig: { Binds: [`${hostInstanceDataDir}:/opt/data:rw`], ReadonlyRootfs: true, CapDrop: ["ALL"], CapAdd: ["CHOWN", "DAC_READ_SEARCH"], SecurityOpt: ["no-new-privileges:true"] } });
  try { await container.start(); const result = await container.wait(); if (Number(result.StatusCode) !== 0) throw Error("CODEX_DATA_PREPARE_FAILED"); }
  finally { await container.remove({ force: true }).catch(() => {}); }
}
