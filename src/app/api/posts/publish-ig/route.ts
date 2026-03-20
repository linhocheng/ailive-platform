/**
 * POST /api/posts/publish-ig
 * Body: { postId: string }
 *
 * 1. 讀 post（需有 imageUrl + content）
 * 2. 讀 character 的 igAccessToken + igUserId
 * 3. 呼叫 publishPhoto()
 * 4. 成功 → PATCH post status = 'published'，存 igPostId
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { publishPhoto } from '@/lib/instagram-api';

export async function POST(req: NextRequest) {
  try {
    const { postId } = await req.json();
    if (!postId) return NextResponse.json({ error: 'postId 必填' }, { status: 400 });

    const db = getFirestore();

    // 1. 讀 post
    const postDoc = await db.collection('platform_posts').doc(postId).get();
    if (!postDoc.exists) return NextResponse.json({ error: '找不到貼文' }, { status: 404 });
    const post = postDoc.data()!;

    if (!post.imageUrl) {
      return NextResponse.json({ error: '此貼文沒有圖片，無法發到 IG' }, { status: 400 });
    }

    // 2. 讀 character 的 IG 憑證
    const charDoc = await db.collection('platform_characters').doc(post.characterId).get();
    if (!charDoc.exists) return NextResponse.json({ error: '找不到角色' }, { status: 404 });
    const char = charDoc.data()!;

    const { igAccessToken, igUserId } = char;
    if (!igAccessToken || !igUserId) {
      return NextResponse.json({ error: 'IG 通路尚未設定，請至身份頁填入 Access Token 和 User ID' }, { status: 400 });
    }

    // 3. 發佈到 IG
    const result = await publishPhoto(igUserId, igAccessToken, post.imageUrl, post.content || '');

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    // 4. 更新 post 狀態
    await db.collection('platform_posts').doc(postId).update({
      status: 'published',
      igPostId: result.ig_post_id,
      publishedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, ig_post_id: result.ig_post_id });
  } catch (err) {
    console.error('[publish-ig]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
