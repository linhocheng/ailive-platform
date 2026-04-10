/**
 * POST /api/tools/resource-awareness
 *
 * 掃描角色的知識庫，生成「資源認知索引」存進 platform_insights。
 * 讓角色知道自己有哪些知識文件、圖片（含 URL）、記憶。
 *
 * 索引格式（存成 insight，source='resource_awareness'）：
 *   【我現在有的】
 *   產品圖片：水光澤潤白凝霜（4張）、抗老撫紋精華霜（4張）...
 *   知識文件：AVIVA 品牌介紹、核心成分 × 6 款...
 *   記憶：26 條
 *
 *   【可用圖片 URL】
 *   水光澤潤白凝霜 純產品視角正面：https://...
 *   ...
 *
 * Body: { characterId }
 * Return: { success, insightId, summary }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding } from '@/lib/embeddings';
import { FieldValue } from 'firebase-admin/firestore';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { characterId } = await req.json() as { characterId: string };
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const db = getFirestore();

    // 並行讀取知識庫 + 記憶
    const [knowledgeSnap, insightSnap] = await Promise.all([
      db.collection('platform_knowledge').where('characterId', '==', characterId).limit(200).get(),
      db.collection('platform_insights').where('characterId', '==', characterId).limit(200).get(),
    ]);

    const knowledge = knowledgeSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];
    const insights  = insightSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];

    // ── 分類知識條目 ──
    const imageDocs = knowledge.filter(d => d.category === 'image' && d.imageUrl);
    const textDocs  = knowledge.filter(d => d.category !== 'image');

    // 按產品名聚合圖片
    const imageByProduct: Record<string, Array<{ title: string; url: string }>> = {};
    for (const d of imageDocs) {
      const title = String(d.title || '');
      const url   = String(d.imageUrl || '');
      // 提取產品名（取數字前 / 「與模特兒」前 / 「純產品」前）
      let product = title;
      const numMatch = title.match(/^(.+?)(?:\s*\d+[gGmLmg]+)/);
      if (numMatch) product = numMatch[1].trim();
      else if (title.includes('與模特兒')) product = title.split('與模特兒')[0].trim();
      else if (title.includes('純產品'))   product = title.split('純產品')[0].trim();

      if (!imageByProduct[product]) imageByProduct[product] = [];
      imageByProduct[product].push({ title, url });
    }

    // 知識文件名稱列表
    const docTitles = textDocs.map(d => String(d.title || '')).filter(Boolean);

    // 記憶統計
    const activeInsights = insights.filter(i => i.tier !== 'archive');
    const insightCount   = activeInsights.length;

    // ── 組索引文字 ──
    const productLines = Object.entries(imageByProduct).map(([product, imgs]) =>
      `  ${product}（${imgs.length} 張）`
    );

    // 圖片 URL 清單（每個產品最多取正面 + 半身，控制長度）
    const urlLines: string[] = [];
    for (const [, imgs] of Object.entries(imageByProduct)) {
      // 優先順序：正面 > 半身 > 其他
      const sorted = imgs.sort((a, b) => {
        const rank = (t: string) => {
          if (t.includes('正面')) return 0;
          if (t.includes('半身')) return 1;
          if (t.includes('斜躺')) return 2;
          return 3;
        };
        return rank(a.title) - rank(b.title);
      });
      // 每個產品最多 2 張 URL 進索引
      for (const img of sorted.slice(0, 2)) {
        urlLines.push(`  ${img.title}：${img.url}`);
      }
    }

    const indexContent = [
      `【我現在有的資源】`,
      `產品圖片（${imageDocs.length} 張）：`,
      ...productLines,
      ``,
      `知識文件（${textDocs.length} 筆）：`,
      ...docTitles.slice(0, 10).map(t => `  ${t}`),
      ...(docTitles.length > 10 ? [`  ...等共 ${docTitles.length} 筆`] : []),
      ``,
      `記憶（${insightCount} 條）`,
      ``,
      `【可用圖片 URL（生圖時可填入 reference_image_url）】`,
      ...urlLines,
    ].join('\n');

    // ── 刪除舊的資源認知，寫新的 ──
    const oldSnap = await db.collection('platform_insights')
      .where('characterId', '==', characterId)
      .where('source', '==', 'resource_awareness')
      .get();
    const deleteOps = oldSnap.docs.map(d => d.ref.delete());
    await Promise.all(deleteOps);

    const embedding = await generateEmbedding(indexContent);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

    const ref = await db.collection('platform_insights').add({
      characterId,
      title: '資源認知：我現在有什麼',
      content: indexContent,
      source: 'resource_awareness',
      type: 'resource_awareness',
      tier: 'self',
      hitCount: 3,      // 預設高 hitCount，確保每次 episodicBlock 都能帶入
      lastHitAt: null,
      eventDate: today,
      embedding,
      imageCount: imageDocs.length,
      textCount: textDocs.length,
      insightCount,
      createdAt: new Date().toISOString(),
    });

    // 更新角色的 last_resource_awareness_at
    await db.collection('platform_characters').doc(characterId).update({
      last_resource_awareness_at: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 更新 growthMetrics
    await db.collection('platform_characters').doc(characterId).update({
      'growthMetrics.totalInsights': FieldValue.increment(1),
    });

    return NextResponse.json({
      success: true,
      insightId: ref.id,
      summary: {
        images: imageDocs.length,
        products: Object.keys(imageByProduct).length,
        textDocs: textDocs.length,
        insights: insightCount,
        urlCount: urlLines.length,
      },
      preview: indexContent.slice(0, 300),
    });

  } catch (e: unknown) {
    console.error('[resource-awareness]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
