/**
 * POST /api/tools/resource-awareness
 *
 * 掃描角色的資源，生成輕量「資源認知索引」存進 platform_insights。
 * 適用所有角色——有產品庫的列產品，沒有的只列知識文件和記憶。
 *
 * 設計原則：
 *   - 輕量：約 50-80 tokens，不帶 URL（URL 交給 query_product_card）
 *   - 通用：有沒有 platform_products 都能跑
 *   - 主動：讓角色知道自己有什麼，才會想到去查
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

    // 並行讀取三個來源
    const [productSnap, knowledgeSnap, insightSnap] = await Promise.all([
      db.collection('platform_products').where('characterId', '==', characterId).get(),
      db.collection('platform_knowledge').where('characterId', '==', characterId).limit(200).get(),
      db.collection('platform_insights').where('characterId', '==', characterId).limit(200).get(),
    ]);

    // ── 產品主檔（platform_products）──
    const products = productSnap.docs.map(d => ({
      id: d.id,
      productName: String(d.data().productName || ''),
      imageCount: Object.keys(d.data().images || {}).length,
    })).filter(p => p.productName);

    // ── 知識文件（非 image 條目）──
    const textDocs = knowledgeSnap.docs
      .filter(d => d.data().category !== 'image')
      .map(d => String(d.data().title || ''))
      .filter(Boolean);

    const imageDocs = knowledgeSnap.docs.filter(d => d.data().category === 'image');

    // ── 記憶統計 ──
    const activeInsights = insightSnap.docs.filter(d => {
      const data = d.data();
      return data.tier !== 'archive' && data.source !== 'resource_awareness';
    });

    // ── 組索引文字（輕量版）──
    const lines: string[] = ['【我現在有的】', ''];

    // 產品主檔段落（只有有產品的角色才出現）
    if (products.length > 0) {
      lines.push(`產品主檔（${products.length} 款）：`);
      lines.push(`  ${products.map(p => `${p.productName}（${p.imageCount} 張圖）`).join('、')}`);
      lines.push('  → 需要某個產品的成分/圖片/功效，用 query_product_card');
      lines.push('');
    }

    // 知識文件（有才列）
    if (textDocs.length > 0) {
      lines.push(`知識文件（${textDocs.length} 筆）：`);
      const preview = textDocs.slice(0, 6).join('、');
      const suffix = textDocs.length > 6 ? `...等共 ${textDocs.length} 筆` : '';
      lines.push(`  ${preview}${suffix}`);
      if (imageDocs.length > 0) {
        lines.push(`  另有產品圖片 ${imageDocs.length} 張`);
      }
      lines.push('  → 需要查知識內容，用 query_knowledge_base');
      lines.push('');
    }

    // 記憶統計
    lines.push(`記憶（${activeInsights.length} 條）`);

    const indexContent = lines.join('\n');

    // ── 刪除舊的，寫新的 ──
    const oldSnap = await db.collection('platform_insights')
      .where('characterId', '==', characterId)
      .where('source', '==', 'resource_awareness')
      .get();
    await Promise.all(oldSnap.docs.map(d => d.ref.delete()));

    const embedding = await generateEmbedding(indexContent);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

    const ref = await db.collection('platform_insights').add({
      characterId,
      title: '資源認知：我現在有什麼',
      content: indexContent,
      source: 'resource_awareness',
      type: 'resource_awareness',
      tier: 'self',
      hitCount: 3,
      lastHitAt: null,
      eventDate: today,
      embedding,
      productCount: products.length,
      textDocCount: textDocs.length,
      insightCount: activeInsights.length,
      createdAt: new Date().toISOString(),
    });

    await db.collection('platform_characters').doc(characterId).update({
      last_resource_awareness_at: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.collection('platform_characters').doc(characterId).update({
      'growthMetrics.totalInsights': FieldValue.increment(1),
    });

    return NextResponse.json({
      success: true,
      insightId: ref.id,
      preview: indexContent,
      summary: {
        products: products.length,
        textDocs: textDocs.length,
        images: imageDocs.length,
        insights: activeInsights.length,
      },
    });

  } catch (e: unknown) {
    console.error('[resource-awareness]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
