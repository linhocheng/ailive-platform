/**
 * POST /api/tools/knowledge-search
 *
 * 知識庫 + 記憶語意搜尋，供 dialogue executeTool 呼叫。
 * 從 dialogue/route.ts 拆出，獨立維護。
 *
 * 搜尋策略：
 *   有產品名 → 結構匹配（文字 + 圖片一起撈，圖片最多 2 張）
 *   無產品名 → 語意搜尋文字條目，結果中抽 keywords 補撈圖片（最多 2 張）
 *
 * Body: { characterId, query, limit? }
 * Return: { result: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { FieldValue } from 'firebase-admin/firestore';

export const maxDuration = 30;

const THRESHOLD = 0.3;
const MAX_IMAGES = 2;

function imageRank(title: string): number {
  const t = title.toLowerCase();
  if (t.includes('純產品') && t.includes('正面')) return 0;
  if (t.includes('純產品')) return 1;
  if (t.includes('半身')) return 2;
  if (t.includes('大頭')) return 3;
  return 4;
}

function extractKeywords(titles: string[]): string[] {
  return Array.from(new Set(
    titles.flatMap(t => {
      const base = t.split('—')[0].trim();
      const words = base.split(' ').filter(w => w.length > 1);
      return words.length >= 2 ? [words.slice(1).join(' '), base] : [base];
    })
  )).filter(k => k.length > 2);
}

function findImages(imageDocs: Record<string, unknown>[], keywords: string[]): Record<string, unknown>[] {
  return imageDocs
    .filter(d => keywords.some(k => String(d.title || '').includes(k)))
    .sort((a, b) => imageRank(String(a.title || '')) - imageRank(String(b.title || '')))
    .slice(0, MAX_IMAGES);
}

export async function POST(req: NextRequest) {
  try {
    const { characterId, query, limit = 10 } = await req.json() as {
      characterId: string; query: string; limit?: number;
    };
    if (!characterId || !query) {
      return NextResponse.json({ error: 'characterId 和 query 必填' }, { status: 400 });
    }

    const db = getFirestore();
    const [knowledgeSnap, insightSnap] = await Promise.all([
      db.collection('platform_knowledge').where('characterId', '==', characterId).limit(200).get(),
      db.collection('platform_insights').where('characterId', '==', characterId).limit(100).get(),
    ]);

    const allKnowledge: Record<string, unknown>[] = knowledgeSnap.docs.map(d => ({ _id: d.id, _type: 'knowledge', ...d.data() }));
    const insightDocs: Record<string, unknown>[] = insightSnap.docs.map(d => ({ _id: d.id, _type: 'insight', ...d.data() }));

    const textDocs  = allKnowledge.filter(d => d.category !== 'image');
    const imageDocs = allKnowledge.filter(d => d.category === 'image');

    const productNames = Array.from(new Set(
      allKnowledge.map(d => String(d.title || '').split('—')[0].trim()).filter(n => n.length > 2)
    ));
    const matchedProduct = productNames.find(p => {
      if (query.includes(p)) return true;
      const short = p.includes(' ') ? p.split(' ').slice(1).join(' ') : p;
      return short.length > 2 && query.includes(short);
    });

    let knowledgeResults: Record<string, unknown>[] = [];
    let queryEmbedding: number[] | null = null;
    let supplementImages: Record<string, unknown>[] = [];

    if (matchedProduct) {
      const short = matchedProduct.includes(' ') ? matchedProduct.split(' ').slice(1).join(' ') : matchedProduct;
      knowledgeResults = allKnowledge.filter(d => {
        const t = String(d.title || '');
        return (t.startsWith(matchedProduct) || t.startsWith(short)) && d.category !== 'image';
      });
      supplementImages = allKnowledge
        .filter(d => { const t = String(d.title || ''); return d.category === 'image' && (t.startsWith(matchedProduct) || t.startsWith(short)); })
        .sort((a, b) => imageRank(String(a.title || '')) - imageRank(String(b.title || '')))
        .slice(0, MAX_IMAGES);
    } else {
      const textWithEmb = textDocs.filter(d => d.embedding && Array.isArray(d.embedding));
      if (textWithEmb.length > 0) {
        queryEmbedding = await generateEmbedding(query);
        knowledgeResults = textWithEmb
          .map(d => ({ ...d, _score: cosineSimilarity(queryEmbedding!, d.embedding as number[]) }))
          .filter(d => (d._score as number) >= THRESHOLD)
          .sort((a, b) => (b._score as number) - (a._score as number))
          .slice(0, limit);
      }
      if (knowledgeResults.length > 0) {
        const kws = extractKeywords(knowledgeResults.map(d => String(d.title || '')));
        supplementImages = findImages(imageDocs, kws);
      }
    }

    let insightResults: Record<string, unknown>[] = [];
    const insightWithEmb = insightDocs.filter(d => d.embedding && Array.isArray(d.embedding));
    if (insightWithEmb.length > 0) {
      if (!queryEmbedding) queryEmbedding = await generateEmbedding(query);
      insightResults = insightWithEmb
        .map(d => ({ ...d, _score: cosineSimilarity(queryEmbedding!, d.embedding as number[]) }))
        .filter(d => (d._score as number) >= THRESHOLD)
        .sort((a, b) => (b._score as number) - (a._score as number))
        .slice(0, 5);
    }

    const scored = [...knowledgeResults, ...insightResults];
    if (scored.length === 0 && supplementImages.length === 0) {
      return NextResponse.json({ result: '（沒有找到相關資料）' });
    }

    void Promise.all([...scored, ...supplementImages].map(item => {
      const doc = item as Record<string, unknown>;
      const col = doc._type === 'insight' ? 'platform_insights' : 'platform_knowledge';
      if (!doc._id) return;
      return db.collection(col).doc(doc._id as string).update({
        hitCount: FieldValue.increment(1), lastHitAt: new Date().toISOString(),
      }).catch(() => {});
    }));

    const imageContext = supplementImages.length > 0
      ? '\n\n[產品圖片]\n' + supplementImages.map(d =>
          `${d.title}：${d.imageUrl}（生圖時填入 reference_image_url）`
        ).join('\n')
      : '';

    const textContext = scored.map(item => {
      const d = item as Record<string, unknown>;
      const score = (d._score as number) || 0;
      const tag = d._type === 'knowledge' ? `[天命・${d.category || '一般'}]` : '[記憶]';
      const body = d._type === 'knowledge'
        ? String(d.content || d.summary || '').slice(0, 300)
        : String(d.content || '').slice(0, 150);
      const imgLine = (d._type === 'knowledge' && d.imageUrl && supplementImages.length === 0)
        ? `\n[產品圖 imageUrl: ${d.imageUrl}]（生圖時把這個 URL 填入 reference_image_url）`
        : '';
      const scoreLabel = score > 0 ? ` (相似度${(score * 100).toFixed(0)}%)` : '';
      return `${tag} ${d.title || ''}：${body}${imgLine}${scoreLabel}`;
    }).join('\n\n');

    const rawContext = textContext + imageContext;
    if (!rawContext.trim()) return NextResponse.json({ result: '（沒有找到相關資料）' });

    if (scored.length >= 2) {
      try {
        const apiKey = process.env.ANTHROPIC_API_KEY || '';
        const haikuClient = new Anthropic({ apiKey });
        const reasonRes = await haikuClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: `以下是知識庫搜尋結果，問題是「${query}」：\n\n${rawContext}\n\n請用2-3句話整理：這些條目裡有哪些關鍵資訊？有沒有可以直接用的圖片URL？直接輸出整理結果，不要標題不要列點。` }],
        });
        const reasoned = (reasonRes.content[0] as Anthropic.TextBlock).text.trim();
        const top3 = scored.slice(0, 3).map(item => {
          const d = item as Record<string, unknown>;
          const tag = d._type === 'knowledge' ? `[天命・${d.category || '一般'}]` : '[記憶]';
          const body = d._type === 'knowledge' ? String(d.content || d.summary || '').slice(0, 150) : String(d.content || '').slice(0, 100);
          return `${tag} ${d.title || ''}：${body}`;
        }).join('\n\n');
        return NextResponse.json({
          result: `${reasoned}\n\n---\n${top3}${imageContext}`,
          haikuTokens: { input: reasonRes.usage?.input_tokens ?? 0, output: reasonRes.usage?.output_tokens ?? 0 },
        });
      } catch { return NextResponse.json({ result: rawContext }); }
    }

    return NextResponse.json({ result: rawContext });
  } catch (e: unknown) {
    console.error('[knowledge-search]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
