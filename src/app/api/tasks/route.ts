/**
 * /api/tasks — 排程任務 CRUD
 *
 * GET  ?characterId=xxx → 任務列表
 * POST { characterId, type, run_hour, run_minute, days, enabled } → 建立
 * PATCH { id, ...fields } → 更新
 * DELETE ?id=xxx → 刪除
 *
 * type: post | reflect | learn | engage
 * days: ["mon","tue","wed","thu","fri","sat","sun"]
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const characterId = req.nextUrl.searchParams.get('characterId');
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const snap = await db.collection('platform_tasks')
      .where('characterId', '==', characterId)
      .get();

    const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ tasks, total: snap.size });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, type, run_hour, run_minute, days, enabled, description, intent } = await req.json();

    if (!characterId || !type) {
      return NextResponse.json({ error: 'characterId, type 必填' }, { status: 400 });
    }

    const docRef = await db.collection('platform_tasks').add({
      characterId,
      type,
      run_hour: run_hour ?? 9,
      run_minute: run_minute ?? 0,
      days: days ?? ['mon', 'wed', 'fri'],
      enabled: enabled ?? true,
      description: description || '',
      intent: intent || '',
      last_run: null,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = getFirestore();
    const { id, ...fields } = await req.json();
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });

    const allowed = ['run_hour', 'run_minute', 'days', 'enabled', 'description', 'intent', 'last_run'];
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const key of allowed) {
      if (fields[key] !== undefined) updates[key] = fields[key];
    }

    await db.collection('platform_tasks').doc(id).update(updates);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = getFirestore();
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });

    await db.collection('platform_tasks').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
