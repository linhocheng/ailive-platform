/**
 * tts-preprocess/index.ts
 * 對外 entry。維持與舊 src/lib/tts-preprocess.ts 的 import 介面相容。
 *
 * Phase 2.2：preprocessTTS 加 provider 參數，依 provider 選 overlay。
 * - 預設 provider = 'elevenlabs'（向後相容）
 * - provider = 'minimax' → 繼承 ElevenLabs 規則 − MINIMAX_EXCLUDES + MINIMAX_PRONUNCIATION
 */
import {
  ZH_TW_MAP,
  stripCleanup,
  type Hit,
  type RuleEntry,
  type Provider,
  type PreprocessLogContext,
} from './core';
import { ELEVENLABS_PRONUNCIATION } from './rules/elevenlabs';
import { MINIMAX_PRONUNCIATION, MINIMAX_EXCLUDES } from './rules/minimax';

// re-export types & maps（向後相容 detect CLI、test、其他 import 端）
export type { Strategy, Provider, RuleEntry, PreprocessLogContext } from './core';
export { ZH_TW_MAP } from './core';
// 維持 PRONUNCIATION_MAP 名稱（向後相容）— 固定為 ElevenLabs 字典作為 baseline
export const PRONUNCIATION_MAP = ELEVENLABS_PRONUNCIATION;

/**
 * 依 provider 算出實際生效的破音字規則集。
 * - elevenlabs（預設） → ELEVENLABS_PRONUNCIATION
 * - minimax            → ELEVENLABS_PRONUNCIATION 移除 MINIMAX_EXCLUDES，再覆蓋 MINIMAX_PRONUNCIATION
 * - all                → 視同 elevenlabs（暫時行為，未來可定義為聯集）
 */
export function getActiveRules(provider: Provider = 'elevenlabs'): Record<string, RuleEntry> {
  if (provider === 'minimax') {
    const result: Record<string, RuleEntry> = { ...ELEVENLABS_PRONUNCIATION };
    for (const k of MINIMAX_EXCLUDES) delete result[k];
    Object.assign(result, MINIMAX_PRONUNCIATION);
    return result;
  }
  return ELEVENLABS_PRONUNCIATION;
}

/**
 * preprocessTTS
 * 1. 清掉 Markdown / URL / 思考標籤（stripCleanup）
 * 2. 中台用語轉換（ZH_TW_MAP，兩家共用）
 * 3. 破音字替換（依 ctx.provider 選規則集，預設 'elevenlabs'）
 *
 * 命中規則時 console.log('[TTS-fix]', ...)，可在 Vercel logs grep。
 */
export function preprocessTTS(text: string, ctx?: PreprocessLogContext): string {
  const provider: Provider = ctx?.provider ?? 'elevenlabs';
  const activeRules = getActiveRules(provider);
  let r = stripCleanup(text);
  const hits: Hit[] = [];

  // 中台用語（長詞優先，兩家共用）
  for (const k of Object.keys(ZH_TW_MAP).sort((a, b) => b.length - a.length)) {
    if (r.includes(k)) {
      hits.push({ original: k, replacement: ZH_TW_MAP[k].replacement, strategy: ZH_TW_MAP[k].strategy, map: 'zh_tw' });
      r = r.replaceAll(k, ZH_TW_MAP[k].replacement);
    }
  }
  // 破音字（長詞優先，依 provider）
  for (const k of Object.keys(activeRules).sort((a, b) => b.length - a.length)) {
    if (r.includes(k)) {
      hits.push({ original: k, replacement: activeRules[k].replacement, strategy: activeRules[k].strategy, map: 'pronunciation' });
      r = r.replaceAll(k, activeRules[k].replacement);
    }
  }

  if (hits.length > 0) {
    console.log('[TTS-fix]', JSON.stringify({
      route: ctx?.route,
      provider,
      characterId: ctx?.characterId,
      inputLen: text.length,
      outputLen: r.length,
      hits,
    }));
  }

  return r.trim();
}
