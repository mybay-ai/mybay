type FeatureEnvironment = Record<string, string | undefined>;

export function isAdvancedResourceConfigEnabled(
  env: FeatureEnvironment = process.env
): boolean {
  return String(env.MYBAY_ADVANCED_RESOURCE_CONFIG_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
}
