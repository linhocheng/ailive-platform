/**
 * grok-imagine-image — xAI 生圖引擎
 *
 * 有 ref → 圖片編輯模式（POST /v1/images/edits，image_url 傳入）
 * 無 ref → 文字生圖模式（POST /v1/images/generations）
 *
 * 回傳 URL（臨時），立刻下載後存進 Firebase Storage。
 */
import { generateImagePath } from '@/lib/image-storage';
import { getFirebaseAdmin } from '@/lib/firebase-admin';

const GROK_IMAGE_MODEL = 'grok-imagine-image';
const GROK_BASE = 'https://api.x.ai/v1';

export interface GrokImageResult {
  imageUrl: string;
  model: string;
}

export async function generateWithGrok(
  prompt: string,
  referenceImageUrl: string | null,
  storagePath: string = 'platform-images/grok',
): Promise<GrokImageResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY 未設定');

  let tempUrl: string;

  if (referenceImageUrl) {
    // 圖片編輯模式（鎖臉）
    const body = {
      model: GROK_IMAGE_MODEL,
      prompt,
      image: {
        url: referenceImageUrl,
        type: 'image_url',
      },
    };

    const res = await fetch(`${GROK_BASE}/images/edits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Grok image edit error ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    tempUrl = data?.data?.[0]?.url;
    if (!tempUrl) throw new Error('Grok 沒有回傳圖片 URL（edits）');
  } else {
    // 純文字生圖
    const body = {
      model: GROK_IMAGE_MODEL,
      prompt,
    };

    const res = await fetch(`${GROK_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Grok image generation error ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    tempUrl = data?.data?.[0]?.url;
    if (!tempUrl) throw new Error('Grok 沒有回傳圖片 URL（generations）');
  }

  // Grok 回傳臨時 URL，立刻下載存進 Firebase Storage
  const imgRes = await fetch(tempUrl);
  if (!imgRes.ok) throw new Error(`Grok 圖片下載失敗：${imgRes.status}`);

  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const finalPath = generateImagePath(storagePath).replace(/\.[^.]+$/, `.${ext}`);

  const admin = getFirebaseAdmin();
  const bucket = admin.storage().bucket();
  const file = bucket.file(finalPath);
  await file.save(imgBuffer, { metadata: { contentType } });
  await file.makePublic();

  const imageUrl = `https://storage.googleapis.com/${bucket.name}/${finalPath}`;
  return { imageUrl, model: GROK_IMAGE_MODEL };
}
