/**
 * anthropic-retry.ts
 * Anthropic API 過載重試機制
 *
 * 529 Overloaded：Anthropic 伺服器過載，等待後重試
 * 策略：最多重試 3 次，指數退避（1s / 2s / 4s）
 */

import Anthropic from '@anthropic-ai/sdk';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isOverloaded(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) return err.status === 529;
  if (err instanceof Error) return err.message.includes('529') || err.message.toLowerCase().includes('overloaded');
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * withRetry：包裝任何 Anthropic API 呼叫，自動處理 529
 *
 * 用法：
 * const res = await withRetry(() => client.messages.create({...}));
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isOverloaded(err) && attempt < retries) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 1s, 2s, 4s
        console.warn(`[Anthropic 529] 過載，${delay}ms 後重試（第 ${attempt + 1} 次）`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}
