/**
 * /api/images — 對話生圖檔案夾
 *
 * GET ?characterId=xxx → 撈所有對話中的 assistant imageUrl
 * DELETE ?url=xxx&conversationId=xxx → 從對話中移除該圖的 imageUrl
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const characterId = req.nextUrl.searchParams.get('characterId');
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const snap = await db.collection('platform_conversations')
      .where('characterId', '==', characterId)
      .limit(100)
      .get();

    const images: Array<{ url: string; conversationId: string; timestamp: string }> = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      const messages = (data.messages || []) as Array<Record<string, unknown>>;
      for (const m of messages) {
        const role = m.role as string;
        const imageUrl = m.imageUrl as string;
        const timestamp = m.timestamp as string;
        if (role === 'assistant' && imageUrl && imageUrl.trim()) {
          const cleanUrl = imageUrl.replace(/\n/g, '').trim();
          if (cleanUrl.startsWith('http')) {
            images.push({ url: cleanUrl, conversationId: doc.id, timestamp: timestamp || '' });
          }
        }
      }
    }

    // 按時間排序（最新在前）
    images.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return NextResponse.json({ images, total: images.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = getFirestore();
    const url = req.nextUrl.searchParams.get('url');
    const conversationId = req.nextUrl.searchParams.get('conversationId');
    if (!url || !conversationId) return NextResponse.json({ error: 'url, conversationId 必填' }, { status: 400 });

    const convRef = db.collection('platform_conversations').doc(conversationId);
    const convDoc = await convRef.get();
    if (!convDoc.exists) return NextResponse.json({ error: '對話不存在' }, { status: 404 });

    const messages = (convDoc.data()!.messages || []) as Array<Record<string, unknown>>;
    const updated = messages.map(m => {
      const mUrl = (m.imageUrl as string || '').replace(/\n/g, '').trim();
      const targetUrl = url.replace(/\n/g, '').trim();
      if (m.role === 'assistant' && mUrl === targetUrl) {
        const { imageUrl: _, ...rest } = m;
        void _;
        return rest;
      }
      return m;
    });

    await convRef.update({ messages: updated });
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
