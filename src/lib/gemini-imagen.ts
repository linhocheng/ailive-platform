/**
 * Gemini Flash Image — 人物一致性 + 產品合成生圖
 *
 * 模型：gemini-2.5-flash-image
 *
 * 三條路：
 * 1. 臉 ref + 產品圖 → 多圖合成（Character Consistency + Object Fidelity）
 * 2. 只有臉 ref     → 單圖 multimodal editing（鎖臉）
 * 3. 無 ref         → 純文字生圖
 *
 * Gemini 原生 multimodal：多張圖丟進 parts[]，prompt 說清楚各圖角色。
 */
import { generateImagePath } from '@/lib/image-storage';
import { getFirebaseAdmin } from '@/lib/firebase-admin';

const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

export interface GeminiImageResult {
  imageUrl: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * 下載圖片 URL → base64 + mimeType
 */
async function urlToBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`圖片下載失敗 ${res.status}: ${url}`);
  const buffer = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type') || 'image/jpeg';
  const data = Buffer.from(buffer).toString('base64');
  return { data, mimeType };
}

/**
 * 儲存 base64 圖片到 Firebase Storage，回傳永久 URL
 */
async function persistBase64(base64: string, mimeType: string, storagePath: string): Promise<string> {
  const admin = getFirebaseAdmin();
  const bucket = admin.storage().bucket();
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const finalPath = generateImagePath(storagePath).replace(/\.[^.]+$/, `.${ext}`);
  const file = bucket.file(finalPath);
  await file.save(Buffer.from(base64, 'base64'), { metadata: { contentType: mimeType } });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${finalPath}`;
}

export async function generateWithGemini(
  prompt: string,
  faceRefUrl: string | null,        // 臉的 ref（characterSheet）
  storagePath: string = 'platform-images/gemini',
  productImageUrl?: string,          // 產品圖（知識庫 imageUrl，選填）
): Promise<GeminiImageResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 未設定');

  const parts: unknown[] = [];

  if (faceRefUrl && productImageUrl) {
    // ===== 多圖：臉 + 產品合成 =====
    const [face, product] = await Promise.all([
      urlToBase64(faceRefUrl),
      urlToBase64(productImageUrl),
    ]);

    const multiPrompt = `${prompt}. The FIRST image shows the character's face — keep their face, hair, and skin tone identical. The SECOND image shows the product/clothing — replicate its exact appearance, color, and details on the character.`;

    parts.push(
      { inlineData: { mimeType: face.mimeType, data: face.data } },
      { inlineData: { mimeType: product.mimeType, data: product.data } },
      { text: multiPrompt },
    );

  } else if (faceRefUrl) {
    // ===== 單圖：只鎖臉 =====
    const face = await urlToBase64(faceRefUrl);
    const faceLock = "Keep the subject's face, hair, skin tone, and facial features identical to the reference photo.";
    parts.push(
      { inlineData: { mimeType: face.mimeType, data: face.data } },
      { text: `${prompt}. ${faceLock}` },
    );

  } else {
    // ===== 純文字生圖 =====
    parts.push({ text: prompt });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  };

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini Image error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData
  );
  if (!imgPart?.inlineData?.data) throw new Error('Gemini 沒有回傳圖片');

  const imageUrl = await persistBase64(imgPart.inlineData.data, imgPart.inlineData.mimeType || 'image/jpeg', storagePath);
  const usage = data?.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
  return {
    imageUrl,
    model: GEMINI_IMAGE_MODEL,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}

// ──────────────────────────────────────────────────────────────
// Specialist 用：多圖並行下載（容錯）+ 無語義 hint 的 refs 生圖
// @author 築 · Phase 2 · C 方案（讓瞬自己看圖決定角色）
// ──────────────────────────────────────────────────────────────

export interface RefImageData {
  data: string;      // base64
  mimeType: string;
  sourceUrl: string; // 原 URL（log/debug 用）
}

/**
 * 並行下載多張參考圖 → base64
 * 失敗的跳過不拋錯，把 successful/failed 都回傳給呼叫端決策
 */
export async function downloadRefsBase64(
  urls: string[],
): Promise<{ successful: RefImageData[]; failed: string[] }> {
  if (!urls.length) return { successful: [], failed: [] };
  const results = await Promise.allSettled(
    urls.map(async (url): Promise<RefImageData> => {
      const { data, mimeType } = await urlToBase64(url);
      return { data, mimeType, sourceUrl: url };
    }),
  );
  const successful: RefImageData[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') successful.push(r.value);
    else failed.push(urls[i]);
  });
  return { successful, failed };
}

/**
 * Refs 模式：不加任何 face-lock 語義，按順序把 refs 塞進 Gemini parts[]，prompt 最後。
 *
 * 呼叫前提：prompt 已經由上游（e.g. Sonnet 戴瞬的 soul 動腦後）寫清楚每張圖的角色，
 * 例如 "The first image is style inspiration. The second image is the product..."
 *
 * 專給 specialist/image 這類「讓 AI 自己判斷 refs 角色」的場景使用。
 * 若是 Emily 體系的「人物一致性」請繼續用 generateWithGemini（face-lock 模式）。
 */
export async function generateWithGeminiRefs(
  prompt: string,
  refs: RefImageData[],
  storagePath: string = 'platform-images/gemini',
): Promise<GeminiImageResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 未設定');

  const parts: unknown[] = [];
  for (const ref of refs) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  };

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini Image (refs-mode) error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData,
  );
  if (!imgPart?.inlineData?.data) throw new Error('Gemini 沒有回傳圖片');

  const imageUrl = await persistBase64(
    imgPart.inlineData.data,
    imgPart.inlineData.mimeType || 'image/jpeg',
    storagePath,
  );
  const usage = data?.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
  return {
    imageUrl,
    model: GEMINI_IMAGE_MODEL,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}
