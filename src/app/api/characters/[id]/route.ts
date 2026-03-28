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

    const allowed = ['name', 'type', 'rawSoul', 'enhancedSoul', 'soul_core', 'soul_full', 'system_soul', 'clientPassword',
      'mission', 'status', 'lineChannelToken', 'lineChannelSecret',
      'igAccessToken', 'igUserId', 'visualIdentity'];
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

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getFirestore();

    // 確認角色存在
    const doc = await db.collection('platform_characters').doc(id).get();
    if (!doc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });

    // 清除所有關聯資料（batch delete）
    const collections = [
      'platform_tasks',
      'platform_insights',
      'platform_posts',
      'platform_conversations',
      'platform_knowledge',
      'platform_soul_proposals',
    ];

    for (const col of collections) {
      const snap = await db.collection(col)
        .where('characterId', '==', id)
        .limit(500)
        .get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      if (snap.size > 0) await batch.commit();
    }

    // 刪角色本體
    await db.collection('platform_characters').doc(id).delete();

    // 刪 Firebase Storage 圖檔（platform-images + platform-refs）
    let storageDeleted = 0;
    try {
      const admin = (await import('@/lib/firebase-admin')).getFirebaseAdmin();
      const bucket = admin.storage().bucket();
      const prefixes = [
        `platform-images/${id}/`,
        `platform-refs/${id}/`,
      ];
      for (const prefix of prefixes) {
        const [files] = await bucket.getFiles({ prefix });
        for (const file of files) {
          await file.delete();
          storageDeleted++;
        }
      }
    } catch (storageErr) {
      console.warn('[DELETE character] Storage 清理失敗（不阻斷）:', storageErr);
    }

    return NextResponse.json({ success: true, deleted: id, storageDeleted });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
