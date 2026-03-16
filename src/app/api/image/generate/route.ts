/**
 * /api/image/generate — 生圖 API
 *
 * POST { characterId, prompt, aspectRatio? }
 *
 * 有 characterSheet → Gemini 2.5 Flash Image（臉部鎖定）
 * 沒有 characterSheet → 純文生圖（Gemini text-only，不強制臉部）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { generateWithGemini } from '@/lib/gemini-imagen';

export async function POST(req: NextRequest) {
  try {
    const { characterId, prompt, aspectRatio } = await req.json();

    if (!characterId || !prompt) {
      return NextResponse.json({ error: 'characterId, prompt 必填' }, { status: 400 });
    }

    const db = getFirestore();
    const charDoc = await db.collection('platform_characters').doc(characterId).get();
    if (!charDoc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });

    const char = charDoc.data()!;
    const characterSheet = char.visualIdentity?.characterSheet || '';
    const imagePromptPrefix = char.visualIdentity?.imagePromptPrefix || '';
    const negativePrompt = char.visualIdentity?.negativePrompt || 'different face, inconsistent features';

    // 組合最終 prompt
    // imagePromptPrefix 必須是英文（雷-09），中文會稀釋
    const hasChineseInPrefix = /[\u4e00-\u9fff]/.test(imagePromptPrefix);
    const prefix = hasChineseInPrefix ? '' : imagePromptPrefix; // 有中文就跳過，等未來加翻譯
    const finalPrompt = [prefix, prompt, `Negative: ${negativePrompt}`]
      .filter(Boolean).join('. ');

    const storagePath = `platform-images/${characterId}`;

    if (characterSheet) {
      // 有 ref 圖 → Gemini multimodal 鎖臉
      const result = await generateWithGemini(finalPrompt, characterSheet, storagePath);
      return NextResponse.json({ success: true, imageUrl: result.imageUrl, model: result.model });
    } else {
      // 沒有 ref 圖 → 直接用 Gemini text-only（暫時方案）
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY 未設定' }, { status: 500 });

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

      if (!imgPart?.inlineData?.data) {
        throw new Error('Gemini 沒有回傳圖片');
      }

      // 存 Firebase Storage（用 Admin SDK 直接上傳 base64）
      const { getFirebaseAdmin } = await import('@/lib/firebase-admin');
      const admin = getFirebaseAdmin();
      const bucket = admin.storage().bucket();
      const imgBuffer = Buffer.from(imgPart.inlineData.data, 'base64');
      const mimeType = imgPart.inlineData.mimeType || 'image/jpeg';
      const ext = mimeType.split('/')[1] || 'jpg';
      const filePath = `${storagePath}/${Date.now()}.${ext}`;
      const file = bucket.file(filePath);
      await file.save(new Uint8Array(imgBuffer), { metadata: { contentType: mimeType } });
      const imageUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

      return NextResponse.json({ success: true, imageUrl, model: 'gemini-2.5-flash-image' });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
