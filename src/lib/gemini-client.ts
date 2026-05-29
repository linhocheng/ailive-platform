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

const GEMINI_MODEL = 'gemini-2.5-flash';  // 2.0-flash 對新帳號停用，改用 2.5-flash
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

// ──────────────────────────────────────────────────────────────
// Vision：看身份照判角度，回填 generate-image 的 selectBestRef 用的 token
// token 必須跟 generate-image.ts 的 ANGLE/FRAMING/EXPRESSION_KEYWORDS 完全對齊，
// 否則回填了也選不到（兩份即是零份）。
// ──────────────────────────────────────────────────────────────
export interface RefClassification {
  angle: string;       // front | side | 3/4 | back | down | up | dynamic
  framing: string;     // full | half | 7/10 | closeup
  expression: string;  // happy | angry | calm | coquettish
}

const VALID_ANGLE = ['front', 'side', '3/4', 'back', 'down', 'up', 'dynamic'];
const VALID_FRAMING = ['full', 'half', '7/10', 'closeup'];
const VALID_EXPRESSION = ['happy', 'angry', 'calm', 'coquettish'];

/**
 * 下載圖片 URL → base64 + mimeType（vision 用）
 */
async function fetchImageBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return {
      data: Buffer.from(buf).toString('base64'),
      mimeType: res.headers.get('content-type') || 'image/jpeg',
    };
  } catch {
    return null;
  }
}

/**
 * 看一張身份照，分類成 angle/framing/expression。
 * 失敗回 null（呼叫端決定要不要留 angle:''）。
 */
export async function classifyRefImage(url: string): Promise<RefClassification | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const img = await fetchImageBase64(url);
  if (!img) return null;

  const prompt = `You are classifying a character reference photo for an image-generation pipeline. Look at the person in the image and answer with ONLY a JSON object, no markdown, no explanation:
{"angle":"<one of: front, side, 3/4, back, down, up, dynamic>","framing":"<one of: full, half, 7/10, closeup>","expression":"<one of: happy, angry, calm, coquettish>"}
Rules:
- angle = head/body orientation. front=facing camera, side=profile, 3/4=three-quarter turn, back=from behind, down=looking down, up=looking up, dynamic=jumping/action.
- framing = how much of the body is in frame. full=full body, half=waist up, 7/10=knees up, closeup=face/portrait only.
- expression = facial expression. Pick the closest of happy/angry/calm/coquettish; if neutral, use calm.`;

  try {
    const res = await fetch(
      `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inlineData: { mimeType: img.mimeType, data: img.data } },
            { text: prompt },
          ] }],
          generationConfig: { maxOutputTokens: 100, temperature: 0 },
        }),
      },
    );
    if (!res.ok) {
      console.warn(`[gemini-client] classify ${res.status}`);
      return null;
    }
    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<RefClassification>;

    const angle = VALID_ANGLE.includes(String(parsed.angle)) ? String(parsed.angle) : 'front';
    const framing = VALID_FRAMING.includes(String(parsed.framing)) ? String(parsed.framing) : '';
    const expression = VALID_EXPRESSION.includes(String(parsed.expression)) ? String(parsed.expression) : 'calm';
    return { angle, framing, expression };
  } catch (e) {
    console.warn('[gemini-client] classify failed:', e);
    return null;
  }
}
