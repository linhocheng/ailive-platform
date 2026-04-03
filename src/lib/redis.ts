/**
 * Redis client — Upstash REST API
 * 用途：Gateway session cache
 * 不用任何 npm 套件，純 fetch。輕量、無依賴。
 */

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL!;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

async function redisCall(command: unknown[]): Promise<unknown> {
  const res = await fetch(`${REDIS_URL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  const data = await res.json();
  return data.result;
}

export const redis = {
  /** 存值，帶過期（秒） */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await redisCall(['SET', key, value, 'EX', ttlSeconds]);
    } else {
      await redisCall(['SET', key, value]);
    }
  },

  /** 取值，不存在回 null */
  async get(key: string): Promise<string | null> {
    const result = await redisCall(['GET', key]);
    return result as string | null;
  },

  /** 刪值 */
  async del(key: string): Promise<void> {
    await redisCall(['DEL', key]);
  },

  /** 延長過期 */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await redisCall(['EXPIRE', key, ttlSeconds]);
  },
};
