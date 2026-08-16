/**
 * 头像校验结果结构
 */
export interface AvatarValidationResult {
  valid: boolean;
  reason: "ok" | "invalid_protocol" | "invalid_format";
}

/**
 * 校验头像 URL 并分类返回结果
 * 
 * 规则：
 * 1. 空字符串：允许（用于清空头像）
 * 2. 平台受控预设头像相对路径：必须以 "/assets/avatars/" 开头
 * 3. 外部绝对 URL：必须是有效的 URL 且协议为 "http:" 或 "https:"
 */
export function validateAvatarUrl(avatarUrl: string | undefined | null): AvatarValidationResult {
  if (avatarUrl === undefined || avatarUrl === null || avatarUrl.trim() === "") {
    return { valid: true, reason: "ok" };
  }

  const trimmed = avatarUrl.trim();

  // A. 站内受控相对路径
  if (trimmed.startsWith("/assets/avatars/")) {
    const safePresetRegex = /^\/assets\/avatars\/[a-zA-Z0-9_\-]+\.(svg|png|jpg|jpeg|webp)$/;
    if (safePresetRegex.test(trimmed)) {
      return { valid: true, reason: "ok" };
    } else {
      return { valid: false, reason: "invalid_format" };
    }
  }

  // B. 本地上传的自定义头像路径
  if (trimmed.startsWith("/uploads/avatars/")) {
    const safeUploadRegex = /^\/uploads\/avatars\/user_[a-zA-Z0-9_\-]+\_[0-9]+\.(gif|png|jpg|jpeg)$/;
    if (safeUploadRegex.test(trimmed)) {
      return { valid: true, reason: "ok" };
    } else {
      return { valid: false, reason: "invalid_format" };
    }
  }

  // B. 外部绝对 URL 或其它格式
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { valid: true, reason: "ok" };
    } else {
      return { valid: false, reason: "invalid_protocol" };
    }
  } catch (err) {
    // 无法被 new URL 解析：
    // 判断是否包含了不合法的协议前缀 (例如 javascript:, data:, file:) 或者是单纯的格式错误
    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith("javascript:") ||
      lower.startsWith("data:") ||
      lower.startsWith("file:") ||
      (lower.includes("://") && !lower.startsWith("http://") && !lower.startsWith("https://"))
    ) {
      return { valid: false, reason: "invalid_protocol" };
    }
    return { valid: false, reason: "invalid_format" };
  }
}

/**
 * 简单判断头像 URL 是否合法 (为了向后兼容)
 */
export function isValidAvatarUrl(avatarUrl: string | undefined | null): boolean {
  return validateAvatarUrl(avatarUrl).valid;
}
