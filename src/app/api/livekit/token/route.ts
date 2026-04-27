/**
 * LiveKit token 簽發 API（即時撥號模式 Phase 1）
 *
 * POST body:
 *   - characterId : Firestore platform_characters doc id（必要）
 *   - userId      : 用戶 id（選，沒帶就 anon-{ts}）
 *   - convId      : 對話 id（選，沒帶就 realtime-{characterId}-{userId}-{ts}）
 *
 * 回傳：
 *   - token       : LiveKit JWT，前端拿去連 room
 *   - url         : LiveKit 服務端點 wss://...
 *   - roomName    : 本次通話的 room
 *   - identity    : 本次 user 在 room 裡的 identity
 *
 * room metadata 帶 { characterId, userId, convId, characterName, voiceId, ttsProvider }
 * → Python agent 從 room metadata 拿這幾個欄位決定用哪個角色 soul + voice 接通
 *
 * 紅線：不影響既有 dialogue/voice-stream，純新 endpoint。
 */
import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { RoomConfiguration, RoomAgentDispatch } from '@livekit/protocol';
import { getFirestore } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

interface TokenRequest {
  characterId: string;
  userId?: string;
  convId?: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      { error: 'LIVEKIT_* env 未設定' },
      { status: 500 },
    );
  }

  let body: TokenRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  if (!body.characterId) {
    return NextResponse.json({ error: 'characterId is required' }, { status: 400 });
  }

  const db = getFirestore();
  const charDoc = await db.collection('platform_characters').doc(body.characterId).get();
  if (!charDoc.exists) {
    return NextResponse.json({ error: `character ${body.characterId} not found` }, { status: 404 });
  }
  const charData = charDoc.data() as Record<string, unknown>;

  const ts = Date.now();
  const userId = body.userId || `anon-${ts}`;
  const convId = body.convId || `realtime-${body.characterId}-${userId}-${ts}`;
  const roomName = convId;
  const identity = userId;

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: identity,
    metadata: JSON.stringify({
      characterId: body.characterId,
      userId,
      convId,
      characterName: charData.name || '',
      voiceId: charData.voiceId || '',
      ttsProvider: charData.ttsProvider || 'elevenlabs',
    }),
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  // 顯式 dispatch agent（LiveKit 1.5.x 新 project 預設要求 explicit dispatch）
  // agentName 留空字串 = match 任何沒指定 name 的 worker（即我們的 ailive-realtime-agent）
  // 也透過 metadata 把 character/conv/user 訊息一起送進 agent JobContext
  at.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: '',
        metadata: JSON.stringify({
          characterId: body.characterId,
          userId,
          convId,
          characterName: charData.name || '',
          voiceId: charData.voiceId || '',
          ttsProvider: charData.ttsProvider || 'elevenlabs',
        }),
      }),
    ],
  });

  const token = await at.toJwt();
  return NextResponse.json({ token, url, roomName, identity });
}
