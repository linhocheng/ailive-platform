/**
 * /api/insights — platform_insights CRUD + 語義搜尋
 *
 * GET  ?characterId=xxx&type=query&q=xxx  → 語義搜尋（hitCount+1）
 * GET  ?characterId=xxx                   → 列表
 * POST { characterId, title, content, source, eventDate } → 新增（hitCount 初始 0）
 * PATCH { id, hitCount } → 更新 hitCount
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
      const snap = await db.collection('platform_insights')
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

      // hitCount +1 for matched insights
      const batch = db.batch();
      results.forEach(r => {
        batch.update(db.collection('platform_insights').doc(r.id), {
          hitCount: FieldValue.increment(1),
          lastHitAt: new Date().toISOString(),
        });
      });
      if (results.length > 0) await batch.commit();

      return NextResponse.json({ insights: results, query: q });
    }

    // 列表
    const snap = await db.collection('platform_insights')
      .where('characterId', '==', characterId)
      .limit(limit)
      .get();

    const insights = snap.docs
      .map(d => { const data = d.data(); delete data.embedding; return { id: d.id, ...data } as Record<string, unknown>; })
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
        return tb - ta;
      });

    return NextResponse.json({ insights, total: snap.size });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, title, content, source, eventDate } = await req.json();

    if (!characterId || !content) {
      return NextResponse.json({ error: 'characterId, content 必填' }, { status: 400 });
    }

    const embedding = await generateEmbedding(`${title || ''} ${content}`);
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    const docRef = await db.collection('platform_insights').add({
      characterId,
      title: title || '',
      content,
      source: source || 'manual',
      eventDate: eventDate || today,
      tier: 'fresh',
      hitCount: 0,          // ← 天條：初始值必須是 0
      lastHitAt: null,
      embedding,
      createdAt: now,
    });

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = getFirestore();
    const { id, hitCount, tier, content } = await req.json();

    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (hitCount !== undefined) updates.hitCount = hitCount;
    if (tier !== undefined) updates.tier = tier;
    if (content !== undefined) {
      updates.content = content;
      updates.embedding = await generateEmbedding(content);
    }

    await db.collection('platform_insights').doc(id).update(updates);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = getFirestore();
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });

    await db.collection('platform_insights').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
