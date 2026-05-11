import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const db = getFirestore();
  const doc = await db.collection('live_media_characters').doc(id).get();
  if (!doc.exists) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ character: { id: doc.id, ...doc.data() } });
}
