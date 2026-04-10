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
import { callGemini } from '@/lib/gemini-client';

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
    const { characterId, title, content, category, imageUrl, productName } = await req.json();

    if (!characterId || !content) {
      return NextResponse.json({ error: 'characterId, content 必填' }, { status: 400 });
    }

    // 圖片條目（category=image 或 content 只有圖片 URL）不生成 embedding
    // 原因：短 title 在高維空間產生假高分，污染語意搜尋結果
    const cleanedContent = (content || '').split('\n')
      .filter((line: string) => !line.startsWith('圖片網址：') && !line.startsWith('http'))
      .join(' ').trim();
    const isImageEntry = category === 'image' || cleanedContent.trim().length === 0;
    const embedding = isImageEntry
      ? null
      : await generateEmbedding(`${title || ''} ${cleanedContent}`.slice(0, 1000));
    const now = new Date().toISOString();

    // 自動生成 summary（15字以內，常駐注入用）
    // 天命不是說明書，一句話說清楚核心觀點
    let summary = title || content.slice(0, 15);
    try {
      const geminiSummary = await callGemini(
        `用15字以內總結以下知識的核心觀點，用第一人稱，像角色自己說的一句話：\n\n標題：${title}\n內容：${content.slice(0,200)}\n\n只輸出那句話，不要其他文字。`,
        { maxTokens: 40 }
      );
      if (geminiSummary) summary = geminiSummary.slice(0, 30);
    } catch { /* 生成失敗用 title 代替 */ }

    const docRef = await db.collection('platform_knowledge').add({
      characterId,
      title: title || '',
      content,
      summary,                    // 15字核心觀點，常駐注入用
      category: category || 'general',
      ...(imageUrl ? { imageUrl } : {}),
      ...(productName ? { productName: String(productName) } : {}),
      hitCount: 100,              // 天命初始值高，永遠優先於後天 insights
      tier: 'native',             // 原生天命，不參與升降級，不被蒸餾
      ...(embedding ? { embedding } : {}),
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

// ===== PATCH：補 embedding（修復沒有 embedding 的舊條目）=====
export async function PATCH(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, force } = await req.json();
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const snap = await db.collection('platform_knowledge')
      .where('characterId', '==', characterId).get();

    let fixed = 0, skipped = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      // 圖片條目永遠不生成 embedding
      if (data.category === 'image') { skipped++; continue; }
      // force=true 強制重算（例如 embedding 維度改變時），否則有 embedding 的 skip
      if (!force && data.embedding && Array.isArray(data.embedding)) { skipped++; continue; }

      const text = `${data.title || ''} ${(data.content || '').split('\n')
        .filter((l: string) => !l.startsWith('圖片網址：') && !l.startsWith('http'))
        .join(' ')}`.trim().slice(0, 1000);

      if (!text) { skipped++; continue; }

      try {
        const embedding = await generateEmbedding(text);
        await doc.ref.update({ embedding });
        fixed++;
      } catch (_e) { skipped++; }
    }

    return NextResponse.json({ success: true, fixed, skipped });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
