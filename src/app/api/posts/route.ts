/**
 * /api/posts — 草稿管理 CRUD
 *
 * GET  ?characterId=xxx&status=draft → 草稿列表
 * POST { characterId, content, imageUrl?, topic? } → 建立草稿
 * PATCH { id, status, scheduledAt? } → 更新狀態（approve/reject/schedule）
 * DELETE ?id=xxx → 刪除
 *
 * status: draft | scheduled | published | rejected
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const characterId = req.nextUrl.searchParams.get('characterId');
    const status = req.nextUrl.searchParams.get('status');
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20');

    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const snap = await db.collection('platform_posts')
      .where('characterId', '==', characterId)
      .limit(limit)
      .get();

    let posts = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];

    // status filter in JS（避免 compound index）
    if (status) posts = posts.filter(p => p.status === status);

    posts.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
      return tb - ta;
    });

    return NextResponse.json({ posts, total: posts.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getFirestore();
    const { characterId, content, imageUrl, topic } = await req.json();

    if (!characterId || !content) {
      return NextResponse.json({ error: 'characterId, content 必填' }, { status: 400 });
    }

    const docRef = await db.collection('platform_posts').add({
      characterId,
      content,
      imageUrl: imageUrl || '',
      topic: topic || '',
      status: 'draft',
      scheduledAt: null,
      publishedAt: null,
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
    const { id, status, scheduledAt, publishedAt, content, imageUrl } = await req.json();
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (status !== undefined) updates.status = status;
    if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt;
    if (publishedAt !== undefined) updates.publishedAt = publishedAt;
    if (content !== undefined) updates.content = content;
    if (imageUrl !== undefined) updates.imageUrl = imageUrl;

    await db.collection('platform_posts').doc(id).update(updates);
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

    await db.collection('platform_posts').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
