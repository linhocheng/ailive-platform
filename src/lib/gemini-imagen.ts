/**
 * Gemini 2.5 Flash Image — 人物一致性生圖
 * 原生 multimodal：直接把 reference 圖丟進去，臉部鎖定穩定性遠優於 Kontext
 */
import { generateImagePath } from '@/lib/image-storage';
import { getFirebaseAdmin } from '@/lib/firebase-admin';

const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

export interface GeminiImageResult {
  imageUrl: string;
  model: string;
}

export async function generateWithGemini(
  prompt: string,
  referenceImageUrl: string,
  storagePath: string = 'saas-images/gemini',
): Promise<GeminiImageResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 未設定');

  // 下載 reference 圖轉 base64
  const refRes = await fetch(referenceImageUrl);
  if (!refRes.ok) throw new Error(`reference 圖下載失敗：${refRes.status}`);
  const refBuffer = await refRes.arrayBuffer();
  const refBase64 = Buffer.from(refBuffer).toString('base64');
  const refMime = refRes.headers.get('content-type') || 'image/jpeg';

  const body = {
    contents: [{
      parts: [
        {
          inlineData: {
            mimeType: refMime,
            data: refBase64,
          },
        },
        {
          text: prompt,
        },
      ],
    }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
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
  const parts = data?.candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      // base64 → Buffer → 上傳 Firebase Storage
      const imgBuffer = Buffer.from(part.inlineData.data, 'base64');
      const mime = part.inlineData.mimeType || 'image/png';
      const ext = mime.includes('png') ? 'png' : 'jpg';

      const finalUrl = await persistImageFromBase64(imgBuffer, generateImagePath(storagePath), mime);
      return { imageUrl: finalUrl, model: 'gemini-2.5-flash-image' };
    }
  }

  throw new Error('Gemini Image 沒有回傳圖片');
}

// base64 buffer 直接上傳 Firebase Storage（用 Firebase Admin SDK，與 image-storage.ts 同一路徑）
async function persistImageFromBase64(
  buffer: Buffer,
  storagePath: string,
  mimeType: string,
): Promise<string> {
  const admin = getFirebaseAdmin();
  const bucket = admin.storage().bucket();
  const bucketName = bucket.name;

  if (!bucketName || bucketName === 'undefined') {
    throw new Error('Firebase Storage bucket 未設定');
  }

  const file = bucket.file(storagePath);
  await file.save(buffer, { metadata: { contentType: mimeType } });
  await file.makePublic();

  return `https://storage.googleapis.com/${bucketName}/${storagePath}`;
}
