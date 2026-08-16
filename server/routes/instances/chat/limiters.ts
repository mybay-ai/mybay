export interface LimiterRecord {
  timestamps: number[];
  lastSeenAt: number;
}

export const runsLimiterStore = new Map<string, LimiterRecord>();
export const MAX_LIMITER_STORE_SIZE = 10000;

export function getLimitRate(): number {
  const val = parseInt(process.env.MYBAY_ASYNC_RUNS_LIMIT_RATE || "10", 10);
  if (isNaN(val) || !isFinite(val)) return 10;
  return Math.min(Math.max(val, 1), 1000);
}

export function getLimitWindowMs(): number {
  const val = parseInt(process.env.MYBAY_ASYNC_RUNS_LIMIT_WINDOW_MS || "60000", 10);
  if (isNaN(val) || !isFinite(val)) return 60000;
  return Math.min(Math.max(val, 1000), 86400000);
}

export function cleanupRunsLimiterStore(now: number = Date.now()): void {
  const limitWindowMs = getLimitWindowMs();
  for (const [key, record] of runsLimiterStore.entries()) {
    record.timestamps = record.timestamps.filter(t => now - t < limitWindowMs);
    if (record.timestamps.length === 0 && now - record.lastSeenAt > limitWindowMs) {
      runsLimiterStore.delete(key);
    }
  }
}

export const limiterCleanupInterval = setInterval(() => {
  cleanupRunsLimiterStore();
}, 60000);
limiterCleanupInterval.unref();

export function runsLimiter(req: any, res: any, next: any) {
  if (req.user && req.user.role === "admin") {
    return next();
  }

  const limitRate = getLimitRate();
  const limitWindowMs = getLimitWindowMs();

  const key = req.user?.id?.toString() || req.ip || "unknown";
  const now = Date.now();

  let record = runsLimiterStore.get(key);
  if (!record) {
    if (runsLimiterStore.size >= MAX_LIMITER_STORE_SIZE) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, r] of runsLimiterStore.entries()) {
        if (r.lastSeenAt < oldestTime) {
          oldestTime = r.lastSeenAt;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        runsLimiterStore.delete(oldestKey);
      }
    }

    record = { timestamps: [], lastSeenAt: now };
    runsLimiterStore.set(key, record);
  }

  record.lastSeenAt = now;
  record.timestamps = record.timestamps.filter(t => now - t < limitWindowMs);

  if (record.timestamps.length >= limitRate) {
    return res.status(429).json({
      success: false,
      error: "RATE_LIMIT_EXCEEDED",
      message: "异步对话任务请求过于频繁，请稍后再试。"
    });
  }

  record.timestamps.push(now);
  next();
}