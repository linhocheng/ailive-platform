/**
 * tts-preprocess/rules/minimax.ts
 * MiniMax TTS 的破音字字典（待 Task 2.4 校對結果填入）
 *
 * 目前空 — 切 MiniMax 前必須先用 scripts/tts-minimax-audit.ts 跑試聽校對。
 */
import { type RuleEntry } from '../core';

// MiniMax 自家規則（覆寫 / 補充 ElevenLabs 規則）
export const MINIMAX_PRONUNCIATION: Record<string, RuleEntry> = {
  // 待 Task 2.4 校對結果填入
};

// 白名單：明確標「不要從 ElevenLabs 規則繼承」
// 例：MiniMax 念對「執行長」就把「執行長」放進來，避免被改成「執形掌」
export const MINIMAX_EXCLUDES: Set<string> = new Set([
  // 待 Task 2.4 校對結果填入
]);
