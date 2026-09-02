export const STEADY_TEXT_FLUSH_DELAY_MS = 50;

/** Render the first text delta immediately, then batch later deltas to limit React churn. */
export function resolveTextFlushDelay(hasRenderedText: boolean): number {
  return hasRenderedText ? STEADY_TEXT_FLUSH_DELAY_MS : 0;
}
