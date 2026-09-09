import release from "../runtime/codex-bridge/release.json";

/** Current pinned build; upgrade admission remains independently gated. */
export const CODEX_BUILD = Object.freeze(release);
