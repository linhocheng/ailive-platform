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
import { getAnthropicClient } from '@/lib/anthropic-via-bridge';
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';
import { bm25Scores } from '@/lib/text-similarity';
import { FieldValue } from 'firebase-admin/firestore';

export const maxDuration = 30;

const THRESHOLD = 0.3;
const MAX_IMAGES = 2;
const PER_PRODUCT_CAP = 3; // 語義 fallback 時單一產品最多取幾條，破除同域壟斷

// 混合檢索（BM25 字面 + cosine 語義）權重與 RRF 常數。
// 為什麼：text-embedding-004 在窄域（同品牌化妝品）cosine 全坍縮在 0.85-0.92，
// 失去鑑別力——「法規」這種有明確關鍵詞的參考文件被產品文件擠出 top-N。
// BM25 走字面匹配繞過坍縮（離線實測：法規查詢 BM25 命中 #1，cosine 才 #16）。
// 2:1 偏重 BM25 但保留 cosine 的語義召回（同義詞、無字面重疊的查詢）。
const RRF_K = 60;
const W_BM25 = 2;
const W_COS = 1;

// 對候選 docs 算 BM25，回傳 { id → score, id → rank }。
// 計分核心收斂在 @/lib/text-similarity（episodic 檢索共用），這裡只做 id 映射。
function bm25Score(query: string, docs: Record<string, unknown>[]): { score: Map<string, number>; rank: Map<string, number> } {
  const scores = bm25Scores(query, docs.map(d => `${d.title || ''} ${d.content || ''}`));
  const score = new Map<string, number>();
  docs.forEach((d, i) => score.set(d._id as string, scores[i]));
  const rank = new Map<string, number>();
  [...docs].sort((a, b2) => (score.get(b2._id as string) || 0) - (score.get(a._id as string) || 0))
    .forEach((d, r) => rank.set(d._id as string, r));
  return { score, rank };
}

