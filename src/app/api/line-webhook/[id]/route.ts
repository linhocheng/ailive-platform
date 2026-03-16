/**
 * /api/line-webhook/[id] — LINE Webhook 入口
 *
 * POST — 接收 LINE 訊息 → 呼叫 /api/dialogue → push 回 LINE
 * 每個角色有獨立的 Channel Token/Secret（存在 platform_characters）
 */
import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { getFirestore } from '@/lib/firebase-admin';

function verifySignature(body: string, signature: string, secret: string): boolean {
  const hash = crypto.createHmac('sha256', secret).update(body).digest('base64');
  return hash === signature;
}

async function pushMessage(channelToken: string, replyToken: string, text: string) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: characterId } = await params;
  const rawBody = await req.text();
  const signature = req.headers.get('x-line-signature') || '';

  try {
    const db = getFirestore();
    const charDoc = await db.collection('platform_characters').doc(characterId).get();
    if (!charDoc.exists) return NextResponse.json({ error: '角色不存在' }, { status: 404 });

    const char = charDoc.data()!;
    const secret = char.lineChannelSecret;
    const token = char.lineChannelToken;

    if (!secret || !token) {
      return NextResponse.json({ error: 'LINE 尚未設定' }, { status: 400 });
    }

    // 驗證簽名
    if (!verifySignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: '簽名驗證失敗' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);
    const events = body.events || [];

    for (const event of events) {
      if (event.type !== 'message' || event.message?.type !== 'text') continue;

      const userId = event.source?.userId || 'anonymous';
      const message = event.message.text;
      const replyToken = event.replyToken;

      // 呼叫 dialogue
      const dialogueRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'https://ailive-platform.vercel.app'}/api/dialogue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, userId, message }),
      });

      const dialogueData = await dialogueRes.json();
      const reply = dialogueData.reply || '（系統暫時無法回應）';

      await pushMessage(token, replyToken, reply);
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[line-webhook] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
