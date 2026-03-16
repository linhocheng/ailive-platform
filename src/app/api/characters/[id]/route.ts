/**
 * /api/characters/[id] — 單一角色讀寫
 * GET → 讀取角色完整資料
 * PATCH { ...fields } → 更新欄位
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getFirestore();
    const doc = await db.collection('platform_characters').doc(id).get();
    if (!doc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });
    return NextResponse.json({ character: { id: doc.id, ...doc.data() } });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getFirestore();
    const body = await req.json();

    const allowed = ['name', 'type', 'rawSoul', 'enhancedSoul', 'mission', 'status',
      'lineChannelToken', 'lineChannelSecret', 'igAccessToken', 'igUserId', 'visualIdentity'];
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    await db.collection('platform_characters').doc(id).update(updates);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
