/**
 * /api/conversations
 * GET ?characterId=xxx → 列出對話（最新在前）
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  try {
    const db = getFirestore();
    const characterId = req.nextUrl.searchParams.get('characterId');
    if (!characterId) return NextResponse.json({ error: 'characterId 必填' }, { status: 400 });

    const snap = await db.collection('platform_conversations')
      .where('characterId', '==', characterId)
      .limit(50)
      .get();

    const conversations = snap.docs
      .map(d => {
        const data = d.data();
        // 只取摘要，不回傳完整 messages（太大）
        const msgs = (data.messages || []) as Array<{ role: string; content: string }>;
        const lastMsg = msgs[msgs.length - 1];
        return {
          id: d.id,
          characterId: data.characterId,
          userId: data.userId,
          messageCount: data.messageCount || 0,
          lastMessage: lastMsg?.content?.slice(0, 60) || '',
          lastRole: lastMsg?.role || '',
          createdAt: data.createdAt || '',
          updatedAt: data.updatedAt || '',
        };
      })
      .sort((a, b) => {
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tb - ta;
      });

    return NextResponse.json({ conversations, total: conversations.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
