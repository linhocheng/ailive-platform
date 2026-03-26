/**
 * cost-tracker.ts — Claude API 費用追蹤
 *
 * 定價（USD per 1M tokens）：
 * - claude-sonnet-4-6:        input $3.00  / output $15.00
 * - claude-haiku-4-5-20251001: input $0.80  / output $4.00
 *
 * 匯率：1 USD = 32 NTD（固定）
 */

import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const USD_TO_NTD = 32;

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00  },
  'gemini-2.5-flash-image':    { input: 0.075, output: 0.30  },
};

// fallback：不認識的 model 用 haiku 定價
const DEFAULT_PRICING = { input: 0.80, output: 4.00 };

export function calcCostUSD(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function usdToNtd(usd: number): number {
  return usd * USD_TO_NTD;
}

export function formatNtd(usd: number): string {
  const ntd = usdToNtd(usd);
  if (ntd < 0.01) return 'NT$0.00';
  return `NT$${ntd.toFixed(2)}`;
}

/**
 * 將一次 API 呼叫的費用寫入角色的 costMetrics
 * 用 FieldValue.increment 累加，不會覆蓋
 */
export async function trackCost(
  characterId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  if (!characterId || inputTokens + outputTokens === 0) return;
  try {
    const costUSD = calcCostUSD(model, inputTokens, outputTokens);
    const db = getFirestore();
    await db.collection('platform_characters').doc(characterId).update({
      'costMetrics.totalInputTokens':  FieldValue.increment(inputTokens),
      'costMetrics.totalOutputTokens': FieldValue.increment(outputTokens),
      'costMetrics.totalCostUSD':      FieldValue.increment(costUSD),
    });
  } catch {
    // 費用追蹤失敗不阻斷主流程
  }
}
