/**
 * /api/soul-proposals — 靈魂提案
 * GET  ?characterId=xxx → 列表
 * PATCH { id, status: approved|rejected } → 審核
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const characterId = req.nextUrl.searchParams.get('characterId');
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const snap = await db.collection('platform_soul_proposals')
      .where('characterId', '==', characterId)
      .limit(20)
      .get();

    const proposals = snap.docs
      .map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];

    proposals.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
      return tb - ta;
    });

    return NextResponse.json({ proposals, total: proposals.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = getFirestore();
    const { id, status } = await req.json();
    if (!id || !status) return NextResponse.json({ error: 'id, status 必填' }, { status: 400 });

    await db.collection('platform_soul_proposals').doc(id).update({
      status,
      reviewedAt: new Date().toISOString(),
    });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
