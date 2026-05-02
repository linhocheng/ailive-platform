/**
 * POST /api/dialogue-end
 * 文字對話結束沉澱 — 由前端在以下任一條件觸發：
 *   1. visibilitychange（切分頁/最小化）
 *   2. beforeunload（關閉視窗）→ sendBeacon
 *   3. 閒置超過 10 分鐘
 *
 * 冪等鎖：conv doc 寫入 dialogueEndAt，同一 convId 只跑一次。
 * 只做 promise-reflection，不重複抽 insights（dialogue 主流程已內建）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { reflectAndMarkFulfilled } from '@/lib/promise-reflection';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { characterId, conversationId, userId } = body as Record<string, string>;

    if (!characterId || !conversationId) {
      return NextResponse.json({ error: 'characterId, conversationId 必填' }, { status: 400 });
    }

    const db = getFirestore();
    const convRef = db.collection('platform_conversations').doc(conversationId);
    const convDoc = await convRef.get();
    if (!convDoc.exists) {
      return NextResponse.json({ success: true, skipped: 'conv not found' });
    }

    // 冪等鎖：已跑過就直接回傳
    if (convDoc.data()?.dialogueEndAt) {
      return NextResponse.json({ success: true, skipped: 'already reflected' });
    }

    // 寫入鎖（先佔位，防並發重複執行）
    await convRef.update({ dialogueEndAt: FieldValue.serverTimestamp() });

    // promise-reflection
    let reflectionStats = null;
    if (userId) {
      try {
        const messages = (convDoc.data()?.messages || []) as Array<{ role: string; content: string }>;
        const transcript = messages
          .slice(-30)
          .map(m => `${m.role === 'user' ? '用戶' : '角色'}：${String(m.content || '').slice(0, 200)}`)
          .join('\n');

        if (transcript) {
          reflectionStats = await reflectAndMarkFulfilled({
            characterId,
            userId,
            transcript,
            anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
          });
        }
      } catch (e) {
        console.warn('dialogue-end reflectAndMarkFulfilled failed:', e);
      }
    }

    return NextResponse.json({ success: true, reflectionStats });
  } catch (e) {
    console.error('dialogue-end error:', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
