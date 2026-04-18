/**
 * /api/strategist-review — 謀師自動審核引擎
 * POST { postId, authorCharacterId }
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding } from '@/lib/embeddings';
import { trackCost } from '@/lib/cost-tracker';

export const maxDuration = 60;

function getTaipeiDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

export async function POST(req: NextRequest) {
  try {
    const { postId, authorCharacterId } = await req.json();
    if (!postId || !authorCharacterId) {
      return NextResponse.json({ error: 'postId, authorCharacterId 必填' }, { status: 400 });
    }

    const db = getFirestore();

    // 1. 讀草稿
    const postDoc = await db.collection('platform_posts').doc(postId).get();
    if (!postDoc.exists) return NextResponse.json({ skipped: '草稿不存在' });
    const post = postDoc.data()!;
    if (post.status !== 'draft') return NextResponse.json({ skipped: '非草稿狀態' });

    // 2. 從配對表找負責 post_review 的謀師
    const assignmentDoc = await db.collection('platform_assignments')
      .doc(`${authorCharacterId}_post_review`)
      .get();

    if (!assignmentDoc.exists) return NextResponse.json({ skipped: '此角色沒有配對 post_review 謀師' });

    const strategistId = String(assignmentDoc.data()?.strategistId || '');
    if (!strategistId) return NextResponse.json({ skipped: '配對記錄無效' });

    const strategistDoc = await db.collection('platform_characters').doc(strategistId).get();
    if (!strategistDoc.exists) return NextResponse.json({ skipped: '謀師不存在' });

    const strategist = { id: strategistId, ...strategistDoc.data() } as Record<string, unknown>;

    // 3. 讀作者名稱
    const authorDoc = await db.collection('platform_characters').doc(authorCharacterId).get();
    const authorName = authorDoc.exists ? String(authorDoc.data()?.name || '角色') : '角色';

    // 4. 謀師靈魂
    const strategistSoul = String(
      strategist.soul_core || strategist.enhancedSoul || strategist.system_soul || ''
    ).slice(0, 800);

    // 5. 呼叫 Claude Haiku 審核
    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const client = new Anthropic({ apiKey });

    const systemPrompt = `${strategistSoul}

你是這個生態系的謀師。${authorName} 寫了一篇發文草稿，你要：
1. 審核內容是否符合角色定位與品牌方向
2. 若有需要，給出修改後的完整文案
3. 給 ${authorName} 一句簡短指導

嚴格只回傳 JSON，不要有任何其他文字：
{"review":"ok"|"revised","revised_content":"完整文案","guidance":"指導（20字內）"}`;

    const userPrompt = `${authorName} 的發文草稿：\n主題：${String(post.topic || '未命名')}\n\n${String(post.content || '')}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    await trackCost(
      strategist.id as string,
      'claude-haiku-4-5-20251001',
      response.usage.input_tokens,
      response.usage.output_tokens,
    ).catch(() => {});

    // 6. 解析結果
    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    let result: { review: string; revised_content: string; guidance: string };
    try {
      result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      console.warn('[strategist-review] JSON 解析失敗：', raw.slice(0, 100));
      return NextResponse.json({ skipped: 'JSON 解析失敗' });
    }

    // 7. 更新草稿
    if (result.review === 'revised' && result.revised_content) {
      await db.collection('platform_posts').doc(postId).update({
        content: result.revised_content,
        reviewedBy: strategist.id as string,
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      await db.collection('platform_posts').doc(postId).update({
        reviewedBy: strategist.id as string,
        reviewedAt: new Date().toISOString(),
      });
    }

    // 8. 存指導記憶
    if (result.guidance) {
      const embedding = await generateEmbedding(`謀師指導 ${result.guidance}`);
      await db.collection('platform_insights').add({
        characterId: authorCharacterId,
        title: '謀師指導',
        content: result.guidance,
        source: 'strategist_review',
        eventDate: getTaipeiDate(),
        tier: 'fresh',
        hitCount: 1,
        lastHitAt: null,
        postId,
        embedding,
        createdAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      review: result.review,
      strategistId: strategist.id,
      guidance: result.guidance,
    });

  } catch (e: unknown) {
    console.error('[strategist-review] 錯誤：', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
