/**
 * last-session-block.ts
 *
 * 把 lastSession 組成可注入 system prompt 的 block。
 *
 * 共用點：voice-stream、dialogue（未來其他對話 agent 也用同一份）
 * 抽出的理由：避免「voice 端講某種話、dialogue 端講另一種話」（真相分裂）
 *
 * 規則（給角色看的，不給用戶看）：
 *   - 自然帶出，不報告式複述
 *   - 不硬要提，看情境
 *   - 留白給角色自行判斷
 */
import type { LastSession } from './session-summary';

const MOOD_LABEL: Record<string, string> = {
  positive: '聊得愉快',
  concerned: '對方心情不太好',
  unfinished: '意猶未盡',
  // neutral 不顯示，避免雜訊
};

/**
 * 組裝 lastSession 的 prompt block。
 *
 * @returns 開頭含 \n\n--- 的字串。沒東西組就回空字串
 */
export function buildLastSessionBlock(lastSession: LastSession | undefined | null): string {
  if (!lastSession || !lastSession.summary) return '';

  const parts: string[] = [`\n\n---\n【上次對話】${lastSession.summary}`];

  if (lastSession.endingMood && MOOD_LABEL[lastSession.endingMood]) {
    parts.push(`氣氛：${MOOD_LABEL[lastSession.endingMood]}`);
  }

  if (Array.isArray(lastSession.unfinishedThreads) && lastSession.unfinishedThreads.length > 0) {
    parts.push(`未完話題：${lastSession.unfinishedThreads.slice(0, 2).join('、')}`);
  }

  parts.push('（可以自然帶出延續上次，也可以完全不提，看情境與對方開場。不要硬套、不要報告式複述。）');

  return parts.join('\n');
}
