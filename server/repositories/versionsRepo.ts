import { dbAdapter } from "../db";
import { compareHermesVersions } from "../../shared/version";
import { getHermesCapabilities, supportsFeishu } from "../utils/hermesCapabilities";

export function parseSemver(v: string) {
  if (!v) return null;
  const match = v.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1] || '0', 10),
    minor: parseInt(match[2] || '0', 10),
    patch: parseInt(match[3] || '0', 10),
    build: parseInt(match[4] || '0', 10),
    prerelease: match[5] || null,
  };
}

export const compareSemver = compareHermesVersions;

export function getFamilyVersion(version: string): string {
  if (!version) return "";
  return version.replace(/-feishu$/, "");
}

export function buildVersionFamilies(rawList: any[]): any[] {
  const familiesMap = new Map<string, any>();
  
  for (const v of rawList) {
    const familyVer = getFamilyVersion(v.version);
    if (!familyVer) continue;
    
    const capabilities = getHermesCapabilities(v);
    const isLegacyFeishuVariant = /-feishu$/i.test(v.version || "") || /hermes-agent-feishu/i.test(v.image || "");
    
    if (!familiesMap.has(familyVer)) {
      familiesMap.set(familyVer, {
        familyVersion: familyVer,
        version: familyVer, // For backward compatibility
        tag: familyVer,     // For backward compatibility
        image_tag: familyVer, // For backward compatibility
        changelog: v.changelog || "",
        published_at: v.published_at,
        releaseAt: v.published_at ? v.published_at.substring(0, 10) : "",
        is_latest: v.is_latest || 0,
        is_prerelease: v.is_prerelease || 0,
        coreVariant: null,
        feishuVariant: null,
        capabilities: [...capabilities]
      });
    }
    
    const f = familiesMap.get(familyVer);
    
    // Select primary features on family level
    if (v.is_latest) {
      f.is_latest = v.is_latest;
      f.changelog = v.changelog || f.changelog;
    }
    if (!v.version.includes("-feishu")) {
      f.is_prerelease = v.is_prerelease;
    }
    
    const variantObj = {
      tag: v.image_tag || v.version,
      version: v.version,
      image: v.image,
      is_prewarmed: v.is_prewarmed,
      prewarm_status: v.prewarm_status
    };
    
    for (const capability of capabilities) {
      if (!f.capabilities.includes(capability)) f.capabilities.push(capability);
    }
    if (isLegacyFeishuVariant) f.feishuVariant = variantObj;
    else f.coreVariant = variantObj;
  }
  
  // Convert map to array and sort by semver
  const families = Array.from(familiesMap.values()).sort((a, b) => compareSemver(b.familyVersion, a.familyVersion));
  
  // Post-process
  return families.map(f => {
    const core = f.coreVariant;
    const feishu = f.feishuVariant;
    
    const primaryVariant = core || feishu;
    if (primaryVariant) {
      f.is_prewarmed = primaryVariant.is_prewarmed;
      f.prewarm_status = primaryVariant.prewarm_status;
      f.image = primaryVariant.image;
    }
    
    f.feishu_capable = f.capabilities.includes("feishu");
    return f;
  });
}

