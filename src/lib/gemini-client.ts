/**
 * gemini-client.ts
 * 輕量 Gemini API 封裝，專門用於後台純文字整理任務。
 * 介面設計跟 Haiku 一樣，哪裡原本用 Haiku 就能直接換。
 *
 * 適用任務（A 類）：
 *   - session state（三行格式）
 *   - userProfile 更新（2-3 句）
 *   - 摘要壓縮（5 句）
 *   - knowledge summary（15 字）
 *
 * 模型：gemini-2.0-flash（免費層 1500 RPD）
 * Fallback：呼叫失敗時靜默回傳空字串，不阻斷主流程
 */

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiOptions {
  maxTokens?: number;
  temperature?: number;
}

/**
 * 呼叫 Gemini，回傳純文字
 * 失敗時回傳 null（讓呼叫方決定要 fallback 還是略過）
 */
export async function callGemini(
  prompt: string,
  options: GeminiOptions = {},
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const { maxTokens = 400, temperature = 0.3 } = options;

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature,
          },
        }),
      },
    );

    if (!res.ok) {
      // 429 = rate limit，靜默 fallback
      console.warn(`[gemini-client] ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      error?: { message: string };
    };

    if (data.error) {
      console.warn('[gemini-client] error:', data.error.message);
      return null;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    return text;

  } catch (e) {
    console.warn('[gemini-client] fetch failed:', e);
    return null;
  }
}
