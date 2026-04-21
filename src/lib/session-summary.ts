/**
 * session-summary.ts
 *
 * 從一段對話訊息中萃取「給下次對話用的快照」(lastSession)。
 *
 * 共用點：voice-end、dialogue（每 N 輪滾動）— 都用這支
 * 不放在某條 API route 內，避免「真相分裂」（兩份萃取邏輯不同步）
 *
 * 設計約束：
 *   - 純函數：餵 client + dialogueText，回 SessionSummaryResult | null
 *   - 不寫 Firestore，不清 Redis（caller 自行決定 persist 路徑）
 *   - 回 null 代表「萃取失敗或對話太短」，caller 應靜默跳過
 */
import type Anthropic from '@anthropic-ai/sdk';

export type EndingMood = 'positive' | 'neutral' | 'concerned' | 'unfinished';

export type LastSession = {
  summary: string;
  endingMood: EndingMood | string;        // 容忍未來新值
  unfinishedThreads: string[];
  disconnectReason?: string;               // voice 端會帶（user_hangup / network / ...）
  updatedAt: string;                        // ISO
};

export type SessionSummaryResult = Omit<LastSession, 'updatedAt' | 'disconnectReason'>;

export interface ExtractOptions {
  /** 對話太短就不浪費 token，回 null。預設 4 則訊息（約 2 輪 user/assistant） */
  minMessages?: number;
  /** 截斷對話文字長度，避免 prompt 爆。預設 6000 字 */
  maxDialogueChars?: number;
}

/**
 * 從對話訊息陣列組出文字
 */
export function messagesToDialogueText(
  messages: Array<{ role?: unknown; content?: unknown } | Record<string, unknown>>,
  maxChars = 6000,
): string {
  const text = messages
    .map((m) => {
      const role = String(m.role) === 'user' ? '用戶' : '角色';
      const content = String(m.content || '').slice(0, 300);
      return `${role}：${content}`;
    })
    .filter((line) => line.length > 5)
    .join('\n');
  // 截斷取尾段（最近的對話最重要）
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

/**
 * 萃取 sessionSummary
 */
export async function extractSessionSummary(
  client: Anthropic,
  dialogueText: string,
  _opts: ExtractOptions = {},
): Promise<SessionSummaryResult | null> {
  const text = (dialogueText || '').trim();
  if (!text || text.length < 30) return null;

  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      messages: [
        {
          role: 'user',
          content: `以下是一段對話記錄。請產出一個 JSON 物件，給「下次對話」開場用的快照。

欄位：
- summary: 一句話白描這段對話聊了什麼主題（≤40 字，繁體中文）
- endingMood: positive / neutral / concerned / unfinished 四選一（看對話走向判斷氣氛）
- unfinishedThreads: 角色提到但沒講完、或用戶問了但沒解決的話題（字串陣列，可空）

回傳格式（只回 JSON，不要其他文字、不要 code fence）：
{"summary":"...","endingMood":"neutral","unfinishedThreads":[]}

對話：
${text}`,
        },
      ],
    });

    const raw = (res.content[0] as { type: 'text'; text: string }).text.trim();
    const cleaned = raw.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(cleaned) as {
      summary?: string;
      endingMood?: string;
      unfinishedThreads?: string[];
    };
    if (!parsed.summary) return null;

    return {
      summary: String(parsed.summary).slice(0, 80),
      endingMood: parsed.endingMood || 'neutral',
      unfinishedThreads: Array.isArray(parsed.unfinishedThreads)
        ? parsed.unfinishedThreads.filter(Boolean).map(String).slice(0, 5)
        : [],
    };
  } catch (e) {
    console.warn('[session-summary] extract failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}
