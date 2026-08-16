import { dbAdapter } from "../db";
import { compareHermesVersions } from "../../shared/version";
import { getHermesCapabilities } from "../utils/hermesCapabilities";

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string;
  prerelease?: boolean;
  draft?: boolean;
  published_at?: string;
}

export class VersionDiscoveryError extends Error {
  code = "VERSION_DISCOVERY_FAILED";
}

export async function discoverHermesVersions(fetchImpl: typeof fetch = fetch) {
  const repository = process.env.MY_BAY_GITHUB_REPO?.trim() || "nousresearch/hermes-agent";
  const image = process.env.MY_BAY_IMAGE?.trim() || "nousresearch/hermes-agent";
  const includePrerelease = process.env.MY_BAY_INCLUDE_PRERELEASE === "true";
  let response: Response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "MyBay-Local" },
    });
  } catch (error: any) {
    throw new VersionDiscoveryError(`GitHub releases request failed: ${error?.message || "network unavailable"}`);
  }
  if (!response.ok) throw new VersionDiscoveryError(`GitHub releases returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new VersionDiscoveryError("GitHub releases response is not an array");
  const releases = (payload as GitHubRelease[])
    .filter((release) => !release.draft && !!release.tag_name)
    .filter((release) => includePrerelease || !release.prerelease)
    .sort((a, b) => compareHermesVersions(b.tag_name!, a.tag_name!));
  if (!releases.length) throw new VersionDiscoveryError("No eligible Hermes releases were returned");

  for (const release of releases) {
    const version = release.tag_name!.trim();
    const capabilities = getHermesCapabilities({ version });
    await dbAdapter.upsertMyBayVersion({
      id: `github:${repository}:${version}`,
      version,
      image,
      image_tag: version,
      source: "github",
      release_url: release.html_url || null,
      changelog: release.body || "",
      published_at: release.published_at || null,
      is_prerelease: !!release.prerelease,
      is_latest: false,
      variant_type: "core",
      capabilities,
      feishu_capable: capabilities.includes("feishu"),
    });
  }
  await dbAdapter.updateAllVersionsLatestFlag(releases[0].tag_name!);
  return { repository, image, includePrerelease, releases: releases.map((release) => release.tag_name!) };
}
