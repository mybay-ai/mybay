export type LocalizedDurationUnit = "millisecond" | "second" | "minute" | "hour";

export function formatLocalizedDuration(
  durationMs: number | null | undefined,
  unit: (key: LocalizedDurationUnit) => string,
  options: { fractionalSeconds?: boolean } = {},
): string {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return "";
  if (durationMs < 1000) return `${Math.round(durationMs)}${unit("millisecond")}`;

  const secondsValue = durationMs / 1000;
  if (secondsValue < 60) {
    const seconds = options.fractionalSeconds
      ? secondsValue.toFixed(secondsValue >= 10 ? 0 : 1)
      : String(Math.round(secondsValue));
    return `${seconds}${unit("second")}`;
  }

  const totalSeconds = Math.round(secondsValue);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours > 0 ? `${hours}${unit("hour")}` : "",
    minutes > 0 ? `${minutes}${unit("minute")}` : "",
    seconds > 0 ? `${seconds}${unit("second")}` : "",
  ].filter(Boolean).join(" ");
}
