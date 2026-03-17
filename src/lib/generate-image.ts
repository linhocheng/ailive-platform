/**
 * generateImageForCharacter — 平台生圖核心邏輯
 *
 * 功能：
 * 1. 多維度 ref 選圖（angle/framing/expression 三維評分）
 * 2. 中文 prompt 自動翻英文（角色說中文，Gemini 吃英文更準）
 * 3. 有 characterSheet → Gemini multimodal 鎖臉生圖
 * 4. 無 characterSheet → Gemini text-only 生圖
 *
 * 設計原則：
 * - 這個 lib 是可複用模組，不依賴任何 route handler
 * - 所有 route 直接 import，不走 HTTP 呼叫（Vercel server-to-server 禁忌）
 */
import { getFirestore, getFirebaseAdmin } from '@/lib/firebase-admin';
import { generateWithGemini } from '@/lib/gemini-imagen';

export interface GenerateImageResult {
  imageUrl: string;
  model: string;
  selectedRef?: string;       // 實際使用的 ref URL
  usedAngle?: string;         // 選中的角度
  promptTranslated?: boolean; // 是否有翻譯過
}

// ===== 角度/構圖/表情 關鍵字映射 =====
const ANGLE_KEYWORDS: Record<string, string[]> = {
  side:    ['side', 'profile', '側臉', '側身', '側面', '看窗', 'looking away', 'turned'],
  '3/4':   ['three quarter', '3/4', '斜角', '45度', 'three-quarter'],
  back:    ['back', 'behind', '背影', '背面', 'from behind', 'walking away'],
  down:    ['looking down', '低頭', '俯', 'downward', 'head down'],
  up:      ['looking up', '抬頭', '仰', 'upward', 'head up'],
  dynamic: ['jump', 'jumping', '跳躍', '跳起', 'leap', 'action', 'dynamic', 'running', '跑'],
  front:   ['facing', 'front', '正面', '對鏡', 'direct', 'close-up', 'selfie', '自拍'],
};

const FRAMING_KEYWORDS: Record<string, string[]> = {
  full:    ['full body', '全身', 'full-body', 'whole body', 'standing'],
  half:    ['half body', '半身', 'waist up', 'upper body', 'bust'],
  '7/10':  ['medium shot', '七分', '7分', 'medium close'],
  closeup: ['close up', 'closeup', '特寫', 'face only', 'portrait'],
};

const EXPRESSION_KEYWORDS: Record<string, string[]> = {
  happy:      ['happy', 'smile', '開心', '微笑', '笑', 'joy', 'cheerful', 'excited'],
  angry:      ['angry', 'mad', '生氣', '憤怒', 'fierce', 'intense'],
  calm:       ['calm', 'cool', '穩定', '冷靜', 'neutral', 'serious'],
  coquettish: ['撒嬌', 'coquettish', 'cute', '可愛', 'sweet', 'charming'],
};

interface RefImage {
  url: string;
  angle: string;
  framing?: string;
  expression?: string;
  name?: string;
}

/**
 * 從 refs 列表中，根據 prompt 關鍵字三維評分選出最合適的 ref
 * angle=3分，framing=2分，expression=1分
 * 全 0 分 → fallback PRIMARY（characterSheet）
 */
