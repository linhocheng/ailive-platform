/**
 * POST /api/posts/regenerate-image
 * 重新生成草稿的圖片
 * 
 * Body: { postId, imagePrompt? }
 * - 如果傳了 imagePrompt → 用新的 prompt 生圖，同時更新草稿的 imagePrompt
 * - 如果沒傳 → 用草稿現有的 imagePrompt 生圖
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { generateImageForCharacter } from '@/lib/generate-image';

export const maxDuration = 120; // 生圖可能需要較長時間

export async function POST(req: NextRequest) {
  try {
    const { postId, imagePrompt: newImagePrompt } = await req.json();
    
    if (!postId) {
      return NextResponse.json({ success: false, error: '缺少 postId' }, { status: 400 });
    }

    const db = getFirestore();
    const postRef = db.collection('platform_posts').doc(postId);
    const postDoc = await postRef.get();

    if (!postDoc.exists) {
      return NextResponse.json({ success: false, error: '找不到草稿' }, { status: 404 });
    }

    const post = postDoc.data()!;
    const characterId = post.characterId;
    
    // 決定用哪個 imagePrompt
    const imagePrompt = newImagePrompt?.trim() || post.imagePrompt;
    
    if (!imagePrompt) {
      return NextResponse.json({ 
        success: false, 
        error: '這篇草稿沒有圖片描述（imagePrompt），請先填寫描述再生圖',
        needPrompt: true,
      }, { status: 400 });
    }

    // 生圖
    console.log(`[regenerate-image] 重新生圖 postId=${postId}, prompt="${imagePrompt.slice(0, 50)}..."`);
    const result = await generateImageForCharacter(characterId, imagePrompt);
    
    if (!result.imageUrl) {
      return NextResponse.json({ success: false, error: '生圖失敗，請稍後再試' }, { status: 500 });
    }

    // 更新草稿
    const updates: Record<string, unknown> = { imageUrl: result.imageUrl };
    if (newImagePrompt?.trim()) {
      updates.imagePrompt = newImagePrompt.trim();
    }
    await postRef.update(updates);

    console.log(`[regenerate-image] 成功 postId=${postId}, imageUrl=${result.imageUrl.slice(0, 60)}...`);
    
    return NextResponse.json({ 
      success: true, 
      imageUrl: result.imageUrl,
      model: result.model,
    });
  } catch (e) {
    console.error('[regenerate-image] 錯誤:', e);
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
