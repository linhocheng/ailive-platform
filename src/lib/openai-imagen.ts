/**
 * Gemini 3.1 Flash Image Preview — 生圖核心
 *
 * 三條路：
 * 1. 有 refs → generateContent with inlineData parts
 * 2. 無 refs → generateContent with text only
 * 3. generateWithGeminiRefs（specialist 模式）→ 同上，有 refs 走 inlineData
 *
 * 回傳 shape 與原 GeminiImageResult 相同，呼叫端無感。
 */
import { generateImagePath } from '@/lib/image-storage';
import { getFirebaseAdmin } from '@/lib/firebase-admin';

const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiImageResult {
  imageUrl: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface RefImageData {
  data: string;      // base64
  mimeType: string;
  sourceUrl: string;
}

async function urlToBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`圖片下載失敗 ${res.status}: ${url}`);
  const buffer = await res.arrayBuffer();
  const mimeType = res.headers.get('content-type') || 'image/jpeg';
  return { data: Buffer.from(buffer).toString('base64'), mimeType };
}

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

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 未設定');
  return key;
}

async function callGeminiImage(parts: object[], apiKey: string): Promise<{ b64: string; mimeType: string }> {
  const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });
  if (!res.ok) throw new Error(`Gemini Image error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const responseParts: { inlineData?: { data: string; mimeType: string }; text?: string }[] =
    data?.candidates?.[0]?.content?.parts || [];
  const imgPart = responseParts.find(p => p.inlineData);
  if (!imgPart?.inlineData) throw new Error('Gemini 沒有回傳圖片');
  return { b64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType || 'image/png' };
}

export async function generateWithGemini(
  prompt: string,
  faceRefUrl: string | null,
  storagePath: string = 'platform-images/gemini',
  productImageUrl?: string,
): Promise<GeminiImageResult> {
  const apiKey = getApiKey();
  const parts: object[] = [];

  if (faceRefUrl || productImageUrl) {
    const urls = [faceRefUrl, productImageUrl].filter(Boolean) as string[];
    for (const u of urls) {
      const { data, mimeType } = await urlToBase64(u);
      parts.push({ inlineData: { data, mimeType } });
    }
  }
  parts.push({ text: prompt });

  const { b64, mimeType } = await callGeminiImage(parts, apiKey);
  const imageUrl = await persistBase64(b64, mimeType, storagePath);
  return { imageUrl, model: GEMINI_IMAGE_MODEL, inputTokens: 0, outputTokens: 0 };
}

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

export async function generateWithGeminiRefs(
  prompt: string,
  refs: RefImageData[],
  storagePath: string = 'platform-images/gemini',
): Promise<GeminiImageResult> {
  const apiKey = getApiKey();
  const parts: object[] = [
    ...refs.map(r => ({ inlineData: { data: r.data, mimeType: r.mimeType } })),
    { text: prompt },
  ];
  const { b64, mimeType } = await callGeminiImage(parts, apiKey);
  const imageUrl = await persistBase64(b64, mimeType, storagePath);
  return { imageUrl, model: GEMINI_IMAGE_MODEL, inputTokens: 0, outputTokens: 0 };
}