function selectBestRef(refs: RefImage[], prompt: string, fallback: string): string {
  if (!refs || refs.length === 0) return fallback;

  const pLower = prompt.toLowerCase();
  const scored = refs.map(r => {
    let score = 0;
    const angleKws = ANGLE_KEYWORDS[r.angle] || [];
    if (angleKws.some(kw => pLower.includes(kw))) score += 3;
    const framingKws = FRAMING_KEYWORDS[r.framing || ''] || [];
    if (framingKws.some(kw => pLower.includes(kw))) score += 2;
    const exprKws = EXPRESSION_KEYWORDS[r.expression || ''] || [];
    if (exprKws.some(kw => pLower.includes(kw))) score += 1;
    return { ref: r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > 0 ? scored[0].ref.url : fallback;
}

/**
 * 偵測中文，用 Claude Haiku 翻譯成英文 prompt
 * 中文送 Gemini 會稀釋角色描述，臉部一致性下降
 */
async function translateToEnglish(text: string, apiKey: string): Promise<{ text: string; translated: boolean }> {
  const hasChinese = /[\u4e00-\u9fff]/.test(text);
  if (!hasChinese) return { text, translated: false };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Translate this image generation prompt to English. Output ONLY the translated prompt, nothing else:\n\n${text}`,
        }],
      }),
    });
    const d = await res.json();
    const translated = d?.content?.[0]?.text?.trim() || text;
    return { text: translated, translated: true };
  } catch {
    return { text, translated: false }; // 翻譯失敗不阻斷生圖
  }
}

// ===== 主函式 =====
export async function generateImageForCharacter(
  characterId: string,
  rawPrompt: string,
): Promise<GenerateImageResult> {
  const db = getFirestore();
  const charDoc = await db.collection('platform_characters').doc(characterId).get();
  if (!charDoc.exists) throw new Error('角色不存在');

  const char = charDoc.data()!;
  const vi = char.visualIdentity as {
    characterSheet?: string;
    imagePromptPrefix?: string;
    negativePrompt?: string;
    refs?: RefImage[];
  } | undefined;

  const characterSheet = vi?.characterSheet || '';
  const imagePromptPrefix = vi?.imagePromptPrefix || '';
  const negativePrompt = vi?.negativePrompt || 'different face, inconsistent features';
  const refs = vi?.refs || [];

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error('GEMINI_API_KEY 未設定');

  // 1. 翻譯中文 prompt
  const { text: englishPrompt, translated } = await translateToEnglish(rawPrompt, apiKey);

  // 2. 組合最終 prompt
  const hasChineseInPrefix = /[\u4e00-\u9fff]/.test(imagePromptPrefix);
  const prefix = hasChineseInPrefix ? '' : imagePromptPrefix;
  const faceLock = characterSheet
    ? "Keep the subject's face, hair, skin tone, and facial features identical to the reference photo. Do not alter the face."
    : '';

  const finalPrompt = [prefix, englishPrompt, faceLock, `Negative: ${negativePrompt}`]
    .filter(Boolean).join('. ');

  const storagePath = `platform-images/${characterId}`;

  if (characterSheet) {
    // 3. 多維度選圖
    const selectedRef = selectBestRef(refs, rawPrompt, characterSheet);
    const usedRef = refs.find(r => r.url === selectedRef);

    // 4. Gemini multimodal 鎖臉
    const result = await generateWithGemini(finalPrompt, selectedRef, storagePath);
    return {
      imageUrl: result.imageUrl,
      model: result.model,
      selectedRef,
      usedAngle: usedRef?.angle,
      promptTranslated: translated,
    };
  }

  // 5. 沒有 ref → Gemini text-only
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: finalPrompt }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini 生圖失敗：${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const imgPart = data.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData
  );
  if (!imgPart?.inlineData?.data) throw new Error('Gemini 沒有回傳圖片');

  const admin = getFirebaseAdmin();
  const bucket = admin.storage().bucket();
  const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
  const mimeType = imgPart.inlineData.mimeType || 'image/jpeg';
  const ext = mimeType.split('/')[1] || 'jpg';
  const filePath = `${storagePath}/${Date.now()}.${ext}`;
  const file = bucket.file(filePath);
  await file.save(new Uint8Array(imgBuffer), { metadata: { contentType: mimeType } });
  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

  return { imageUrl, model: 'gemini-2.5-flash-image', promptTranslated: translated };
}

/**
 * buildGenerateImageDescription — 動態組 generate_image tool description
 * 把角色的 refs 清單注入 tool description，讓 Claude 知道有哪些角度可用
 * 在 dialogue route 組裝 tools 時呼叫
 */
export function buildGenerateImageDescription(refs: RefImage[]): string {
  const base = '心裡浮現畫面就畫。描述用英文更精準。如果畫面裡有妳自己出現，不需要特別說——妳的臉已在系統裡，會自動帶著。';

  if (!refs || refs.length === 0) return base;

  const refsDesc =
    `\n\n妳現在有 ${refs.length} 張不同角度的參考照片：\n` +
    refs.map((r, i) =>
      `  ${i + 1}. ${r.name || r.angle}（角度:${r.angle} 構圖:${r.framing || '?'} 表情:${r.expression || '?'}）`
    ).join('\n') +
    '\n\n系統會根據 prompt 自動選最合適的那張。想要特定角度就在描述裡說（如 "side profile"、"full body"）。沒有的角度（如背面）可以主動說明。';

  return base + refsDesc;
}
