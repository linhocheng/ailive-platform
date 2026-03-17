/**
 * /api/knowledge — platform_knowledge CRUD + 語義搜尋
 *
 * GET  ?characterId=xxx&type=query&q=xxx → 語義搜尋（hitCount+1）
 * GET  ?characterId=xxx                  → 列表
 * POST { characterId, title, content, category } → 新增
 * DELETE ?id=xxx → 刪除
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';

export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const characterId = req.nextUrl.searchParams.get('characterId');
    const type = req.nextUrl.searchParams.get('type');
    const q = req.nextUrl.searchParams.get('q');
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20');

    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    // 語義搜尋
    if (type === 'query' && q) {
      const queryEmbedding = await generateEmbedding(q);
      const snap = await db.collection('platform_knowledge')
        .where('characterId', '==', characterId)
        .limit(100)
        .get();

      const results = snap.docs
        .map(d => {
          const data = d.data();
          const score = data.embedding ? cosineSimilarity(queryEmbedding, data.embedding) : 0;
          return { id: d.id, ...data, score };
        })
        .filter(r => r.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      // hitCount +1
      const batch = db.batch();
      results.forEach(r => {
        batch.update(db.collection('platform_knowledge').doc(r.id), {
          hitCount: FieldValue.increment(1),
        });
      });
      if (results.length > 0) await batch.commit();

      return NextResponse.json({ knowledge: results, query: q });
    }

    // 列表
    const snap = await db.collection('platform_knowledge')
      .where('characterId', '==', characterId)
      .limit(limit)
      .get();

    const knowledge = snap.docs
      .map(d => { const data = d.data(); delete data.embedding; return { id: d.id, ...data } as Record<string, unknown>; })
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
        return tb - ta;
      });

    return NextResponse.json({ knowledge, total: snap.size });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, title, content, category } = await req.json();

    if (!characterId || !content) {
      return NextResponse.json({ error: 'characterId, content 必填' }, { status: 400 });
    }

    const embedding = await generateEmbedding(`${title || ''} ${content}`);
    const now = new Date().toISOString();

    // 自動生成 summary（15字以內，常駐注入用）
    // 天命不是說明書，一句話說清楚核心觀點
    let summary = title || content.slice(0, 15);
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const apiKey = process.env.ANTHROPIC_API_KEY || '';
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 40,
        messages: [{
          role: 'user',
          content: `用15字以內總結以下知識的核心觀點，用第一人稱，像角色自己說的一句話：

標題：${title}
內容：${content.slice(0,200)}

只輸出那句話，不要其他文字。`,
        }],
      });
      summary = (res.content[0] as { text: string }).text.trim().slice(0, 30);
    } catch { /* 生成失敗用 title 代替 */ }

    const docRef = await db.collection('platform_knowledge').add({
      characterId,
      title: title || '',
      content,
      summary,                    // 15字核心觀點，常駐注入用
      category: category || 'general',
      hitCount: 100,              // 天命初始值高，永遠優先於後天 insights
      tier: 'native',             // 原生天命，不參與升降級，不被蒸餾
      embedding,
      createdAt: now,
    });

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = getFirestore();
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });

    await db.collection('platform_knowledge').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