function imageRank(title: string, query = ''): number {
  const t = title.toLowerCase();
  const q = query.toLowerCase();
  // query 明確要模特兒 → 模特兒圖優先
  if (q.includes('模特兒') || q.includes('人') || q.includes('全身') || q.includes('半身')) {
    if (t.includes('半身')) return 0;
    if (t.includes('全身')) return 1;
    if (t.includes('大頭')) return 2;
    if (t.includes('純產品') && t.includes('正面')) return 3;
    return 4;
  }
  // 預設：純產品正面優先
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

function findImages(imageDocs: Record<string, unknown>[], keywords: string[], query = ''): Record<string, unknown>[] {
  return imageDocs
    .filter(d => keywords.some(k => String(d.title || '').includes(k)))
    .sort((a, b) => imageRank(String(a.title || ''), query) - imageRank(String(b.title || ''), query))
    .slice(0, MAX_IMAGES);
}

export async function POST(req: NextRequest) {
  try {
    const { characterId, userId, query, limit = 10 } = await req.json() as {
      characterId: string; userId?: string; query: string; limit?: number;
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
    // Cross-user leak 防護：insights 帶 userId 的只給該用戶看，無 userId 的是角色通用知識
    const insightDocs: Record<string, unknown>[] = insightSnap.docs
      .map(d => ({ _id: d.id, _type: 'insight', ...d.data() } as Record<string, unknown>))
      .filter(d => !d.userId || d.userId === (userId || ''));

    const textDocs  = allKnowledge.filter(d => d.category !== 'image');
    const imageDocs = allKnowledge.filter(d => d.category === 'image');

    // 從各種 title 格式提取乾淨的產品名
    // 文字條目：「AVIVA 水光澤潤白凝霜 — 核心成分」→ split('—')
    // 圖片條目：「水光澤潤白凝霜30g與模特兒半身手持」→ 取數字前 / 「純產品」前
    const extractProductName = (title: string): string => {
      if (title.includes('—')) return title.split('—')[0].trim();
      const numMatch = title.match(/^(.+?)(?:\s*\d+[gGmLmg]+)/);
      if (numMatch) return numMatch[1].trim();
      for (const kw of ['純產品', '與模特兒', ' 純']) {
        if (title.includes(kw)) return title.split(kw)[0].trim();
      }
      return title.trim();
    };
    const productNames = Array.from(new Set(
      allKnowledge.map(d => extractProductName(String(d.title || ''))).filter(n => n.length > 2)
    ));
    const matchedProduct = productNames.find(p => {
      if (query.includes(p)) return true;
      const short = p.includes(' ') ? p.split(' ').slice(1).join(' ') : p;
      return short.length > 2 && query.includes(short);
    });

    let knowledgeResults: Record<string, unknown>[] = [];
    let queryEmbedding: number[] | null = null;
    let supplementImages: Record<string, unknown>[] = [];

    // 參考層：general（法規、指引、文案規定）是策展規範，與查詢路徑無關，永遠帶入。
    // 不靠語義分數競爭——窄域 embedding 全擠在高分區，會把參考資料擠出 top-N。
    const generalDocs = textDocs.filter(d => d.category === 'general');

    if (matchedProduct) {
      const short = matchedProduct.includes(' ') ? matchedProduct.split(' ').slice(1).join(' ') : matchedProduct;
      knowledgeResults = allKnowledge.filter(d => {
        const t = String(d.title || '');
        return (t.startsWith(matchedProduct) || t.startsWith(short)) && d.category !== 'image';
      });
      supplementImages = allKnowledge
        .filter(d => { const t = String(d.title || ''); return d.category === 'image' && (t.startsWith(matchedProduct) || t.startsWith(short)); })
        .sort((a, b) => imageRank(String(a.title || ''), query) - imageRank(String(b.title || ''), query))
        .slice(0, MAX_IMAGES);
    } else {
      const nonGeneral = textDocs.filter(d => d.category !== 'general');
      if (nonGeneral.length > 0) {
        queryEmbedding = await generateEmbedding(query);
        // cosine 分數 + 名次
        const cosScore = new Map<string, number>();
        for (const d of nonGeneral) {
          const s = (d.embedding && Array.isArray(d.embedding))
            ? cosineSimilarity(queryEmbedding, d.embedding as number[]) : 0;
          cosScore.set(d._id as string, s);
        }
        const cosRank = new Map<string, number>();
        [...nonGeneral].sort((a, b) => (cosScore.get(b._id as string) || 0) - (cosScore.get(a._id as string) || 0))
          .forEach((d, r) => cosRank.set(d._id as string, r));
        // BM25 字面分數 + 名次
        const { score: bmScore, rank: bmRank } = bm25Score(query, nonGeneral);
        // 相關性閘：cosine 達標 或 BM25 有命中，才當候選（擋掉完全不相關的 doc）
        const candidates = nonGeneral.filter(d => {
          const id = d._id as string;
          return (cosScore.get(id) || 0) >= THRESHOLD || (bmScore.get(id) || 0) > 0;
        });
        // 加權 RRF 融合（BM25 重、cosine 輕）
        const fusedScore = (id: string) =>
          W_BM25 / (RRF_K + (bmRank.get(id) ?? 9999)) + W_COS / (RRF_K + (cosRank.get(id) ?? 9999));
        const ranked = candidates.sort((a, b) => fusedScore(b._id as string) - fusedScore(a._id as string));
        // 同域去壟斷：每個產品最多取 PER_PRODUCT_CAP 條，避免單一產品塞滿 top-N
        const perProduct = new Map<string, number>();
        for (const d of ranked) {
          const pn = extractProductName(String(d.title || ''));
          const c = perProduct.get(pn) || 0;
          if (c >= PER_PRODUCT_CAP) continue;
          perProduct.set(pn, c + 1);
          knowledgeResults.push({ ...d, _score: cosScore.get(d._id as string) || 0 });
          if (knowledgeResults.length >= limit) break;
        }
      }
      if (knowledgeResults.length > 0) {
        const kws = extractKeywords(knowledgeResults.map(d => String(d.title || '')));
        supplementImages = findImages(imageDocs, kws, query);
      }
    }

    // 參考層去重後置頂（規範先於細節，且永不被 slice 截斷）
    const seenIds = new Set(knowledgeResults.map(d => d._id));
    knowledgeResults = [...generalDocs.filter(d => !seenIds.has(d._id)), ...knowledgeResults];

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
        const haikuClient = getAnthropicClient(apiKey);
        const reasonRes = await haikuClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{ role: 'user', content: `以下是知識庫搜尋結果，問題是「${query}」：\n\n${rawContext}\n\n請用2-3句話整理：這些條目裡有哪些關鍵資訊？有沒有可以直接用的圖片URL？直接輸出整理結果，不要標題不要列點。` }],
        });
        const reasoned = (reasonRes.content[0] as Anthropic.TextBlock).text.trim();
        // 壓縮顯示：參考層（general）全列，非參考層取分數前 3。避免 general 置頂把產品/記憶擠出結構化區塊。
        const compactItems = [
          ...scored.filter(d => (d as Record<string, unknown>).category === 'general'),
          ...scored.filter(d => (d as Record<string, unknown>).category !== 'general').slice(0, 3),
        ];
        const top3 = compactItems.map(item => {
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
