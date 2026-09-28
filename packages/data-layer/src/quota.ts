/**
 * 配额守卫：每个源一个 KV 计数器（按 UTC 日）。
 * 接近 dailyQuota 时自动降频/告警，避免打爆免费额度被封。
 */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

function dayKey(sourceId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `quota:${sourceId}:${day}`;
}

export async function usedToday(kv: KVLike, sourceId: string): Promise<number> {
  return Number((await kv.get(dayKey(sourceId))) ?? "0");
}

export async function bump(kv: KVLike, sourceId: string, n = 1): Promise<number> {
  const next = (await usedToday(kv, sourceId)) + n;
  await kv.put(dayKey(sourceId), String(next), { expirationTtl: 60 * 60 * 48 });
  return next;
}

/** 是否还有配额（无 rate_limit 视为不限） */
export async function hasQuota(
  kv: KVLike,
  sourceId: string,
  dailyQuota?: number,
): Promise<boolean> {
  if (!dailyQuota) return true;
  return (await usedToday(kv, sourceId)) < dailyQuota;
}
