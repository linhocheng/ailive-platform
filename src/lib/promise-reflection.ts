/**
 * Promise Reflection — session 結束時用 LLM 判斷哪些 unfulfilled actions 被兌現
 *
 * 江彬實證：自動標 fulfilled 比手動可靠（手動沒人標）。LLM 看完整 transcript +
 * unfulfilled 清單，比角色自己 tool call 更不會漏。
 *
 * 防 hallucination：只標 confidence >= 4。
 *
 * 紅線：
 *   - env PROMISE_REFLECTION_ENABLED=false 可全關
 *   - 失敗不阻斷（caller 應 catch）
 *   - 已 fulfilled 的不重複跑
 */
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from './anthropic-via-bridge';
import {
  getRecentUserActions,
  markActionFulfilled,
  type CharacterAction,
} from '@/lib/character-actions';

const REFLECTION_MODEL = 'claude-haiku-4-5-20251001';
const MIN_CONFIDENCE = 4;

export interface ReflectionStats {
  enabled: boolean;
  checked: number;
  marked: number;
  skipped: number;
  errors: number;
}

interface LLMVerdict {
  actionId: string;
  fulfilled: boolean;
  confidence: number;
}

function isEnabled(): boolean {
  return process.env.PROMISE_REFLECTION_ENABLED !== 'false';
}

function buildPrompt(transcript: string, actions: CharacterAction[]): string {
  const lines = actions.map((a, i) => {
    const label = a.actionType === 'promise' ? '我答應過'
      : a.actionType === 'question' ? '我問過'
      : a.actionType === 'event' ? '他/她的事'
      : a.actionType === 'note' ? '記得'
      : '';
    const body = a.title || a.content || '';
    return `${i + 1}. [id=${a.id}] ${label ? `（${label}）` : ''}${body}`;
  });

  return `以下是一段對話記錄。你是一個誠實的紀錄員。

【未兌現的承諾/問題/記得清單】
${lines.join('\n')}

【對話記錄】
${transcript}

請判斷對話中是否兌現了清單中的條目（也就是角色實際聊了那個主題、回應了那個問題、提到了那個記得的事）。

回 JSON 陣列，**每條清單項目都要評估**（不能漏、不能多）：
[{"actionId":"<id>","fulfilled":true|false,"confidence":1-5}]

confidence 標準：
- 5 = 確定（對話明確處理了該條）
- 4 = 高度可能
- 3 = 模糊
- 2 = 不太像
- 1 = 完全沒提

只回 JSON 陣列，不要其他文字、不要 code fence。`;
}

function parseVerdicts(raw: string): LLMVerdict[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim();
  }
  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      v => v && typeof v.actionId === 'string'
        && typeof v.fulfilled === 'boolean'
        && typeof v.confidence === 'number'
    );
  } catch {
    return [];
  }
}

export async function reflectAndMarkFulfilled(opts: {
  characterId: string;
  userId: string;
  transcript: string;
  anthropicApiKey: string;
}): Promise<ReflectionStats> {
  const stats: ReflectionStats = {
    enabled: isEnabled(),
    checked: 0,
    marked: 0,
    skipped: 0,
    errors: 0,
  };

  if (!stats.enabled) return stats;
  if (!opts.transcript || opts.transcript.length < 50) return stats;
  if (!opts.anthropicApiKey) return stats;

  const actions = await getRecentUserActions(opts.characterId, opts.userId, {
    limit: 20,
    unfulfilledOnly: true,
  });
  stats.checked = actions.length;
  if (actions.length === 0) return stats;

  const client = getAnthropicClient(opts.anthropicApiKey);
  let verdicts: LLMVerdict[] = [];
  try {
    const resp = await client.messages.create({
      model: REFLECTION_MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: buildPrompt(opts.transcript, actions) }],
    });
    const raw = (resp.content[0] as Anthropic.TextBlock).text || '';
    verdicts = parseVerdicts(raw);
  } catch (e) {
    stats.errors += 1;
    console.warn('promise-reflection LLM failed:', e);
    return stats;
  }

  const validIds = new Set(actions.map(a => a.id).filter(Boolean));
  for (const v of verdicts) {
    if (!validIds.has(v.actionId)) { stats.skipped += 1; continue; }
    if (!v.fulfilled) { stats.skipped += 1; continue; }
    if (v.confidence < MIN_CONFIDENCE) { stats.skipped += 1; continue; }
    try {
      await markActionFulfilled(v.actionId, 'auto-haiku');
      stats.marked += 1;
    } catch (e) {
      stats.errors += 1;
      console.warn(`markActionFulfilled ${v.actionId} failed:`, e);
    }
  }
  return stats;
}
