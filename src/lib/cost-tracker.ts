/**
 * cost-tracker.ts — Claude API 費用追蹤
 *
 * 定價（USD per 1M tokens）：
 * - claude-sonnet-4-6:        input $3.00  / output $15.00
 * - claude-haiku-4-5-20251001: input $0.80  / output $4.00
 *
 * TTS 定價（USD per 1000 字元）：
 * - minimax:    $0.014（¥0.1/千字元 ÷ 7.2，粗估）
 * - elevenlabs: $0.30
 *
 * 匯率：1 USD = 32 NTD（固定）
 *
 * 雙寫策略：
 * - platform_characters.costMetrics  ← 角色累計（現有）
 * - zhu_vitals_cost                  ← 帶 timestamp，zhu-mid 按時間窗口查詢
 */

import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';

const USD_TO_NTD = 32;
const COST_TTL_DAYS = 90;

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00  },
  'gemini-2.5-flash-image':    { input: 0.075, output: 0.30  },
};

// USD per 1000 字元
const TTS_PRICING: Record<string, number> = {
  minimax:    0.014,
  elevenlabs: 0.30,
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

export function calcTTSCostUSD(provider: string, charCount: number): number {
  const pricePerK = TTS_PRICING[provider] ?? TTS_PRICING.elevenlabs;
  return (charCount * pricePerK) / 1000;
}

export function usdToNtd(usd: number): number {
  return usd * USD_TO_NTD;
}

export function formatNtd(usd: number): string {
  const ntd = usdToNtd(usd);
  if (ntd < 0.01) return 'NT$0.00';
  return `NT$${ntd.toFixed(2)}`;
}

function expiresAt(days: number): Date {
  return new Date(Date.now() + days * 86400 * 1000);
}

/**
 * 追蹤一次 LLM call 費用。
 * 雙寫：platform_characters.costMetrics（累計）+ zhu_vitals_cost（帶 timestamp）。
 */
export async function trackCost(
  characterId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  purpose?: string,
): Promise<void> {
  if (!characterId || inputTokens + outputTokens === 0) return;
  try {
    const costUSD = calcCostUSD(model, inputTokens, outputTokens);
    const db = getFirestore();
    const now = new Date();

    await Promise.all([
      // 原有：角色累計
      db.collection('platform_characters').doc(characterId).update({
        'costMetrics.totalInputTokens':  FieldValue.increment(inputTokens),
        'costMetrics.totalOutputTokens': FieldValue.increment(outputTokens),
        'costMetrics.totalCostUSD':      FieldValue.increment(costUSD),
      }),
      // 新增：帶 timestamp 的明細，供 zhu-mid 時間窗口查詢
      db.collection('zhu_vitals_cost').add({
        call_id:      randomUUID(),
        timestamp:    now,
        project:      'ailive-platform',
        worker_id:    `ailive-${purpose ?? 'unknown'}`,
        character_id: characterId,
        type:         'llm',
        // bridge = Claude Max 月費吃到飽，不從 API key 扣費
        route:        process.env.BRIDGE_ENABLED === 'true' ? 'bridge' : 'anthropic-sdk',
        model,
        input_tokens:  inputTokens,
        output_tokens: outputTokens,
        // bridge 走 Max 月費，cost_usd_est 是參考用量，不是實際帳單
        cost_usd_est:  costUSD,
        purpose:       purpose ?? 'unknown',
        expires_at:    expiresAt(COST_TTL_DAYS),
      }),
    ]);
  } catch {
    // 費用追蹤失敗不阻斷主流程
  }
}

/**
 * 追蹤一次 TTS call 費用（按字元計）。
 * 只寫 zhu_vitals_cost（無角色累計欄位可寫）。
 */
export async function trackTTSCost(
  characterId: string,
  provider: string,
  charCount: number,
): Promise<void> {
  if (!characterId || charCount === 0) return;
  try {
    const costUSD = calcTTSCostUSD(provider, charCount);
    const db = getFirestore();
    await db.collection('zhu_vitals_cost').add({
      call_id:      randomUUID(),
      timestamp:    new Date(),
      project:      'ailive-platform',
      worker_id:    'ailive-tts',
      character_id: characterId,
      type:         'tts',
      purpose:      'voice-stream-tts',
      tts_provider: provider,
      tts_characters: charCount,
      cost_usd_est:  costUSD,
      expires_at:    expiresAt(COST_TTL_DAYS),
    });
  } catch {
    // 費用追蹤失敗不阻斷主流程
  }
}
