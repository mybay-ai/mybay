export const INSTANCE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const INSTANCE_UPLOAD_MAX_FILES = 10;
export const INSTANCE_UPLOAD_DIRECTORIES = ["outputs", "uploads", "documents", "reports", "tmp"];
export const INSTANCE_UPLOAD_TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".log", ".yaml", ".yml", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".html", ".htm", ".css", ".sql", ".toml", ".py", ".sh", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".xml"];
export const INSTANCE_UPLOAD_EXTENSIONS = [...INSTANCE_UPLOAD_TEXT_EXTENSIONS, ".pdf", ".docx", ".xlsx", ".pptx", ".png", ".jpg", ".jpeg", ".webp"];

export function isInstanceUploadDirectory(directory: string): boolean {
  return /^\/(outputs|uploads|documents|reports|tmp)(\/[^/]+)*$/.test(directory)
    && !/[\\%\x00-\x1f\x7f]/.test(directory) && !directory.split("/").some(segment => segment === "." || segment.includes("..") || segment.startsWith("."));
}

export function isInstanceUploadFilename(name: string): boolean {
  return Boolean(name) && new TextEncoder().encode(name).length <= 180
    && !/[\\/%<>:"|?*\x00-\x1f\x7f]/.test(name) && !name.startsWith(".") && !/[. ]$/.test(name)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
    && !name.includes("..") && INSTANCE_UPLOAD_EXTENSIONS.includes(name.slice(name.lastIndexOf(".")).toLowerCase());
}
