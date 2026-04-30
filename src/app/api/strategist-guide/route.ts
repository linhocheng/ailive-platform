/**
 * /api/strategist-guide — 謀師成長引導引擎
 *
 * POST { insightId, authorCharacterId }
 *
 * 角色寫入新記憶時觸發（growth_guide 事件）
 * 謀師讀取記憶內容 → 給一句引導 → 存進角色記憶
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding } from '@/lib/embeddings';
import { trackCost } from '@/lib/cost-tracker';

export const maxDuration = 60;

function getTaipeiDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

export async function POST(req: NextRequest) {
  try {
    const { insightId, authorCharacterId } = await req.json();
    if (!insightId || !authorCharacterId) {
      return NextResponse.json({ error: 'insightId, authorCharacterId 必填' }, { status: 400 });
    }

    const db = getFirestore();

    // 1. 從配對表找負責 growth_guide 的謀師
    const assignmentDoc = await db.collection('platform_assignments')
      .doc(`${authorCharacterId}_growth_guide`)
      .get();

    if (!assignmentDoc.exists) return NextResponse.json({ skipped: '此角色沒有配對 growth_guide 謀師' });

    const strategistId = String(assignmentDoc.data()?.strategistId || '');
    if (!strategistId) return NextResponse.json({ skipped: '配對記錄無效' });

    const strategistDoc = await db.collection('platform_characters').doc(strategistId).get();
    if (!strategistDoc.exists) return NextResponse.json({ skipped: '謀師不存在' });

    const strategist = { id: strategistId, ...strategistDoc.data() } as Record<string, unknown>;

    // 2. 讀新記憶
    const insightDoc = await db.collection('platform_insights').doc(insightId).get();
    if (!insightDoc.exists) return NextResponse.json({ skipped: '記憶不存在' });
    const insight = insightDoc.data()!;

    // 3. 讀作者名稱
    const authorDoc = await db.collection('platform_characters').doc(authorCharacterId).get();
    const authorName = authorDoc.exists ? String(authorDoc.data()?.name || '角色') : '角色';

    // 4. 謀師靈魂
    const strategistSoul = String(
      strategist.soul_core || strategist.enhancedSoul || strategist.system_soul || ''
    ).slice(0, 800);

    // 5. 呼叫 Claude Haiku
    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const client = getAnthropicClient(apiKey);

    const systemPrompt = `${strategistSoul}

你是這個生態系的謀師。${authorName} 剛寫下一條新的洞察或記憶，你要：
1. 讀懂這條記憶的深層意義
2. 給 ${authorName} 一句引導——幫助他更深入理解自己，或者往更好的方向成長
3. 不改記憶內容，只給方向

嚴格只回傳 JSON，不要有任何其他文字：
{"guidance":"給 ${authorName} 的引導（30字內，溫暖有穿透力）"}`;

    const userPrompt = `${authorName} 寫下的新洞察：\n\n標題：${String(insight.title || '')}\n內容：${String(insight.content || '')}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    await trackCost(
      strategistId,
      'claude-haiku-4-5-20251001',
      response.usage.input_tokens,
      response.usage.output_tokens,
    ).catch(() => {});

    // 6. 解析結果
    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    let result: { guidance: string };
    try {
      result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      console.warn('[strategist-guide] JSON 解析失敗：', raw.slice(0, 100));
      return NextResponse.json({ skipped: 'JSON 解析失敗' });
    }

    // 7. 存引導記憶進角色
    if (result.guidance) {
      const embedding = await generateEmbedding(`謀師引導 ${result.guidance}`);
      await db.collection('platform_insights').add({
        characterId: authorCharacterId,
        title: '謀師引導',
        content: result.guidance,
        source: 'strategist_guide',
        eventDate: getTaipeiDate(),
        tier: 'fresh',
        hitCount: 1,
        lastHitAt: null,
        insightId,
        embedding,
        createdAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      strategistId,
      guidance: result.guidance,
    });

  } catch (e: unknown) {
    console.error('[strategist-guide] 錯誤：', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
