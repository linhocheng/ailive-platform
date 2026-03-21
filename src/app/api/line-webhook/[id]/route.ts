/**
 * /api/line-webhook/[id] — LINE Webhook 入口
 *
 * POST — 接收 LINE 訊息（text + image）→ 呼叫 /api/dialogue → push 回 LINE
 * 每個角色有獨立的 Channel Token/Secret（存在 platform_characters）
 *
 * v2：支援圖片訊息 + 生圖回傳 + push 模式（避免 reply token 5秒限制）
 */
import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { after } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

export const maxDuration = 60;

function verifySignature(body: string, signature: string, secret: string): boolean {
  const hash = crypto.createHmac('sha256', secret).update(body).digest('base64');
  return hash === signature;
}

// ===== 下載 LINE 圖片 → base64 =====
async function downloadLineImage(messageId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  } catch {
    return null;
  }
}

// ===== LINE Push（不佔 reply token，無 5 秒限制）=====
async function pushToLine(userId: string, messages: object[], token: string): Promise<void> {
  for (const msg of messages) {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: userId, messages: [msg] }),
    });
  }
}

// ===== 核心處理 =====
async function processEvent(
  event: Record<string, unknown>,
  characterId: string,
  token: string,
): Promise<void> {
  const source = event.source as Record<string, string> | undefined;
  const userId = source?.userId;
  if (!userId) return;

  const msgObj = event.message as Record<string, unknown> | undefined;
  const msgType = msgObj?.type as string;

  let message = '';
  let imagePayload: { type: string; media_type: string; data: string } | undefined;

  if (msgType === 'text') {
    message = (msgObj?.text as string) || '';
    if (!message) return;
  } else if (msgType === 'image') {
    const imageId = msgObj?.id as string;
    const base64 = await downloadLineImage(imageId, token);
    if (!base64) return;
    message = '（傳了一張圖片）';
    imagePayload = { type: 'base64', media_type: 'image/jpeg', data: base64 };
  } else {
    return; // sticker / video / audio 等略過
  }

  // 呼叫 dialogue
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ailive-platform.vercel.app';
  // 固定 conversationId：同一個 LINE 用戶 + 角色永遠對應同一段對話（跨 LINE/網頁共享記憶）
  const fixedConversationId = `line_${characterId}_${userId}`;
  const body: Record<string, unknown> = {
    characterId,
    userId,
    message,
    conversationId: fixedConversationId,
  };
  if (imagePayload) body.image = imagePayload;

  const dialogueRes = await fetch(`${baseUrl}/api/dialogue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await dialogueRes.json();
  const reply: string = data.reply || '（系統暫時無法回應）';
  const generatedImages: string[] = data.generatedImages || [];

  // 清理 markdown 語法（LINE 不支援）
  const lineText = reply
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || '⟁';

  // 組合訊息
  const messages: object[] = [{ type: 'text', text: lineText }];
  for (const imgUrl of generatedImages) {
    messages.push({
      type: 'image',
      originalContentUrl: imgUrl,
      previewImageUrl: imgUrl,
    });
  }

  await pushToLine(userId, messages, token);
  console.log(`✅ [line-webhook/${characterId}] 回覆成功 userId=${userId} type=${msgType}`);
}

// ===== 主 Handler =====
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

    // 簽名驗證（LINE verify 請求無 signature，允許通過）
    if (signature && !verifySignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: '簽名驗證失敗' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);
    const events: Record<string, unknown>[] = body.events || [];

    // LINE verify 空事件
    if (events.length === 0) return NextResponse.json({ ok: true });

    const event = events[0];

    // follow 事件
    if (event.type === 'follow') {
      const src = event.source as Record<string, string> | undefined;
      const userId = src?.userId;
      const charName = char.name || '我';
      if (userId) {
        after(async () => {
          await pushToLine(userId, [{ type: 'text', text: `你好，我是${charName}。` }], token);
        });
      }
      return NextResponse.json({ ok: true });
    }

    // 非訊息事件略過
    if (event.type !== 'message') return NextResponse.json({ ok: true });

    // 先回 200，after() 非同步處理（避免 LINE 超時重送）
    after(async () => {
      try {
        await processEvent(event, characterId, token);
      } catch (e) {
        console.error(`❌ [line-webhook/${characterId}]`, e);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[line-webhook] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET for LINE Webhook URL 驗證
export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'LINE Webhook (ailive-platform)' });
}
