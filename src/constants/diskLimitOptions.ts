/**
 * Shared frontend constants for disk quota limit selections.
 */

export const DEFAULT_DISK_LIMIT_MB = 512;

export const DISK_LIMIT_OPTIONS = [
  { value: 512, label: "512 MB (0.5 GB) - 默认" },
  { value: 2048, label: "2048 MB (2 GB)" },
  { value: 4096, label: "4096 MB (4 GB)" },
  { value: 8192, label: "8192 MB (8 GB)" },
  { value: 10240, label: "10240 MB (10 GB)" },
  { value: 20480, label: "20480 MB (20 GB)" },
  { value: "unlimited", label: "无限制 (unlimited)" }
];