export const versionsRepo = {
  async list() {
    const data = await dbAdapter.getMyBayVersions();
    const list = (data || []).map((v: any) => {
      const capabilities = getHermesCapabilities(v);
      return { ...v, capabilities, feishu_capable: capabilities.includes("feishu") ? 1 : 0 };
    });
    return list.sort((a, b) => compareSemver(b.version || '', a.version || ''));
  },

  async getLatest() {
    const list = await this.list();
    const explicit = list.find(v => v.is_latest === 1 || v.is_latest === true);
    if (explicit) return explicit;
    
    const stable = list.find(v => v.is_prerelease === 0 || v.is_prerelease === false || !v.is_prerelease);
    if (stable) return stable;

    return list[0] || null;
  },

  async getResolvedLatestVersion() {
    const list = await this.list();
    
    // 1. Try to find the prewarmed 'latest' explicit version
    const explicitPrewarmed = list.find(v => 
      (v.is_latest === 1 || v.is_latest === true) && 
      (v.is_prewarmed === 1 || v.is_prewarmed === true || v.prewarm_status === 'ready' || v.prewarm_status === 'success' || v.prewarm_status === 'cached')
    );
    if (explicitPrewarmed) return explicitPrewarmed;

    // 2. Fallback to 'latest' flag even if not prewarmed
    const explicit = list.find(v => v.is_latest === 1 || v.is_latest === true);
    if (explicit) return explicit;
    
    // 3. Fallback to any prewarmed version
    const anyPrewarmed = list.find(v => 
      (v.is_prewarmed === 1 || v.is_prewarmed === true || v.prewarm_status === 'ready' || v.prewarm_status === 'success' || v.prewarm_status === 'cached')
    );
    if (anyPrewarmed) return anyPrewarmed;
    
    // 4. Fallback to standard stable latest
    return await this.getLatest();
  },

  async getResolvedLatestCoreVersion() {
    const list = await this.list();
    const coreList = list.filter(v => !/-feishu$/i.test(v.version || v.image_tag || ""));

    const explicitPrewarmed = coreList.find(v => 
      (v.is_latest === 1 || v.is_latest === true) && 
      (v.is_prewarmed === 1 || v.is_prewarmed === true || v.prewarm_status === 'ready' || v.prewarm_status === 'success' || v.prewarm_status === 'cached')
    );
    if (explicitPrewarmed) return explicitPrewarmed;

    const explicit = coreList.find(v => v.is_latest === 1 || v.is_latest === true);
    if (explicit) return explicit;
    
    const anyPrewarmed = coreList.find(v => 
      (v.is_prewarmed === 1 || v.is_prewarmed === true || v.prewarm_status === 'ready' || v.prewarm_status === 'success' || v.prewarm_status === 'cached')
    );
    if (anyPrewarmed) return anyPrewarmed;
    
    const stable = coreList.find(v => v.is_prerelease === 0 || v.is_prerelease === false || !v.is_prerelease);
    if (stable) return stable;

    return coreList[0] || null;
  },

  async getResolvedLatestFeishuVersion() {
    const list = await this.list();
    const feishuList = list.filter((v) => supportsFeishu(v) && !/-feishu$/i.test(v.version || v.image_tag || ""));
    return feishuList.find((v) => v.is_latest === 1 || v.is_latest === true)
      || feishuList.find((v) => !v.is_prerelease)
      || feishuList[0]
      || null;
  },

  async upsert(ver: any) {
    const payload = { ...ver };
    if (payload.feishu_capable === true || payload.feishu_capable === 'true') payload.feishu_capable = 1;
    else if (payload.feishu_capable === false || payload.feishu_capable === 'false') payload.feishu_capable = 0;
    for (const f of ['is_latest', 'is_prerelease', 'is_prewarmed']) {
      if (payload[f] !== undefined) {
        if (payload[f] === true || payload[f] === 'true') payload[f] = 1;
        else if (payload[f] === false || payload[f] === 'false') payload[f] = 0;
        else if (typeof payload[f] === 'number') payload[f] = payload[f] === 1 ? 1 : 0;
      }
    }
    await dbAdapter.upsertMyBayVersion(payload);
  },

  async updatePrewarmStatus(imageTag: string, status: string, isFinished: boolean = false, image?: string) {
    await dbAdapter.updatePrewarmStatus(imageTag, status, isFinished, image);
  },

  async updateLatestFlag(latestVersion: string) {
    await dbAdapter.updateAllVersionsLatestFlag(latestVersion);
  },

  async deleteStaleFeishuVariants(validTags: string[], image?: string) {
    void validTags;
    void image;
    return dbAdapter.deleteStaleFeishuVariants();
  }
};



