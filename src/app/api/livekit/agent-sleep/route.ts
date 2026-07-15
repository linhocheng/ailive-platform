/**
 * /api/livekit/agent-sleep — 語音 agent 閒置自關（開關制的「關」）
 *
 * Vercel cron 每 20 分打一次（vercel.json）。條件全過才熄燈：
 *   1. minInstances 目前是 1（已關就冪等跳過——每次 PATCH 都生計費驗證實例，不能亂拍）
 *   2. LiveKit 沒有活躍的 realtime-* 房（通話中絕不關；順便續活動章）
 *   3. 距最後活動（wake 或通話）超過 30 分鐘
 *
 * 授權：同 sync-services 慣例，設了 CRON_SECRET 就驗 Bearer。
 */
import { NextRequest, NextResponse } from 'next/server';
import { sleepVoiceAgentIfIdle } from '@/lib/voice-agent-switch';

export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET;
const IDLE_MINUTES = 30;

export async function GET(req: NextRequest) {
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  try {
    const result = await sleepVoiceAgentIfIdle(IDLE_MINUTES);
    console.log('[agent-sleep]', JSON.stringify(result));
    return NextResponse.json(result);
  } catch (e) {
    console.error('[agent-sleep] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
