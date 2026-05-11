import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

const COLLECTION = 'live_media_characters';

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY;
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getFirestore();
  const snap = await db.collection(COLLECTION).orderBy('order').get();
  const characters = snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name,
      en: data.en,
      title: data.title,
      tier: data.tier,
      temperature: data.temperature,
      order: data.order,
      positioning: data.positioning,
      status: data.status,
      updatedAt: data.updatedAt,
      // soul_content excluded from list view for performance
    };
  });
  return NextResponse.json({ characters });
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, ...data } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const db = getFirestore();
  await db.collection(COLLECTION).doc(id).set({
    ...data,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  const created = await db.collection(COLLECTION).doc(id).get();
  return NextResponse.json({ character: { id, ...created.data() } });
}

export async function PATCH(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, ...updates } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const db = getFirestore();
  await db.collection(COLLECTION).doc(id).update({
    ...updates,
    updatedAt: new Date().toISOString(),
  });
  const updated = await db.collection(COLLECTION).doc(id).get();
  return NextResponse.json({ character: { id, ...updated.data() } });
}
