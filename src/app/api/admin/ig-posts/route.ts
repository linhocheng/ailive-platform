import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  const isAdmin = req.headers.get('x-admin-key') === process.env.ADMIN_KEY;
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

  const db = getFirestore();
  let query: FirebaseFirestore.Query = db
    .collection('platform_posts')
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (status) query = db.collection('platform_posts').where('status', '==', status).limit(limit);

  const snap = await query.get();
  const posts = snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? data.createdAt,
      publishedAt: data.publishedAt?.toDate?.()?.toISOString() ?? data.publishedAt,
    };
  });

  return NextResponse.json({ posts });
}
