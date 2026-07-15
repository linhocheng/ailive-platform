/**
 * /api/livekit/wake — 語音 agent 喚醒（開關制的「開」）
 *
 * POST：撥號頁進場時打。agent 關著就開機（minInstances 0→1）並蓋活動章。
 * GET ：前端輪詢開機進度，只讀不寫。
 *
 * 回傳 { state: 'ready' | 'waking', minInstances }
 * ready 的鑑別信號 = agent 容器開機後在 Firestore 蓋的章（agentBootAt > lastSleepAt），
 * 不是 Cloud Run 設定值（設定 1 ≠ 實例起來了）。
 *
 * 濫用上限：這個 route 只會把 min 設成 1，成本由 agent-sleep cron 自動封頂
 * （閒置 30 分自動關）。
 */
import { NextResponse } from 'next/server';
import { wakeVoiceAgent, voiceAgentStatus } from '@/lib/voice-agent-switch';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    return NextResponse.json(await wakeVoiceAgent());
  } catch (e) {
    console.error('[wake] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET() {
  try {
    return NextResponse.json(await voiceAgentStatus());
  } catch (e) {
    console.error('[wake:status] failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
