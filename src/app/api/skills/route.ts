/**
 * /api/skills — 角色技巧 CRUD
 *
 * GET    ?characterId=xxx            → 取得角色的所有技巧
 * POST   { characterId, name, trigger, procedure, createdBy? } → 建立技巧
 * PATCH  { id, name?, trigger?, procedure?, enabled? }         → 更新技巧
 * DELETE ?id=xxx                     → 刪除技巧
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { generateEmbedding } from '@/lib/embeddings';

export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const characterId = req.nextUrl.searchParams.get('characterId');
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const snap = await db.collection('platform_skills')
      .where('characterId', '==', characterId)
      .get();

    const skills = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
        const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
        return tb - ta;
      });

    return NextResponse.json({ skills, total: skills.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, name, trigger, procedure, createdBy } = await req.json();
    if (!characterId || !name || !trigger || !procedure) {
      return NextResponse.json({ error: 'characterId, name, trigger, procedure 必填' }, { status: 400 });
    }

    const embedding = await generateEmbedding(`${name} ${trigger} ${procedure}`).catch(() => []);
    const ref = await db.collection('platform_skills').add({
      characterId,
      name,
      trigger,
      procedure,
      enabled: true,
      createdBy: createdBy || 'user',
      hitCount: 0,
      embedding,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, id: ref.id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = getFirestore();
    const { id, name, trigger, procedure, enabled } = await req.json();
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (trigger !== undefined) updates.trigger = trigger;
    if (procedure !== undefined) updates.procedure = procedure;
    if (enabled !== undefined) updates.enabled = enabled;

    // 內容有更新時，重算 embedding
    if (name !== undefined || trigger !== undefined || procedure !== undefined) {
      const existing = (await db.collection('platform_skills').doc(id).get()).data() || {};
      const newName = name ?? existing.name ?? '';
      const newTrigger = trigger ?? existing.trigger ?? '';
      const newProcedure = procedure ?? existing.procedure ?? '';
      updates.embedding = await generateEmbedding(`${newName} ${newTrigger} ${newProcedure}`).catch(() => []);
    }

    await db.collection('platform_skills').doc(id).update(updates);
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

    await db.collection('platform_skills').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
