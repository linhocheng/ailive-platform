/**
 * grok-imagine-image — xAI 生圖引擎
 *
 * 單 ref   → /images/edits（單張，臉部鎖定）
 * 多 ref   → /images/edits（多張，images[]，臉 + 產品圖同時送入）
 * 無 ref   → /images/generations（純文字）
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
  referenceImageUrl: string | null,       // 臉的 ref（characterSheet）
  storagePath: string = 'platform-images/grok',
  productImageUrl?: string,               // 產品圖（知識庫 imageUrl）
): Promise<GrokImageResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY 未設定');

  let tempUrl: string;

  if (referenceImageUrl && productImageUrl) {
    // ===== 多圖 edits：臉 + 產品圖 =====
    // 第一張 = 臉的參考照，第二張 = 產品圖
    // prompt 明確指示 Grok 角色分工
    const multiPrompt = `${prompt}. Use the face, hair, and skin tone from the FIRST reference image for the person. Use the product/clothing appearance from the SECOND reference image for the outfit or item.`;

    const body = {
      model: GROK_IMAGE_MODEL,
      prompt: multiPrompt,
      images: [
        { url: referenceImageUrl, type: 'image_url' },  // 臉（index 0）
        { url: productImageUrl,   type: 'image_url' },  // 產品（index 1）
      ],
    };

    const res = await fetch(`${GROK_BASE}/images/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Grok multi-image edit error ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    tempUrl = data?.data?.[0]?.url;
    if (!tempUrl) throw new Error('Grok 沒有回傳圖片 URL（multi-edits）');

  } else if (referenceImageUrl) {
    // ===== 單圖 edits：只有臉的 ref =====
    const body = {
      model: GROK_IMAGE_MODEL,
      prompt,
      image: { url: referenceImageUrl, type: 'image_url' },
    };

    const res = await fetch(`${GROK_BASE}/images/edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
    // ===== 純文字生圖 =====
    const body = { model: GROK_IMAGE_MODEL, prompt };

    const res = await fetch(`${GROK_BASE}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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

  // 臨時 URL → Firebase Storage（永久）
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

  return { imageUrl: `https://storage.googleapis.com/${bucket.name}/${finalPath}`, model: GROK_IMAGE_MODEL };
}
