/**
 * generateImageForCharacter — 可複用的生圖邏輯
 * 供 /api/image/generate 和 /api/dialogue 直接 import，避免 server-to-server HTTP 呼叫
 */
import { getFirestore, getFirebaseAdmin } from '@/lib/firebase-admin';
import { generateWithGemini } from '@/lib/gemini-imagen';

export interface GenerateImageResult {
  imageUrl: string;
  model: string;
}

export async function generateImageForCharacter(
  characterId: string,
  prompt: string,
): Promise<GenerateImageResult> {
  const db = getFirestore();
  const charDoc = await db.collection('platform_characters').doc(characterId).get();
  if (!charDoc.exists) throw new Error('角色不存在');

  const char = charDoc.data()!;
  const characterSheet = char.visualIdentity?.characterSheet || '';
  const imagePromptPrefix = char.visualIdentity?.imagePromptPrefix || '';
  const negativePrompt = char.visualIdentity?.negativePrompt || 'different face, inconsistent features';

  // 組合 prompt（imagePromptPrefix 必須英文）
  const hasChineseInPrefix = /[\u4e00-\u9fff]/.test(imagePromptPrefix);
  const prefix = hasChineseInPrefix ? '' : imagePromptPrefix;
  const finalPrompt = [prefix, prompt, `Negative: ${negativePrompt}`]
    .filter(Boolean).join('. ');

  const storagePath = `platform-images/${characterId}`;

  if (characterSheet) {
    // 有 ref 圖 → Gemini multimodal 鎖臉
    return generateWithGemini(finalPrompt, characterSheet, storagePath);
  }

  // 沒有 ref 圖 → Gemini text-only
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 未設定');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
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

  return { imageUrl, model: 'gemini-2.5-flash-image' };
}
