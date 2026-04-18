/**
 * /api/assignments — 角色與謀師的配對管轄表
 *
 * 每個角色可以針對不同事件類型配給不同謀師。
 * 沒有配對 = 沒有管理者，事件靜默跳過。
 *
 * GET  ?characterId=xxx → 讀取角色的配對清單
 * GET  ?strategistId=xxx → 讀取謀師管轄的所有角色與事件
 * POST { characterId, event, strategistId } → 新增或更新配對
 * DELETE { characterId, event } → 移除配對
 *
 * 事件類型 (event)：
 *   post_review    角色存草稿後觸發
 *   growth_guide   角色寫入新記憶後觸發
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const characterId = req.nextUrl.searchParams.get('characterId');
    const strategistId = req.nextUrl.searchParams.get('strategistId');

    if (characterId) {
      // 讀某個角色的所有配對
      const snap = await db.collection('platform_assignments')
        .where('characterId', '==', characterId)
        .get();
      const assignments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return NextResponse.json({ assignments });
    }

    if (strategistId) {
      // 讀某個謀師管轄的所有配對
      const snap = await db.collection('platform_assignments')
        .where('strategistId', '==', strategistId)
        .get();
      const assignments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return NextResponse.json({ assignments });
    }

    return NextResponse.json({ error: 'characterId 或 strategistId 必填' }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, event, strategistId } = await req.json();

    if (!characterId || !event || !strategistId) {
      return NextResponse.json({ error: 'characterId, event, strategistId 必填' }, { status: 400 });
    }

    const validEvents = ['post_review', 'growth_guide'];
    if (!validEvents.includes(event)) {
      return NextResponse.json({ error: `event 必須是 ${validEvents.join(' / ')}` }, { status: 400 });
    }

    // 用 characterId+event 作為唯一 key，避免重複
    const docId = `${characterId}_${event}`;
    await db.collection('platform_assignments').doc(docId).set({
      characterId,
      event,
      strategistId,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, id: docId });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, event } = await req.json();
    if (!characterId || !event) {
      return NextResponse.json({ error: 'characterId, event 必填' }, { status: 400 });
    }

    const docId = `${characterId}_${event}`;
    await db.collection('platform_assignments').doc(docId).delete();
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
