/**
 * rate-limit — per-IP 固定視窗限流（Upstash Redis INCR + EXPIRE）
 *
 * 用途：擋匿名付費路由（dialogue / voice-stream / tts / stt）被腳本量產燒錢。
 * 合法單人使用遠低於門檻，攻擊者狂打會被 429。
 *
 * 用法：
 *   const rl = await checkRateLimit(req, 'tts', 60, 60); // 每 60 秒最多 60 次
 *   if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429 });
 *
 * 失敗開放（fail-open）：Redis 掛掉時不擋，避免限流基礎設施故障拖垮正常服務。
 */
import { NextRequest } from 'next/server';
import { redis } from '@/lib/redis';

export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export interface RateLimitResult {
  ok: boolean;
  count: number;
  limit: number;
}

/**
 * @param bucket 路由識別（分開計數）
 * @param limit  視窗內允許次數
 * @param windowSeconds 視窗長度（秒）
 */
export async function checkRateLimit(
  req: NextRequest,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const ip = clientIp(req);
  const key = `rl:${bucket}:${ip}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return { ok: count <= limit, count, limit };
  } catch {
    // fail-open：限流故障不擋正常服務
    return { ok: true, count: 0, limit };
  }
}
