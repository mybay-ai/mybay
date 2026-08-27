export type GeneratedArtifactCategory =
  | "web"
  | "presentations"
  | "documents"
  | "spreadsheets"
  | "images"
  | "data"
  | "archives"
  | "other";

const CATEGORY_EXTENSIONS: Record<GeneratedArtifactCategory, readonly string[]> = {
  web: ["html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx", "svg", "webmanifest"],
  presentations: ["ppt", "pptx", "odp"],
  documents: ["pdf", "doc", "docx", "odt", "rtf", "md", "markdown", "txt"],
  spreadsheets: ["xls", "xlsx", "ods", "csv", "tsv"],
  images: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"],
  data: ["json", "jsonl", "yaml", "yml", "xml"],
  archives: ["zip", "tar", "gz", "tgz", "7z"],
  other: []
};

const EXTENSION_CATEGORY = new Map<string, GeneratedArtifactCategory>(
  Object.entries(CATEGORY_EXTENSIONS).flatMap(([category, extensions]) =>
    extensions.map((extension) => [extension, category as GeneratedArtifactCategory])
  )
);

export function resolveGeneratedArtifactCategory(fileName: string): GeneratedArtifactCategory {
  const normalized = String(fileName || "").trim().toLowerCase();
  const extension = normalized.includes(".") ? normalized.split(".").pop() || "" : "";
  return EXTENSION_CATEGORY.get(extension) || "other";
}

export const GENERATED_ARTIFACT_SYSTEM_POLICY = `MyBay 本地生成文件规则：
- 容器工作区根目录固定为 /opt/data。不得猜测、输出或记录宿主机盘符、Windows 路径、Docker bind mount 源路径，也不得把 /opt/data 翻译成 G:\\、C:\\、/mnt/c 或其他宿主机路径。
- 所有新生成的交付物默认保存到 /opt/data/outputs/<类别>/<项目名>/；项目名使用简短、安全、可读的 slug。
- 类别建议：web（HTML/CSS/JS 及网页资源）、presentations（PPT/PPTX/ODP）、documents（PDF/DOCX/Markdown/TXT）、spreadsheets（XLSX/CSV）、images（独立图片）、data（JSON/YAML/XML）、archives（ZIP/TAR），无法归类时使用 other。
- 以主交付物的项目类型决定目录。一个网页项目的 HTML、CSS、JS、字体和图片必须保存在同一个 web 项目目录；演示文稿及其 HTML/PDF 预览文件必须保存在同一个 presentations 项目目录，不要按单个扩展名拆散项目资源。
- 回复用户时只返回 /opt/data/... 容器路径。创建或修改文件后，先确认文件确实存在，再报告路径；不要声称文件位于宿主机目录。`;
