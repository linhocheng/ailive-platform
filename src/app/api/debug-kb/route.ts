import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding, cosineSimilarity } from '@/lib/embeddings';

export async function GET(req: NextRequest) {
  const characterId = req.nextUrl.searchParams.get('characterId') || 'se7K2jsx8P1ROVqE1Ppb';
  const query = req.nextUrl.searchParams.get('q') || '時尚搭配';

  const db = getFirestore();
  const snap = await db.collection('platform_knowledge')
    .where('characterId', '==', characterId).get();

  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Record<string, unknown>));
  const withEmb = docs.filter(d => d.embedding && Array.isArray(d.embedding));

  let qEmb: number[] = [];
  let qEmbError = '';
  try {
    qEmb = await generateEmbedding(query);
  } catch (e) {
    qEmbError = String(e);
  }

  const scored = withEmb.map(d => ({
    title: d.title,
    embLen: (d.embedding as number[]).length,
    qEmbLen: qEmb.length,
    score: qEmb.length > 0 ? cosineSimilarity(qEmb, d.embedding as number[]) : -1,
  }));

  return NextResponse.json({
    query,
    totalDocs: docs.length,
    withEmbedding: withEmb.length,
    qEmbLen: qEmb.length,
    qEmbError,
    scored,
  });
}
