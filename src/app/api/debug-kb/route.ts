import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';

export async function GET(req: NextRequest) {
  const characterId = req.nextUrl.searchParams.get('characterId') || 'se7K2jsx8P1ROVqE1Ppb';
  const query = req.nextUrl.searchParams.get('q') || '時尚搭配';

  const db = getFirestore();
  const snap = await db.collection('platform_knowledge')
    .where('characterId', '==', characterId).get();

  const firstDoc = snap.docs[0]?.data();
  const rawEmb = firstDoc?.embedding;

  // 關鍵：看 Admin SDK 讀回來的 embedding 實際格式
  const embInfo = {
    type: typeof rawEmb,
    isArray: Array.isArray(rawEmb),
    length: Array.isArray(rawEmb) ? rawEmb.length : 'N/A',
    firstElement: Array.isArray(rawEmb) ? rawEmb[0] : rawEmb,
    firstElementType: Array.isArray(rawEmb) ? typeof rawEmb[0] : 'N/A',
    // 如果第一個元素是 number，才是真的 number[]
    isNumberArray: Array.isArray(rawEmb) && typeof rawEmb[0] === 'number',
  };

  // 生成查詢向量
  let qEmb: number[] = [];
  let qEmbError = '';
  try {
    qEmb = await generateEmbedding(query);
  } catch (e) {
    qEmbError = String(e);
  }

  // 如果是真的 number[]，算 cosine
  const scores = snap.docs.map(d => {
    const data = d.data();
    const emb = data.embedding;
    const isNum = Array.isArray(emb) && typeof emb[0] === 'number';
    const score = isNum && qEmb.length > 0 ? cosineSimilarity(qEmb, emb as number[]) : -1;
    return { id: d.id, title: data.title, isNumArray: isNum, embLen: Array.isArray(emb) ? emb.length : 0, score };
  });

  return NextResponse.json({ embInfo, qEmbLen: qEmb.length, qEmbError, scores });
}
